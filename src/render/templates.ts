// The HTML each screenshot set is drawn from. One page lays out all 5 screenshots side by side (5 × width) inside
// #world; the renderer's viewport is one screenshot wide and slides #world across it to capture each of the 5:
//
// - "panoramic": one continuous background, ribbon and glow across all 5, so they read as one wide image when the App
//   Store shows them in a row. Devices fan out in 3D, and two of them cross into the next screenshot.
// - "3d": 5 standalone screenshots, each with a device extruded in real CSS 3D (stacked layers give it thickness),
//   tilted a different way on each.
//
// Devices are generic phone and tablet frames drawn in CSS, not any manufacturer's artwork. All text is escaped, and
// the page loads nothing from the network: images and fonts are inlined.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { SlideCopy } from "../lib/copywriter.js";
import type { Palette } from "../lib/palette.js";
import type { StoreSize } from "../lib/sizes.js";

export type Style = "panoramic" | "3d";

export interface Shot {
  src: string;
  width: number;
  height: number;
}

export interface PageInput {
  style: Style;
  size: StoreSize;
  palette: Palette;
  appName: string;
  slides: SlideCopy[];
  shots: Shot[];
}

const require = createRequire(import.meta.url);

let fontCss: string | undefined;
/** Inter 600 and 800, latin and latin-ext, inlined. Other scripts fall back to the system's Noto fonts. */
function fonts(): string {
  if (fontCss) return fontCss;
  const faces: string[] = [];
  for (const weight of [600, 800]) {
    for (const subset of ["latin", "latin-ext"]) {
      const file = require.resolve(`@fontsource/inter/files/inter-${subset}-${weight}-normal.woff2`);
      const data = readFileSync(file).toString("base64");
      faces.push(`@font-face{font-family:"Inter";font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2");}`);
    }
  }
  fontCss = faces.join("\n");
  return fontCss;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const px = (value: number) => `${Math.round(value * 100) / 100}px`;

interface Pose {
  /** Center x, in widths from the page's left edge. */
  cx: number;
  /** Top, in heights. */
  top: number;
  /** Scale of the device against the standard size. */
  scale: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
}

const PANORAMIC_POSES: Pose[] = [
  { cx: 0.52, top: 0.3, scale: 1, rotateX: 6, rotateY: 20, rotateZ: -2 },
  { cx: 1.73, top: 0.335, scale: 0.97, rotateX: 5, rotateY: -26, rotateZ: 3 },
  { cx: 2.5, top: 0.295, scale: 1.04, rotateX: 4, rotateY: 0, rotateZ: 0 },
  { cx: 3.27, top: 0.335, scale: 0.97, rotateX: 5, rotateY: 26, rotateZ: -3 },
  { cx: 4.48, top: 0.3, scale: 1, rotateX: 6, rotateY: -20, rotateZ: 2 },
];

const STANDALONE_POSES: Pose[] = [
  { cx: 0.52, top: 0.3, scale: 1.02, rotateX: 9, rotateY: -24, rotateZ: 5 },
  { cx: 0.48, top: 0.31, scale: 1, rotateX: 7, rotateY: 22, rotateZ: -4 },
  { cx: 0.52, top: 0.3, scale: 1, rotateX: 11, rotateY: -16, rotateZ: 3 },
  { cx: 0.47, top: 0.31, scale: 1, rotateX: 6, rotateY: 26, rotateZ: -5 },
  { cx: 0.52, top: 0.3, scale: 1.02, rotateX: 8, rotateY: -21, rotateZ: 4 },
];

function device(shot: Shot, pose: Pose, size: StoreSize, palette: Palette, offsetX: number): string {
  const W = size.width;
  const H = size.height;
  const aspect = shot.height / shot.width;
  const phone = aspect >= 1.6;
  const bezel = phone ? 0.034 : 0.026;
  // The device's total height over its width.
  const outerAspect = (aspect * (1 - 2 * bezel) + 2 * bezel);
  const maxHeight = 0.67 * H;
  const maxWidth = (phone ? 0.68 : 0.8) * W;
  const width = Math.min(maxWidth, maxHeight / outerAspect) * pose.scale;
  const height = width * outerAspect;
  const pad = width * bezel;
  const radius = width * (phone ? 0.145 : 0.05);
  const screenRadius = Math.max(radius - pad, 4);
  const depth = Math.max(10, width * (phone ? 0.05 : 0.025));
  const left = offsetX + pose.cx * W - width / 2;
  const top = pose.top * H;

  const layers: string[] = [];
  const steps = 8;
  for (let i = steps; i >= 1; i--) {
    const z = -(depth * i) / steps;
    const shade = i === steps ? 0.75 : 0.55 + (0.25 * (steps - i)) / steps;
    layers.push(`<div class="slab" style="transform:translateZ(${px(z)});filter:brightness(${shade.toFixed(2)})"></div>`);
  }
  const islandWidth = (width - 2 * pad) * 0.3;
  const islandHeight = (width - 2 * pad) * 0.088;
  const island = phone && aspect >= 1.95 ? `<div class="island" style="width:${px(islandWidth)};height:${px(islandHeight)};top:${px(pad + (width - 2 * pad) * 0.028)}"></div>` : "";
  const button = (side: "l" | "r", y: number, h: number) =>
    `<div class="btn" style="${side === "l" ? "left" : "right"}:${px(-width * 0.008)};top:${px(height * y)};height:${px(height * h)};width:${px(width * 0.014)};transform:translateZ(${px(-depth / 2)})"></div>`;
  const buttons = phone ? button("l", 0.17, 0.045) + button("l", 0.25, 0.08) + button("l", 0.345, 0.08) + button("r", 0.27, 0.12) : button("r", 0.06, 0.06);
  const transform = `rotateX(${pose.rotateX}deg) rotateY(${pose.rotateY}deg) rotateZ(${pose.rotateZ}deg)`;
  const shadowWidth = width * (1.05 - Math.abs(pose.rotateY) / 140);
  return `
  <div class="shadow" style="left:${px(left + width / 2 - shadowWidth / 2 + (pose.rotateY > 0 ? -1 : 1) * width * 0.06)};top:${px(top + height * 0.9)};width:${px(shadowWidth)};height:${px(width * 0.2)}"></div>
  <div class="stage" style="left:${px(left)};top:${px(top)};width:${px(width)};height:${px(height)};perspective:${px(width * 4.2)}">
    <div class="device" style="width:${px(width)};height:${px(height)};transform:${transform};--r:${px(radius)};--frame:${palette.frame}">
      ${layers.join("")}
      ${buttons}
      <div class="front" style="padding:${px(pad)};box-shadow:inset 0 0 0 ${px(width * 0.006)} #6b707c, inset 0 0 0 ${px(width * 0.011)} #0a0b0e, 0 0 0 ${px(width * 0.003)} rgba(255,255,255,.08)">
        <div class="screen" style="border-radius:${px(screenRadius)}">
          <img src="${shot.src}" alt="">
          <div class="glare"></div>
        </div>
        ${island}
      </div>
    </div>
  </div>`;
}

function text(copy: SlideCopy, index: number, appName: string, size: StoreSize, palette: Palette, offsetX: number): string {
  const W = size.width;
  const H = size.height;
  const base = Math.min(W, H * 0.62);
  const headline = base * 0.088;
  const sub = base * 0.043;
  const label = index === 0 && appName ? `<div class="label" style="font-size:${px(base * 0.034)};margin-bottom:${px(base * 0.03)};padding:${px(base * 0.012)} ${px(base * 0.032)}">${escapeHtml(appName)}</div>` : "";
  return `
  <div class="copy" style="left:${px(offsetX + W * 0.08)};top:${px(H * 0.07)};width:${px(W * 0.84)};height:${px(H * 0.2)};color:${palette.text}">
    ${label}
    <div class="headline" dir="auto" style="font-size:${px(headline)}">${escapeHtml(copy.headline)}</div>
    ${copy.subheadline ? `<div class="sub" dir="auto" style="font-size:${px(sub)};margin-top:${px(base * 0.03)};color:${palette.subtext}">${escapeHtml(copy.subheadline)}</div>` : ""}
  </div>`;
}

function panoramicBackground(size: StoreSize, palette: Palette): string {
  const W = size.width;
  const H = size.height;
  const total = W * 5;
  const [b0, b1, b2] = palette.background;
  const blobs = [0.15, 1.05, 2.0, 2.95, 3.9, 4.8]
    .map((x, i) => {
      const r = W * (0.55 + (i % 2) * 0.15);
      const y = H * (i % 2 === 0 ? 0.78 : 0.42);
      const color = i % 2 === 0 ? palette.glow : palette.accent;
      return `<div class="blob" style="left:${px(x * W - r)};top:${px(y - r)};width:${px(2 * r)};height:${px(2 * r)};background:radial-gradient(circle, ${color} 0%, transparent 68%);opacity:${palette.theme === "light" ? 0.45 : 0.55}"></div>`;
    })
    .join("");
  // A ribbon that flows through all five, so the row reads as one image.
  const points: string[] = [];
  for (let i = 0; i <= 10; i++) {
    const x = (total * i) / 10;
    const y = H * (0.6 + 0.13 * Math.sin(i * 1.15));
    points.push(`${i === 0 ? "M" : "S"} ${x.toFixed(1)} ${y.toFixed(1)}${i === 0 ? "" : ` ${(x + total / 40).toFixed(1)} ${(y + H * 0.02).toFixed(1)}`}`);
  }
  const path = points.join(" ");
  return `
  <div class="bg" style="width:${px(total)};height:${px(H)};background:linear-gradient(100deg, ${b0} 0%, ${b1} 30%, ${b2} 55%, ${b1} 78%, ${b0} 100%)"></div>
  ${blobs}
  <svg class="ribbon" width="${total}" height="${H}" viewBox="0 0 ${total} ${H}">
    <defs><linearGradient id="rg" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.0"/>
      <stop offset="0.15" stop-color="${palette.accent}" stop-opacity="0.55"/>
      <stop offset="0.5" stop-color="${palette.glow}" stop-opacity="0.6"/>
      <stop offset="0.85" stop-color="${palette.accent}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${palette.accent}" stop-opacity="0.0"/>
    </linearGradient></defs>
    <path d="${path}" fill="none" stroke="url(#rg)" stroke-width="${(W * 0.16).toFixed(0)}" stroke-linecap="round" opacity="0.5"/>
    <path d="${path}" fill="none" stroke="${palette.text}" stroke-opacity="0.22" stroke-width="${(W * 0.006).toFixed(1)}" transform="translate(0 ${(-H * 0.07).toFixed(0)})"/>
    <path d="${path}" fill="none" stroke="${palette.text}" stroke-opacity="0.12" stroke-width="${(W * 0.004).toFixed(1)}" transform="translate(0 ${(H * 0.09).toFixed(0)})"/>
  </svg>
  ${dots(total, H, palette, 0)}`;
}

/** A few soft dots, placed the same way every time for the same size. */
function dots(width: number, height: number, palette: Palette, seed: number): string {
  let state = 7 + seed * 101 + Math.round(width);
  const random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  const out: string[] = [];
  const count = Math.round(width / 260);
  for (let i = 0; i < count; i++) {
    const r = height * (0.004 + random() * 0.01);
    out.push(`<div class="dot" style="left:${px(random() * width)};top:${px(height * (0.05 + random() * 0.9))};width:${px(2 * r)};height:${px(2 * r)};background:${palette.text};opacity:${(0.08 + random() * 0.18).toFixed(2)}"></div>`);
  }
  return out.join("");
}

function standaloneBackground(index: number, size: StoreSize, palette: Palette): string {
  const W = size.width;
  const H = size.height;
  const [b0, b1, b2] = palette.background;
  const angle = 155 + index * 12;
  const glowX = index % 2 === 0 ? 0.85 : 0.15;
  const r1 = W * 0.75;
  const r2 = W * 0.55;
  // Everything is drawn in this screenshot's own box, so nothing bleeds into the next one.
  return `
  <div class="clip" style="left:${px(index * W)};width:${px(W)};height:${px(H)}">
    <div class="bg" style="width:${px(W)};height:${px(H)};background:linear-gradient(${angle}deg, ${b0} 0%, ${b1} 55%, ${b2} 100%)"></div>
    <div class="blob" style="left:${px(glowX * W - r1)};top:${px(H * 0.62 - r1)};width:${px(2 * r1)};height:${px(2 * r1)};background:radial-gradient(circle, ${palette.glow} 0%, transparent 66%);opacity:0.6"></div>
    <div class="blob" style="left:${px((1 - glowX) * W - r2)};top:${px(H * 0.2 - r2)};width:${px(2 * r2)};height:${px(2 * r2)};background:radial-gradient(circle, ${palette.accent} 0%, transparent 66%);opacity:0.35"></div>
    <div class="ring" style="left:${px(glowX * W - W * 0.42)};top:${px(H * 0.62 - W * 0.42)};width:${px(W * 0.84)};height:${px(W * 0.84)};border:${px(W * 0.006)} solid ${palette.text};opacity:0.12"></div>
    ${dots(W, H, palette, index)}
  </div>`;
}

export function pageHtml(input: PageInput): string {
  const { size, palette, style } = input;
  const W = size.width;
  const H = size.height;
  const background = style === "panoramic" ? panoramicBackground(size, palette) : input.shots.map((_, i) => standaloneBackground(i, size, palette)).join("");
  const poses = style === "panoramic" ? PANORAMIC_POSES : STANDALONE_POSES;
  // In "3d", each device is drawn inside its own screenshot's clip box, so nothing crosses into the next one.
  const devices = input.shots
    .map((shot, i) => {
      const pose = poses[i]!;
      if (style === "panoramic") return device(shot, pose, size, palette, 0);
      return `<div class="clip" style="left:${px(i * W)};width:${px(W)};height:${px(H)}">${device(shot, pose, size, palette, 0)}</div>`;
    })
    .join("");
  const copy = input.slides.map((slide, i) => text(slide, i, input.appName, size, palette, i * W)).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fonts()}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:${palette.background[1]}}
#world{position:absolute;left:0;top:0;width:${W * 5}px;height:${H}px;will-change:transform}
body{position:relative;font-family:"Inter","Noto Sans","Noto Sans CJK SC","Noto Sans Arabic","Noto Sans Devanagari",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.bg,.blob,.ring,.dot,.ribbon,.copy,.stage,.shadow,.clip{position:absolute}
.bg{top:0;left:0}
.blob{border-radius:50%;filter:blur(${px(W * 0.05)})}
.ring{border-radius:50%}
.dot{border-radius:50%}
.ribbon{left:0;top:0}
.clip{top:0;overflow:hidden}
.copy{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;text-align:center;z-index:5}
.label{font-weight:600;letter-spacing:.04em;text-transform:uppercase;border-radius:999px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.28)}
.headline{font-weight:800;line-height:1.06;letter-spacing:-.025em;text-wrap:balance}
.sub{font-weight:600;line-height:1.3;text-wrap:balance}
.stage{z-index:3}
.device{position:relative;transform-style:preserve-3d}
.slab,.front{position:absolute;inset:0;border-radius:var(--r)}
.slab{background:linear-gradient(135deg,#7d828d,#2b2e35 40%,#5a5e68 70%,#22252b)}
.btn{position:absolute;border-radius:6px;background:linear-gradient(90deg,#3a3e46,#8a8f99,#3a3e46)}
.front{background:var(--frame);transform:translateZ(1px)}
.screen{position:relative;width:100%;height:100%;overflow:hidden;background:#000}
.screen img{display:block;width:100%;height:100%;object-fit:cover}
.glare{position:absolute;inset:0;background:linear-gradient(118deg,rgba(255,255,255,.16) 0%,rgba(255,255,255,.05) 30%,rgba(255,255,255,0) 42%)}
.island{position:absolute;left:50%;transform:translateX(-50%);background:#000;border-radius:999px}
.shadow{z-index:2;border-radius:50%;background:radial-gradient(ellipse at center,rgba(0,0,0,.45) 0%,rgba(0,0,0,0) 70%);filter:blur(${px(W * 0.02)})}
</style></head><body><div id="world">
${background}
${devices}
${copy}
</div></body></html>`;
}
