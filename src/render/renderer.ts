// Draws a screenshot set in headless Chromium and cuts it into 5 App Store images.
//
// One browser is shared by every job and started on first use; each set gets its own page, 5 screenshots wide. The
// page may not load anything: every request is aborted, so client text and images can't reach the network. Chromium
// draws PNGs with an alpha channel, which App Store Connect refuses, so sharp flattens each image to RGB.

import { chromium, type Browser } from "playwright-core";
import sharp from "sharp";
import { pageHtml, type PageInput } from "./templates.js";

let browser: Promise<Browser> | undefined;
let idleTimer: NodeJS.Timeout | undefined;
let pagesOpen = 0;

function getBrowser(): Promise<Browser> {
  if (idleTimer) clearTimeout(idleTimer);
  browser ??= chromium
    .launch({
      ...(process.env["CHROMIUM_PATH"] ? { executablePath: process.env["CHROMIUM_PATH"] } : {}),
      args: ["--disable-dev-shm-usage", "--font-render-hinting=none", "--force-gpu-mem-available-mb=2048"],
    })
    .then((launched) => {
      launched.on("disconnected", () => {
        browser = undefined;
      });
      return launched;
    })
    .catch((error) => {
      browser = undefined;
      throw error;
    });
  return browser;
}

/** Closes the browser after a minute with nothing to draw, to give the memory back. */
function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pagesOpen === 0 && browser) {
      const closing = browser;
      browser = undefined;
      void closing.then((b) => b.close()).catch(() => undefined);
    }
  }, 60_000);
  idleTimer.unref();
}

export async function closeRenderer(): Promise<void> {
  if (browser) await (await browser).close().catch(() => undefined);
  browser = undefined;
}

export interface RenderOptions {
  format: "png" | "jpeg";
  signal?: AbortSignal;
}

export async function renderSet(input: PageInput, options: RenderOptions): Promise<Buffer[]> {
  const { width, height } = input.size;
  const instance = await getBrowser();
  pagesOpen++;
  const context = await instance.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    const abort = () => void context.close().catch(() => undefined);
    options.signal?.addEventListener("abort", abort, { once: true });
    await page.setContent(pageHtml(input), { waitUntil: "load", timeout: 60_000 });
    // The page has no scripts of its own (all text is escaped); this only waits for the inlined fonts.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const out: Buffer[] = [];
    for (let i = 0; i < 5; i++) {
      options.signal?.throwIfAborted();
      // One screenshot-sized viewport, with the 5-wide layout moved under it: Chromium only rasterizes what is in
      // view, which keeps 3D layers within its tile memory (a 5-wide viewport dropped tiles) and is much faster.
      await page.evaluate((x) => {
        document.getElementById("world")!.style.transform = `translateX(${-x}px)`;
      }, i * width);
      const shot = await page.screenshot({ type: "png", animations: "disabled", timeout: 60_000 });
      const flat = sharp(shot).removeAlpha().toColourspace("srgb");
      out.push(options.format === "jpeg" ? await flat.jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer() : await flat.png({ compressionLevel: 8 }).toBuffer());
    }
    options.signal?.removeEventListener("abort", abort);
    return out;
  } finally {
    await context.close().catch(() => undefined);
    pagesOpen--;
    scheduleIdleClose();
  }
}
