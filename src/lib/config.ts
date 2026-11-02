// Settings for the screenshot service, read once from the environment (.env locally, the container's env in
// production). Nothing here is a Stellar key: payments are configured in src/server.ts with public values only.

import { resolve } from "node:path";

function number(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number, got ${JSON.stringify(value)}`);
  return parsed;
}

function text(name: string, fallback = ""): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export const config = {
  /** USDC per call. */
  price: text("PRICE_USDC", "0.25"),
  /** Where rendered images are written and served from: GET /files/<folder>/<file>. */
  outputDir: resolve(text("OUTPUT_DIR", "./data/outputs")),
  /** How long jobs and their image links stay available, in seconds (≥ 3600, spec [J15], [S8]). */
  retentionSeconds: number("RETENTION_SECONDS", 7 * 24 * 3600),
  /** Jobs rendering at once. Each one holds a Chromium page about 5 screenshots wide. */
  concurrency: number("RENDER_CONCURRENCY", 2),

  /**
   * Any OpenAI-compatible chat completions API. The default is Google's Gemini through its OpenAI-compatible
   * endpoint, whose Flash-Lite models have a free tier. OpenRouter, Groq, Together, DeepSeek or a local Ollama work
   * the same way. With no key, headlines come from the repository's README instead, at no cost.
   */
  llm: {
    baseUrl: text("LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai"),
    apiKey: text("LLM_API_KEY"),
    model: text("LLM_MODEL", "gemini-3.1-flash-lite"),
    /** Send small thumbnails of the screenshots, so headlines match what each screen shows. */
    vision: text("LLM_VISION", "true") !== "false",
    timeoutMs: number("LLM_TIMEOUT_MS", 30_000),
  },

  /** Optional: a GitHub token with public read access only, to raise the API limit from 60 to 5,000 calls an hour. */
  githubToken: text("GITHUB_TOKEN"),

  /** Limits on each screenshot a client sends or links. */
  maxImageBytes: number("MAX_IMAGE_BYTES", 15 * 1024 * 1024),
  maxImagePixels: number("MAX_IMAGE_PIXELS", 40_000_000),
  /** Allows http:// and private addresses for screenshot links: only for local development. */
  allowPrivateUrls: text("ALLOW_PRIVATE_URLS") === "true",
};
