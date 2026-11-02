// The whole job, shared by the paid service and the local CLI: read the repository, load the 5 screenshots, write
// the copy, pick the palette, render every requested style and size, and save the images.

import { writeCopy, type Copy } from "./lib/copywriter.js";
import { readRepository, type RepoContext } from "./lib/github.js";
import { loadScreenshot, type ScreenshotInput } from "./lib/images.js";
import { buildPalette, isHex, mostColorful, type Palette, type Theme } from "./lib/palette.js";
import { DEFAULT_SIZES, SIZES, type SizeId } from "./lib/sizes.js";
import { fileUrl, newFolder, saveFile } from "./lib/storage.js";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderSet } from "./render/renderer.js";
import type { Style } from "./render/templates.js";

export interface GenerateInput {
  repository: string;
  screenshots: ScreenshotInput[];
  styles?: Style[];
  sizes?: SizeId[];
  format?: "png" | "jpeg";
  theme?: Theme;
  brandColor?: string;
  appName?: string;
  headlines?: string[];
  subheadlines?: string[];
  language?: string;
}

export interface GeneratedImage {
  style: Style;
  size: SizeId;
  index: number;
  width: number;
  height: number;
  url: string;
}

export interface GenerateOutput {
  app: { name: string; tagline: string; platform: string; repository: string };
  copy: { headline: string; subheadline: string }[];
  palette: { theme: string; brand: string; accent: string };
  images: GeneratedImage[];
  archiveUrl: string;
  copySource: string;
}

export interface GenerateContext {
  /** The public origin image links start with. Without one (the local CLI), links are file:// URLs. */
  origin?: string;
  signal?: AbortSignal;
  log?: (message: string) => void;
}

function choosePalette(input: GenerateInput, repo: RepoContext, copy: Copy, dominants: string[]): Palette {
  const brand = (isHex(input.brandColor) && input.brandColor) || copy.brandColor || repo.colors[0] || mostColorful(dominants) || "#6c5ce7";
  const theme: Theme = input.theme && input.theme !== "auto" ? input.theme : (copy.theme ?? "auto");
  return buildPalette(brand, theme, copy.accentColor);
}

export async function generate(input: GenerateInput, context: GenerateContext): Promise<GenerateOutput> {
  const log = context.log ?? (() => undefined);
  const signal = context.signal;
  if (input.screenshots.length !== 5) throw new Error("exactly 5 screenshots are needed");

  const repo = await readRepository(input.repository, signal);
  log(`repository: ${repo.owner}/${repo.repo} (${repo.read ? repo.platform : "not readable, using its name"})`);
  const shots = await Promise.all(input.screenshots.map((shot) => loadScreenshot(shot, repo, signal)));
  log(`screenshots: ${shots.map((s) => `${s.width}x${s.height}`).join(", ")}`);

  const copy = await writeCopy({
    repo,
    thumbnails: shots.map((s) => s.thumbnail),
    language: input.language ?? "en",
    ...(input.appName ? { appName: input.appName } : {}),
    ...(input.headlines ? { headlines: input.headlines } : {}),
    ...(input.subheadlines ? { subheadlines: input.subheadlines } : {}),
    ...(signal ? { signal } : {}),
  });
  log(`copy (${copy.source}): ${copy.slides.map((s) => s.headline).join(" | ")}`);
  const palette = choosePalette(input, repo, copy, shots.map((s) => s.dominant));
  log(`palette: ${palette.theme} ${palette.brand}`);

  const styles: Style[] = input.styles?.length ? [...new Set(input.styles)] : ["panoramic", "3d"];
  const sizes: SizeId[] = input.sizes?.length ? [...new Set(input.sizes)] : DEFAULT_SIZES;
  const format = input.format ?? "png";
  const extension = format === "jpeg" ? "jpg" : "png";
  const folder = await newFolder();
  const link = (file: string) => (context.origin ? fileUrl(context.origin, folder, file) : pathToFileURL(join(folder.path, file)).href);
  const pageShots = shots.map((s) => ({ src: `data:image/png;base64,${s.png.toString("base64")}`, width: s.width, height: s.height }));

  const images: GeneratedImage[] = [];
  for (const sizeId of sizes) {
    const size = SIZES[sizeId];
    for (const style of styles) {
      signal?.throwIfAborted();
      const started = Date.now();
      const rendered = await renderSet({ style, size, palette, appName: copy.appName, slides: copy.slides, shots: pageShots }, { format, ...(signal ? { signal } : {}) });
      for (const [i, bytes] of rendered.entries()) {
        const file = `${style}-${sizeId}-${i + 1}.${extension}`;
        await saveFile(folder, file, bytes);
        images.push({ style, size: sizeId, index: i + 1, width: size.width, height: size.height, url: link(file) });
      }
      log(`rendered ${style} ${sizeId} in ${Date.now() - started} ms`);
    }
  }

  const output: GenerateOutput = {
    app: { name: copy.appName, tagline: copy.tagline, platform: repo.platform, repository: repo.url },
    copy: copy.slides,
    palette: { theme: palette.theme, brand: palette.brand, accent: palette.accent },
    images,
    archiveUrl: context.origin ? link("screenshots.zip") : pathToFileURL(folder.path).href,
    copySource: copy.source,
  };
  await saveFile(folder, "result.json", JSON.stringify(output, null, 2));
  return output;
}
