// Offline unit tests: repository URL parsing, color extraction, README headlines, the palette's contrast, text
// clamping, HTML escaping and the SSRF guard. `npm test` runs them; none touches the network.

import assert from "node:assert/strict";
import { test } from "node:test";
import { clamp, fromReadme, HEADLINE_MAX } from "../lib/copywriter.js";
import { extractColors, parseRepoUrl, type RepoContext } from "../lib/github.js";
import { buildPalette, contrast } from "../lib/palette.js";
import { FetchRefused, safeFetch } from "../lib/safe-fetch.js";
import { escapeHtml, pageHtml } from "../render/templates.js";
import { SIZES } from "../lib/sizes.js";

const repo = (readme: string): RepoContext => ({
  owner: "acme",
  repo: "habit-hero",
  url: "https://github.com/acme/habit-hero",
  defaultBranch: "main",
  name: "habit-hero",
  description: "Track habits with streaks",
  topics: [],
  platform: "Flutter",
  readme,
  colors: [],
  files: [],
  read: true,
});

test("parses GitHub repository URLs and refuses others", () => {
  assert.deepEqual(parseRepoUrl("https://github.com/acme/habit-hero"), { owner: "acme", repo: "habit-hero" });
  assert.deepEqual(parseRepoUrl("https://github.com/acme/app.git"), { owner: "acme", repo: "app" });
  assert.throws(() => parseRepoUrl("https://gitlab.com/acme/app"));
  assert.throws(() => parseRepoUrl("https://github.com/acme"));
});

test("extracts brand colors, skipping grays", () => {
  assert.deepEqual(extractColors('primary: "#6C5CE7", bg: "#ffffff", gray: "#808080", Color(0xFF00B894), "#6c5ce7"'), ["#6c5ce7", "#00b894"]);
});

test("takes headlines from a README's feature list", () => {
  const slides = fromReadme(repo("# Habit Hero\n\n## Features\n- **Streaks** - keep the chain going\n- Reminders: never forget\n- Stats\n\n## Install\n- run flutter pub get"));
  assert.equal(slides.length, 5);
  assert.equal(slides[0]!.headline, "Meet Habit Hero");
  assert.equal(slides[1]!.headline, "Streaks");
  assert.equal(slides[1]!.subheadline, "keep the chain going");
  assert.equal(slides[2]!.headline, "Reminders");
  for (const slide of slides) assert.ok(slide.headline.length <= HEADLINE_MAX);
});

test("clamps at a word boundary", () => {
  assert.equal(clamp("Build habits that really stick around forever", 20), "Build habits that");
  assert.equal(clamp("a\u0000b", 10), "a b");
});

test("palettes keep text readable", () => {
  for (const brand of ["#6c5ce7", "#ffd400", "#0f766e", "#111111", "#ff3b30"]) {
    for (const theme of ["vibrant", "dark", "light"] as const) {
      const palette = buildPalette(brand, theme);
      assert.ok(contrast(palette.text, palette.background[0]) >= 3, `${brand} ${theme}: ${palette.text} on ${palette.background[0]}`);
    }
  }
});

test("escapes text in the page", () => {
  assert.equal(escapeHtml('<img src=x onerror="a">'), "&lt;img src=x onerror=&quot;a&quot;&gt;");
  const html = pageHtml({
    style: "3d",
    size: SIZES["iphone-6.9"],
    palette: buildPalette("#6c5ce7", "auto"),
    appName: "<b>",
    slides: Array.from({ length: 5 }, () => ({ headline: "<script>alert(1)</script>", subheadline: "" })),
    shots: Array.from({ length: 5 }, () => ({ src: "data:image/png;base64,AA==", width: 1179, height: 2556 })),
  });
  assert.ok(!html.includes("<script>"));
});

test("refuses private and non-https links", async () => {
  await assert.rejects(safeFetch("http://example.com/a.png", { maxBytes: 10 }), FetchRefused);
  await assert.rejects(safeFetch("https://127.0.0.1/a.png", { maxBytes: 10 }), FetchRefused);
  await assert.rejects(safeFetch("https://[::1]/a.png", { maxBytes: 10 }), FetchRefused);
  await assert.rejects(safeFetch("https://user:pass@example.com/a.png", { maxBytes: 10 }), FetchRefused);
});
