// Makes a screenshot set on this computer, with no server and no payment: for trying designs and for your own apps.
//
//   npm run generate -- --repo https://github.com/owner/app \
//     --shot 1.png --shot 2.png --shot 3.png --shot 4.png --shot 5.png \
//     [--style panoramic|3d] [--size iphone-6.9] [--format png|jpeg] [--theme auto|vibrant|dark|light]
//     [--brand #5b5bd6] [--name "My App"] [--headline "..." x5] [--language en] [--out ./out]
//
// A --shot is a local file, an https:// link, or repo:<path> for a file in the repository. Images land in --out
// (default ./out), in a new folder per run.

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    shot: { type: "string", multiple: true },
    style: { type: "string", multiple: true },
    size: { type: "string", multiple: true },
    format: { type: "string" },
    theme: { type: "string" },
    brand: { type: "string" },
    name: { type: "string" },
    headline: { type: "string", multiple: true },
    language: { type: "string" },
    out: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help || !values.repo || (values.shot?.length ?? 0) !== 5) {
  console.log(
    "Usage: npm run generate -- --repo https://github.com/owner/app --shot 1.png --shot 2.png --shot 3.png --shot 4.png --shot 5.png [--style panoramic|3d] [--size iphone-6.9] [--format png|jpeg] [--theme auto|vibrant|dark|light] [--brand #rrggbb] [--name NAME] [--headline TEXT x5] [--language en] [--out DIR]",
  );
  process.exit(values.help ? 0 : 1);
}

process.env["OUTPUT_DIR"] = values.out ?? "./out";
const { generate } = await import("./generate.js");
const { closeRenderer } = await import("./render/renderer.js");

const screenshots = await Promise.all(
  values.shot!.map(async (shot) => {
    if (/^https?:\/\//.test(shot)) return { url: shot };
    if (shot.startsWith("repo:")) return { path: shot.slice("repo:".length) };
    return { data: (await readFile(shot)).toString("base64") };
  }),
);

const started = Date.now();
try {
  const result = await generate(
    {
      repository: values.repo,
      screenshots,
      ...(values.style ? { styles: values.style as never } : {}),
      ...(values.size ? { sizes: values.size as never } : {}),
      ...(values.format ? { format: values.format as "png" | "jpeg" } : {}),
      ...(values.theme ? { theme: values.theme as never } : {}),
      ...(values.brand ? { brandColor: values.brand } : {}),
      ...(values.name ? { appName: values.name } : {}),
      ...(values.headline ? { headlines: values.headline } : {}),
      ...(values.language ? { language: values.language } : {}),
    },
    { log: (message) => console.log(`  ${message}`) },
  );
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)} s: ${result.images.length} images in ${new URL(result.archiveUrl).pathname}`);
} finally {
  await closeRenderer();
}
