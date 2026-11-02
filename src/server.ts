// App Store Screenshot Studio: a paid service on Stellar, built with the Provider Kit (Provider Standard v1).
//
// Settings come from .env: public values, and on mainnet the facilitator's API key. This service never needs a Stellar
// secret key. Paid jobs are kept in SQLite (JOB_DB_PATH), so they survive a restart, and a client that lost its
// response can still collect the result. `npm run launch` starts this file with PUBLIC_ORIGIN set to the public
// address, to read the manifest it will serve there.
//
// Next to the provider's own routes, this server answers GET /files/... (the rendered images, see src/lib/storage.ts),
// GET /healthz and GET / (a short page for people).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createProvider, httpFacilitator, sqliteStore, type ProviderConfig } from "@stellar-agent-services/provider-kit";
import { config } from "./lib/config.js";
import { llmConfigured } from "./lib/llm.js";
import { serveFile, startSweeper } from "./lib/storage.js";
import { closeRenderer } from "./render/renderer.js";
import { appStoreScreenshots } from "./services/app-store-screenshots.js";

const port = Number(process.env["PORT"] ?? "8787");
const origin = (process.env["PUBLIC_ORIGIN"] ?? `http://localhost:${port}`).replace(/\/$/, "");
const dev = origin.startsWith("http://localhost");
// stellar:testnet takes test money; stellar:pubnet is mainnet, real USDC.
const network = (process.env["STELLAR_NETWORK"] ?? "stellar:testnet") as ProviderConfig["network"];
const payTo = process.env["PAY_TO"];
if (!payTo) throw new Error(`PAY_TO is empty: npm run launch sets up your own wallet${network === "stellar:testnet" ? ", and npm run dev makes a throwaway testnet account meanwhile" : ""}.`);
const agentId = process.env["AGENT_ID"];
const rpcUrl = process.env["SOROBAN_RPC_URL"];

// The facilitator verifies and settles payments: x402.org's on testnet, OpenZeppelin's on mainnet, which wants an API
// key. FACILITATOR_AUTH is sent as the Authorization header: "Bearer <key>".
const facilitatorUrl = process.env["FACILITATOR_URL"] ?? (network === "stellar:pubnet" ? "https://channels.openzeppelin.com/x402" : "https://x402.org/facilitator");
const facilitatorAuth = process.env["FACILITATOR_AUTH"];
if (network === "stellar:pubnet" && !facilitatorAuth && !process.env["FACILITATOR_URL"]) {
  throw new Error('FACILITATOR_AUTH is empty: get an API key at https://channels.openzeppelin.com/gen, and set FACILITATOR_AUTH="Bearer <key>" in .env.');
}

const provider = createProvider({
  baseUrl: origin,
  dev,
  network,
  payTo,
  facilitator: httpFacilitator(facilitatorUrl, { dev, ...(facilitatorAuth ? { headers: { Authorization: facilitatorAuth } } : {}) }),
  // Search (Stellar Agent Search, the 8004 explorer) matches this name and description: the words buyers type.
  provider: {
    name: "App Store Screenshot Studio",
    description:
      "App Store screenshot generator for iOS apps: panoramic and 3D iPhone and iPad mockups with AI-written headlines, made from a GitHub repository and 5 app screenshots.",
    dataUse: { storesInputs: false, trainsOnInputs: false },
    ...(agentId ? { agentId: Number(agentId) } : {}),
  },
  services: [appStoreScreenshots(origin)],
  store: sqliteStore(process.env["JOB_DB_PATH"] ?? "./jobs.sqlite"),
  // Rendering takes about a minute: an on-success payment has to stay valid that long [S2].
  maxTimeoutSeconds: 300,
  // Image links in a result stay valid as long as the result [S8].
  retentionSeconds: config.retentionSeconds,
  // Decides payment_uncertain jobs from the chain. Testnet defaults to the public RPC; mainnet needs one.
  ...(rpcUrl ? { rpc: rpcUrl } : {}),
});

const landing = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>App Store Screenshot Studio</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:680px;margin:48px auto;padding:0 16px;color:#1b1d22}code{background:#f1f2f5;padding:2px 5px;border-radius:4px}a{color:#4a4ad0}</style></head>
<body><h1>App Store Screenshot Studio</h1>
<p>A paid AI service on Stellar. Send a public GitHub repository of a mobile app and 5 screenshots; get back App Store-ready
panoramic and 3D screenshot sets, with headlines written from the repository, in App Store Connect's sizes.</p>
<p>Agents pay per call in USDC through x402 (Provider Standard v1). The manifest lists the price, schemas and an example:
<a href="/.well-known/stellar-agent-services.json"><code>/.well-known/stellar-agent-services.json</code></a>.</p>
<p>Network: <code>${network}</code></p></body></html>`;

const sweeper = startSweeper();

async function handle(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
  try {
    const method = incoming.method ?? "GET";
    const pathname = new URL(incoming.url ?? "/", "http://localhost").pathname;
    let response: Response | undefined;
    if (method === "GET" && pathname === "/healthz") response = Response.json({ ok: true });
    else if (method === "GET" && pathname === "/") response = new Response(landing, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    else if ((method === "GET" || method === "HEAD") && pathname.startsWith("/files/")) response = await serveFile(pathname);
    response ??= await provider.fetch(toRequest(incoming));
    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => outgoing.setHeader(name, value));
    if (response.body === null || method === "HEAD") {
      outgoing.end();
      return;
    }
    for await (const chunk of response.body) {
      if (!outgoing.write(chunk)) await new Promise((resolve) => outgoing.once("drain", resolve));
    }
    outgoing.end();
  } catch (error) {
    console.error("[server] request failed:", error);
    if (!outgoing.headersSent) outgoing.writeHead(500, { "Content-Type": "application/json" });
    outgoing.end();
  }
}

/** The router reads only the path, so the host part of the URL is a placeholder. The body is read only when asked. */
function toRequest(incoming: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) for (const each of value) headers.append(name, each);
    else if (value !== undefined) headers.set(name, value);
  }
  const method = incoming.method ?? "GET";
  if (method === "GET" || method === "HEAD") return new Request(new URL(incoming.url ?? "/", "http://localhost"), { method, headers });
  let started = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (!started) {
          started = true;
          incoming.on("data", (chunk: Buffer) => {
            controller.enqueue(chunk);
            if ((controller.desiredSize ?? 0) <= 0) incoming.pause();
          });
          incoming.once("end", () => controller.close());
          incoming.once("error", (error) => controller.error(error));
        }
        incoming.resume();
      },
      cancel() {
        incoming.resume();
      },
    },
    { highWaterMark: 0 },
  );
  return new Request(new URL(incoming.url ?? "/", "http://localhost"), { method, headers, body, duplex: "half" } as RequestInit);
}

// Fails fast if the facilitator can't settle this network, and resumes jobs a restart left behind.
await provider.ready();
const server = createServer((request, response) => void handle(request, response));
await new Promise<void>((resolve) => server.listen(port, "0.0.0.0", resolve));
console.log(`Listening on ${origin}`);
console.log(`Manifest: ${provider.manifestUrl}`);
console.log(`payTo:    ${payTo}`);
console.log(`Headlines: ${llmConfigured() ? `model ${config.llm.model}` : "from the README (set LLM_API_KEY for a model)"}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    clearInterval(sweeper);
    server.close();
    server.closeIdleConnections();
    // Waits for requests in flight (a held create-job lasts at most 30 s [J9]), then stops.
    const force = setTimeout(() => server.closeAllConnections(), 35_000);
    force.unref();
    void Promise.allSettled([provider.close(), closeRenderer()]).then(() => process.exit(0));
  });
}
