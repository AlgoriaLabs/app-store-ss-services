// Fetches a client-supplied URL without letting it reach this server's own network (SSRF).
//
// Only https (http too when ALLOW_PRIVATE_URLS=true, for local development). Every address a host name resolves to
// is checked at connect time, inside the socket's DNS lookup, so a name that resolves to a public address first and a
// private one later (DNS rebinding) is still refused. Redirects are followed by hand, at most 3, each one checked the
// same way. The body is capped at `maxBytes`.

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { config } from "./config.js";

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

export class FetchRefused extends Error {}

function isPublic(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    const list = addresses as unknown as LookupAddress[];
    const bad = list.find((entry) => !isPublic(entry.address));
    if (bad && !config.allowPrivateUrls) return callback(new FetchRefused(`${hostname} resolves to a private address`), "", 0);
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    const first = list[0];
    if (!first) return callback(new FetchRefused(`${hostname} has no address`), "", 0);
    return callback(null, first.address, first.family);
  });
};

export interface Fetched {
  bytes: Buffer;
  contentType: string;
  url: string;
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions, redirects = 3): Promise<Fetched> {
  const url = new URL(rawUrl);
  const allowedProtocols = config.allowPrivateUrls ? ["https:", "http:"] : ["https:"];
  if (!allowedProtocols.includes(url.protocol)) throw new FetchRefused(`only https links are accepted: ${url.protocol}`);
  if (url.username || url.password) throw new FetchRefused("links with user info are not accepted");
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) && !isPublic(literal) && !config.allowPrivateUrls) throw new FetchRefused("private addresses are not accepted");

  const client = url.protocol === "https:" ? https : http;
  return new Promise<Fetched>((resolvePromise, reject) => {
    const request = client.get(
      url,
      {
        lookup: guardedLookup,
        timeout: options.timeoutMs ?? 20_000,
        headers: { "User-Agent": "app-store-screenshot-studio/0.1", Accept: "image/*,*/*;q=0.5", ...options.headers },
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          if (redirects <= 0) return reject(new FetchRefused("too many redirects"));
          const next = new URL(response.headers.location, url).toString();
          return safeFetch(next, options, redirects - 1).then(resolvePromise, reject);
        }
        if (status !== 200) {
          response.resume();
          return reject(new FetchRefused(`${url.host} answered ${status}`));
        }
        const declared = Number(response.headers["content-length"] ?? "0");
        if (declared > options.maxBytes) {
          response.destroy();
          return reject(new FetchRefused(`larger than ${options.maxBytes} bytes`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            response.destroy();
            reject(new FetchRefused(`larger than ${options.maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolvePromise({ bytes: Buffer.concat(chunks), contentType: String(response.headers["content-type"] ?? ""), url: url.toString() }),
        );
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new FetchRefused(`${url.host} timed out`)));
    request.on("error", reject);
  });
}
