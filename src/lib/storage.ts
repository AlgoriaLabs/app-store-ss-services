// Keeps rendered images on disk and serves them: GET /files/<folder>/<file>, and GET /files/<folder>/screenshots.zip
// for all of a job's images in one download, zipped as it streams.
//
// Each job writes to a folder with a random 128-bit name, so a link can't be guessed from a job id. Folders are
// deleted once they are older than the jobs' retention (RETENTION_SECONDS): image links in a result stay valid as
// long as the result itself [S8].

import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Zip, ZipPassThrough } from "fflate";
import { config } from "./config.js";

const FOLDER = /^[A-Za-z0-9_-]{22}$/;
const FILE = /^[a-z0-9._-]{1,80}\.(png|jpg|json)$/;

export interface JobFolder {
  name: string;
  path: string;
}

export async function newFolder(): Promise<JobFolder> {
  const name = randomBytes(16).toString("base64url");
  const path = join(config.outputDir, name);
  await mkdir(path, { recursive: true });
  return { name, path };
}

export async function saveFile(folder: JobFolder, file: string, bytes: Buffer | string): Promise<void> {
  if (!FILE.test(file)) throw new Error(`bad file name: ${file}`);
  await writeFile(join(folder.path, file), bytes);
}

export function fileUrl(origin: string, folder: JobFolder, file: string): string {
  return `${origin}/files/${folder.name}/${file}`;
}

/** Deletes job folders older than the retention period, plus an hour's margin. */
export async function sweep(): Promise<number> {
  const limit = Date.now() - (config.retentionSeconds + 3600) * 1000;
  let removed = 0;
  let names: string[] = [];
  try {
    names = await readdir(config.outputDir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!FOLDER.test(name)) continue;
    const path = join(config.outputDir, name);
    const info = await stat(path).catch(() => undefined);
    if (info && info.mtimeMs < limit) {
      await rm(path, { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}

export function startSweeper(): NodeJS.Timeout {
  void sweep();
  const timer = setInterval(() => void sweep().catch((error) => console.warn("[storage] sweep failed:", error)), 3600_000);
  timer.unref();
  return timer;
}

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", json: "application/json" };

/** Answers GET /files/..., or undefined if the path isn't one. */
export async function serveFile(pathname: string): Promise<Response | undefined> {
  const match = /^\/files\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!match) return undefined;
  const [, folderName, file] = match as unknown as [string, string, string];
  const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400, immutable", "X-Content-Type-Options": "nosniff" };
  if (!FOLDER.test(folderName)) return new Response("Not found", { status: 404 });
  const folder = join(config.outputDir, folderName);

  if (file === "screenshots.zip") {
    const names = (await readdir(folder).catch(() => [] as string[])).filter((name) => FILE.test(name) && !name.endsWith(".json")).sort();
    if (names.length === 0) return new Response("Not found", { status: 404 });
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const zip = new Zip((error, chunk, final) => {
          if (error) return controller.error(error);
          controller.enqueue(chunk);
          if (final) controller.close();
        });
        for (const name of names) {
          // Images are already compressed: store them as they are.
          const entry = new ZipPassThrough(name.replace(/^(panoramic|3d)-/, "$1/"));
          zip.add(entry);
          for await (const chunk of createReadStream(join(folder, name))) entry.push(chunk as Uint8Array);
          entry.push(new Uint8Array(0), true);
        }
        zip.end();
      },
    });
    return new Response(stream, { headers: { ...headers, "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="app-store-screenshots.zip"' } });
  }

  if (!FILE.test(file)) return new Response("Not found", { status: 404 });
  const path = join(folder, file);
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) return new Response("Not found", { status: 404 });
  const extension = file.slice(file.lastIndexOf(".") + 1);
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, {
    headers: { ...headers, "Content-Type": TYPES[extension] ?? "application/octet-stream", "Content-Length": String(info.size) },
  });
}
