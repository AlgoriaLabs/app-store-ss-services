// app-store-screenshots: the paid service. Charged only if it succeeds ("on-success"), so a buyer whose links don't
// load, or whose job fails for any other reason, pays nothing. Its description, schemas and example are what agents
// read before they pay: keep them in step with src/generate.ts.

import { defineService } from "@stellar-agent-services/provider-kit";
import { generate, type GenerateInput } from "../generate.js";
import { config } from "../lib/config.js";
import { HEADLINE_MAX, SUBHEADLINE_MAX } from "../lib/copywriter.js";
import { SIZE_IDS } from "../lib/sizes.js";

const screenshot = {
  type: "object",
  description: "One app screenshot, portrait, as captured on the device. Give exactly one of url, path or data.",
  properties: {
    url: { type: "string", format: "uri", maxLength: 2048, description: "An HTTPS link to a PNG, JPEG, WebP or HEIC image" },
    path: { type: "string", minLength: 1, maxLength: 300, pattern: "^[^/.][^\\\\]*$", description: "A path inside the repository, such as docs/screens/home.png" },
    data: { type: "string", minLength: 100, maxLength: 2_600_000, description: "The image as base64, optionally as a data: URL. Links are preferred: the whole request is limited to 10 MiB." },
  },
  additionalProperties: false,
  anyOf: [{ required: ["url"] }, { required: ["path"] }, { required: ["data"] }],
};

export function appStoreScreenshots(origin: string) {
  return defineService({
    name: "app-store-screenshots",
    title: "App Store screenshots: panoramic and 3D",
    description:
      "Makes App Store screenshot sets for a mobile app from its public GitHub repository and 5 app screenshots. " +
      "It reads the repository to write a headline for each screen and pick the brand colors, then renders a panoramic set " +
      "(one background flowing across all five images) and a 3D set (tilted device mockups), as PNG or JPEG without " +
      "transparency in App Store Connect's sizes: 6.9-inch and 6.3-inch iPhone by default, also 6.5-inch, 5.5-inch and " +
      "13-inch iPad. Returns links to every image and a zip, kept for 7 days. Headlines, colors and theme can be set. " +
      "It does not upload to App Store Connect or change the screenshots' content.",
    price: config.price,
    charge: "on-success",
    expectedDurationSeconds: 75,
    timeoutSeconds: 240,
    maxInputBytes: 10 * 1024 * 1024,
    capacity: { concurrency: config.concurrency, maxQueued: 20, maxQueueWaitSeconds: 60 },
    tags: ["app-store", "screenshots", "mockup", "ios", "iphone", "ipad", "aso", "image-generation", "3d", "panoramic"],
    inputSchema: {
      type: "object",
      required: ["repository", "screenshots"],
      properties: {
        repository: {
          type: "string",
          format: "uri",
          maxLength: 200,
          pattern: "^https://github\\.com/[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}/?$",
          description: "The app's public GitHub repository, such as https://github.com/owner/app",
        },
        screenshots: { type: "array", minItems: 5, maxItems: 5, items: screenshot, description: "Exactly 5 screenshots, in the order they should appear" },
        styles: {
          type: "array",
          minItems: 1,
          maxItems: 2,
          items: { type: "string", enum: ["panoramic", "3d"] },
          default: ["panoramic", "3d"],
          description: "Which sets to make",
        },
        sizes: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: { type: "string", enum: [...SIZE_IDS] },
          default: ["iphone-6.9", "iphone-6.3"],
          description: "App Store Connect display sizes. iphone-6.9 is 1320x2868, iphone-6.5 1284x2778, iphone-6.3 1206x2622, iphone-5.5 1242x2208, ipad-13 2064x2752.",
        },
        format: { type: "string", enum: ["png", "jpeg"], default: "png" },
        theme: { type: "string", enum: ["auto", "vibrant", "dark", "light"], default: "auto" },
        brandColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$", description: "Overrides the brand color found in the repository" },
        appName: { type: "string", minLength: 1, maxLength: 30 },
        headlines: { type: "array", maxItems: 5, items: { type: "string", maxLength: HEADLINE_MAX }, description: "Your own headlines, by screen; empty strings keep the written ones" },
        subheadlines: { type: "array", maxItems: 5, items: { type: "string", maxLength: SUBHEADLINE_MAX } },
        language: { type: "string", pattern: "^[a-z]{2,3}(-[A-Za-z]{2,4})?$", default: "en", description: "Language of the written headlines, as a BCP 47 tag" },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["app", "copy", "palette", "images", "archiveUrl", "copySource"],
      properties: {
        app: {
          type: "object",
          required: ["name", "tagline", "platform", "repository"],
          properties: { name: { type: "string" }, tagline: { type: "string" }, platform: { type: "string" }, repository: { type: "string" } },
        },
        copy: {
          type: "array",
          items: { type: "object", required: ["headline", "subheadline"], properties: { headline: { type: "string" }, subheadline: { type: "string" } } },
        },
        palette: { type: "object", required: ["theme", "brand", "accent"], properties: { theme: { type: "string" }, brand: { type: "string" }, accent: { type: "string" } } },
        images: {
          type: "array",
          items: {
            type: "object",
            required: ["style", "size", "index", "width", "height", "url"],
            properties: {
              style: { type: "string", enum: ["panoramic", "3d"] },
              size: { type: "string", enum: [...SIZE_IDS] },
              index: { type: "integer", minimum: 1, maximum: 5 },
              width: { type: "integer" },
              height: { type: "integer" },
              url: { type: "string", format: "uri" },
            },
          },
        },
        archiveUrl: { type: "string", format: "uri", description: "All images in one zip" },
        copySource: { type: "string", description: "model:<id> when a model wrote the headlines, repository when they came from the README" },
      },
    },
    examples: [
      {
        input: {
          repository: "https://github.com/example/habit-tracker",
          screenshots: [
            { url: "https://example.com/shots/1.png" },
            { url: "https://example.com/shots/2.png" },
            { url: "https://example.com/shots/3.png" },
            { path: "docs/screens/stats.png" },
            { path: "docs/screens/settings.png" },
          ],
          styles: ["panoramic", "3d"],
          sizes: ["iphone-6.9"],
        },
        output: {
          app: { name: "Habit Tracker", tagline: "Build habits that stick", platform: "Flutter", repository: "https://github.com/example/habit-tracker" },
          copy: [
            { headline: "Build habits that stick", subheadline: "Tiny daily wins, tracked in one tap" },
            { headline: "See your streaks grow", subheadline: "" },
            { headline: "Gentle reminders", subheadline: "Nudges at the time that suits you" },
            { headline: "Know your progress", subheadline: "Weekly and monthly stats" },
            { headline: "Make it yours", subheadline: "Themes, icons and goals" },
          ],
          palette: { theme: "vibrant", brand: "#5b5bd6", accent: "#c05bd6" },
          images: [
            { style: "panoramic", size: "iphone-6.9", index: 1, width: 1320, height: 2868, url: `${origin}/files/AAAAAAAAAAAAAAAAAAAAAA/panoramic-iphone-6.9-1.png` },
            { style: "3d", size: "iphone-6.9", index: 1, width: 1320, height: 2868, url: `${origin}/files/AAAAAAAAAAAAAAAAAAAAAA/3d-iphone-6.9-1.png` },
          ],
          archiveUrl: `${origin}/files/AAAAAAAAAAAAAAAAAAAAAA/screenshots.zip`,
          copySource: "model:gemini-3.1-flash-lite",
        },
      },
    ],
    handler: async (input, { signal }) => (await generate(input as unknown as GenerateInput, { origin, signal })) as never,
  });
}
