// Loads the 5 screenshots a client sends, as links, repository paths or base64, and normalizes them: decoded and
// checked by sharp (so a file that only claims to be an image is refused), rotated upright, capped in size, and
// re-encoded as PNG. It also makes the small JPEG thumbnails the copywriter's vision model sees, and the dominant
// color of each screen for the palette.

import sharp from "sharp";
import { config } from "./config.js";
import { readRepositoryFile, type RepoContext } from "./github.js";
import { safeFetch } from "./safe-fetch.js";

export type ScreenshotInput = { url: string } | { path: string } | { data: string };

export interface Screenshot {
  png: Buffer;
  width: number;
  height: number;
  /** JPEG, at most 512 px tall, as a data URL. */
  thumbnail: string;
  dominant: string;
}

const LONGEST_SIDE = 3000;

async function bytesOf(input: ScreenshotInput, repo: RepoContext, signal?: AbortSignal): Promise<Buffer> {
  if ("data" in input) {
    const base64 = input.data.replace(/^data:image\/[a-z+.-]+;base64,/i, "");
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length === 0) throw new Error("a screenshot's data is not base64");
    return bytes;
  }
  if ("path" in input) return readRepositoryFile(repo, repo.defaultBranch, input.path, config.maxImageBytes, signal);
  const fetched = await safeFetch(input.url, { maxBytes: config.maxImageBytes, ...(signal ? { signal } : {}) });
  return fetched.bytes;
}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

export async function loadScreenshot(input: ScreenshotInput, repo: RepoContext, signal?: AbortSignal): Promise<Screenshot> {
  const bytes = await bytesOf(input, repo, signal);
  const image = sharp(bytes, { limitInputPixels: config.maxImagePixels, failOn: "error" }).rotate();
  const meta = await image.metadata();
  if (!meta.format || !["png", "jpeg", "webp", "heif", "avif", "gif", "tiff"].includes(meta.format)) {
    throw new Error(`unsupported screenshot format: ${meta.format ?? "unknown"}`);
  }
  const resized = image.resize({ width: LONGEST_SIDE, height: LONGEST_SIDE, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" });
  const { data: png, info } = await resized.png({ compressionLevel: 6 }).toBuffer({ resolveWithObject: true });
  const [thumb, stats] = await Promise.all([
    sharp(png).resize({ height: 512, fit: "inside" }).jpeg({ quality: 70 }).toBuffer(),
    sharp(png).stats(),
  ]);
  return {
    png,
    width: info.width,
    height: info.height,
    thumbnail: `data:image/jpeg;base64,${thumb.toString("base64")}`,
    dominant: hex(stats.dominant.r, stats.dominant.g, stats.dominant.b),
  };
}
