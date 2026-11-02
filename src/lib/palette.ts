// Turns one brand color into the full palette the templates use: a three-stop background, an accent, glow and text
// colors with enough contrast. Themes: "vibrant" (saturated brand background, white text), "dark" (deep background,
// brand glow) and "light" (pastel background, dark text). "auto" picks vibrant when white text reads well on the brand
// color, else dark.

export type Theme = "auto" | "vibrant" | "dark" | "light";

export interface Palette {
  theme: Exclude<Theme, "auto">;
  brand: string;
  accent: string;
  background: [string, string, string];
  glow: string;
  text: string;
  subtext: string;
  /** Device frame color. */
  frame: string;
}

type Hsl = [number, number, number];

export function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export function toHsl(hex: string): Hsl {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s * 100, l * 100];
}

export function fromHsl([h, s, l]: Hsl): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** The most colorful of some candidate colors, or undefined if all are grays. */
export function mostColorful(colors: string[]): string | undefined {
  const scored = colors
    .filter(isHex)
    .map((hex) => {
      const [, s, l] = toHsl(hex);
      return { hex, score: s * (1 - Math.abs(l - 50) / 50) };
    })
    .filter((entry) => entry.score > 12)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.hex;
}

export function buildPalette(brandInput: string, theme: Theme, accentInput?: string): Palette {
  let [h, s, l] = toHsl(brandInput);
  // Very gray brands still need some color to look designed.
  if (s < 25) s = 45;
  const brand = fromHsl([h, s, Math.min(Math.max(l, 30), 65)]);
  const accent = isHex(accentInput) && contrast(accentInput, brand) > 1.3 ? accentInput : fromHsl([h + 38, Math.min(s + 10, 95), 62]);
  const chosen: Exclude<Theme, "auto"> = theme === "auto" ? (contrast("#ffffff", fromHsl([h, s, 46])) >= 3 ? "vibrant" : "dark") : theme;

  if (chosen === "light") {
    return {
      theme: chosen,
      brand,
      accent,
      background: [fromHsl([h, Math.min(s, 70), 96]), fromHsl([h + 20, Math.min(s, 60), 90]), fromHsl([h - 15, Math.min(s, 75), 84])],
      glow: fromHsl([h + 30, 90, 72]),
      text: fromHsl([h, 45, 14]),
      subtext: fromHsl([h, 22, 34]),
      frame: "#111318",
    };
  }
  if (chosen === "dark") {
    return {
      theme: chosen,
      brand,
      accent,
      background: [fromHsl([h, Math.min(s, 60), 9]), fromHsl([h + 12, Math.min(s, 70), 17]), fromHsl([h - 20, Math.min(s, 80), 26])],
      glow: fromHsl([h, Math.min(s + 15, 100), 58]),
      text: "#ffffff",
      subtext: fromHsl([h, 30, 82]),
      frame: "#1b1d22",
    };
  }
  // Vibrant: saturated brand colors. White text where it reads well; on bright hues (yellow, lime, cyan) dark text;
  // otherwise the stops are darkened until white text reads.
  let stops: Hsl[] = [
    [h - 12, Math.min(s + 5, 95), 40],
    [h, s, 50],
    [h + 28, Math.min(s + 10, 95), 58],
  ];
  const dark = fromHsl([h, 60, 10]);
  const minContrast = (text: string, list: Hsl[]) => Math.min(...list.map((stop) => contrast(text, fromHsl(stop))));
  let text = "#ffffff";
  if (minContrast("#ffffff", stops) < 3) {
    if (minContrast(dark, stops) >= 4.5) text = dark;
    else {
      stops = stops.map(([sh, ss, sl]) => {
        let light = sl;
        while (light > 12 && contrast("#ffffff", fromHsl([sh, ss, light])) < 3.2) light -= 2;
        return [sh, ss, light] as Hsl;
      });
    }
  }
  return {
    theme: chosen,
    brand,
    accent,
    background: stops.map(fromHsl) as [string, string, string],
    glow: fromHsl([h + 40, 100, 75]),
    text,
    subtext: text === "#ffffff" ? "rgba(255,255,255,0.86)" : fromHsl([h, 45, 20]),
    frame: "#121317",
  };
}
