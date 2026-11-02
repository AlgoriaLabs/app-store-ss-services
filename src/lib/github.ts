// Reads what a public GitHub repository says about its mobile app: name, description, topics, README, the platform
// (Flutter, Expo / React Native, native iOS or Android) and any brand colors in its config files.
//
// It makes at most 8 GitHub requests per job. Without GITHUB_TOKEN, GitHub allows 60 an hour per IP address; with
// a token (public read access only), 5,000. A repository that can't be read still gives its owner and name, so a
// job never fails on GitHub alone. Everything read here is untrusted text: it only feeds the copywriter's prompt,
// labeled as data, and color parsing.

import { config } from "./config.js";

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface RepoContext extends RepoRef {
  url: string;
  defaultBranch: string;
  name: string;
  displayName?: string;
  description: string;
  topics: string[];
  homepage?: string;
  language?: string;
  platform: string;
  readme: string;
  colors: string[];
  /** Short excerpts of config files, for the copywriter. */
  files: { path: string; excerpt: string }[];
  /** Whether GitHub answered; false means only the URL was used. */
  read: boolean;
}

const REPO_PATTERN = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/;

export function parseRepoUrl(url: string): RepoRef {
  const match = REPO_PATTERN.exec(url.trim());
  if (!match) throw new Error("repository must look like https://github.com/<owner>/<repo>");
  return { owner: match[1]!, repo: match[2]! };
}

async function gh(path: string, accept = "application/vnd.github+json", signal?: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = { Accept: accept, "User-Agent": "app-store-screenshot-studio", "X-GitHub-Api-Version": "2022-11-28" };
  if (config.githubToken) headers["Authorization"] = `Bearer ${config.githubToken}`;
  const timeout = AbortSignal.timeout(10_000);
  return fetch(`https://api.github.com${path}`, { headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
}

async function raw(ref: RepoRef, branch: string, path: string, signal?: AbortSignal): Promise<string | undefined> {
  const response = await gh(`/repos/${ref.owner}/${ref.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`, "application/vnd.github.raw", signal);
  if (!response.ok) return undefined;
  const body = await response.text();
  return body.slice(0, 40_000);
}

/** Paths, in order of interest, that describe a mobile app's name and colors. */
const INTERESTING: RegExp[] = [
  /^app\.json$/,
  /^app\.config\.(js|ts)$/,
  /^pubspec\.yaml$/,
  /(^|\/)package\.json$/,
  /(^|\/)Info\.plist$/,
  /(^|\/)res\/values\/strings\.xml$/,
  /(^|\/)res\/values\/colors\.xml$/,
  /(^|\/)(theme|colors?|palette)\.(ts|tsx|js|dart|swift|kt)$/i,
  /(^|\/)Colors\.xcassets\/AccentColor\.colorset\/Contents\.json$/,
];

function detectPlatform(paths: string[]): string {
  const has = (pattern: RegExp) => paths.some((path) => pattern.test(path));
  if (has(/^pubspec\.yaml$/)) return "Flutter";
  if (has(/^app\.(json|config\.(js|ts))$/) && has(/(^|\/)package\.json$/)) return "Expo / React Native";
  if (has(/(^|\/)package\.json$/) && has(/^ios\//) && has(/^android\//)) return "React Native";
  if (has(/\.xcodeproj\//) || has(/(^|\/)Package\.swift$/)) return has(/build\.gradle(\.kts)?$/) ? "Native iOS and Android" : "Native iOS (Swift)";
  if (has(/build\.gradle(\.kts)?$/)) return "Native Android (Kotlin)";
  if (has(/capacitor\.config\.(json|ts)$/)) return "Capacitor / Ionic";
  return "Mobile app";
}

const HEX = /#(?:[0-9a-fA-F]{6})\b|0x[fF]{2}([0-9a-fA-F]{6})\b/g;

/** Hex colors in a file, most frequent first, without near-black, near-white and grays. */
export function extractColors(textContent: string): string[] {
  const counts = new Map<string, number>();
  for (const match of textContent.matchAll(HEX)) {
    const hex = (match[1] ? `#${match[1]}` : match[0]).toLowerCase();
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 40 || max < 40 || min > 225) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
}

function displayNameFrom(path: string, content: string): string | undefined {
  try {
    if (path === "app.json") {
      const json = JSON.parse(content) as { expo?: { name?: string }; name?: string; displayName?: string };
      return json.expo?.name ?? json.displayName ?? json.name;
    }
  } catch {
    return undefined;
  }
  if (/^app\.config\.(js|ts)$/.test(path)) {
    const match = /\bname:\s*['"`]([^'"`$]{1,40})['"`]/.exec(content);
    if (match) return match[1];
  }
  if (path.endsWith("Info.plist")) {
    const match = /<key>CFBundleDisplayName<\/key>\s*<string>([^<$]{1,40})<\/string>/.exec(content);
    if (match) return match[1];
  }
  if (path.endsWith("strings.xml")) {
    const match = /<string name="app_name">([^<]{1,40})<\/string>/.exec(content);
    if (match) return match[1];
  }
  return undefined;
}

function cleanReadme(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 8_000);
}

export async function readRepository(url: string, signal?: AbortSignal): Promise<RepoContext> {
  const ref = parseRepoUrl(url);
  const fallback: RepoContext = {
    ...ref,
    url: `https://github.com/${ref.owner}/${ref.repo}`,
    defaultBranch: "main",
    name: ref.repo,
    description: "",
    topics: [],
    platform: "Mobile app",
    readme: "",
    colors: [],
    files: [],
    read: false,
  };
  try {
    const meta = await gh(`/repos/${ref.owner}/${ref.repo}`, undefined, signal);
    if (!meta.ok) return fallback;
    const repo = (await meta.json()) as {
      name: string;
      description: string | null;
      topics?: string[];
      homepage: string | null;
      language: string | null;
      default_branch: string;
      private: boolean;
    };
    // Only public repositories: a token on this server must never expose private ones to a buyer.
    if (repo.private) return fallback;
    const branch = repo.default_branch;
    const context: RepoContext = {
      ...fallback,
      defaultBranch: branch,
      name: repo.name,
      description: repo.description ?? "",
      topics: repo.topics ?? [],
      ...(repo.homepage ? { homepage: repo.homepage } : {}),
      ...(repo.language ? { language: repo.language } : {}),
      read: true,
    };

    const [readmeResponse, treeResponse] = await Promise.all([
      gh(`/repos/${ref.owner}/${ref.repo}/readme`, "application/vnd.github.raw", signal),
      gh(`/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, undefined, signal),
    ]);
    if (readmeResponse.ok) context.readme = cleanReadme(await readmeResponse.text());
    const paths = treeResponse.ok
      ? ((await treeResponse.json()) as { tree?: { path: string; type: string }[] }).tree
          ?.filter((entry) => entry.type === "blob" && !/node_modules\/|\/build\/|\/Pods\/|\.dart_tool\//.test(entry.path))
          .map((entry) => entry.path) ?? []
      : [];
    context.platform = detectPlatform(paths);

    const picked: string[] = [];
    // App extensions, widgets and tests have their own Info.plist and strings: the app's own are wanted.
    const secondary = /(NSE|Extension|Widget|Intents?|Tests?|Share|Notification|Watch|Clip|example|sample|demo)/i;
    for (const pattern of INTERESTING) {
      const path = paths.filter((p) => pattern.test(p) && !secondary.test(p)).sort((a, b) => a.length - b.length)[0];
      if (path && !picked.includes(path)) picked.push(path);
      if (picked.length >= 5) break;
    }
    const contents = await Promise.all(picked.map(async (path) => [path, await raw(ref, branch, path, signal)] as const));
    const colors: string[] = [];
    for (const [path, content] of contents) {
      if (!content) continue;
      context.files.push({ path, excerpt: content.slice(0, 1_500) });
      context.displayName ??= displayNameFrom(path, content);
      colors.push(...extractColors(content));
    }
    colors.push(...extractColors(context.readme));
    context.colors = [...new Set(colors)].slice(0, 6);
    return context;
  } catch (error) {
    if (signal?.aborted) throw error;
    return fallback;
  }
}

/** Reads a file of the repository as bytes, for screenshots given as repository paths. */
export async function readRepositoryFile(ref: RepoRef, branch: string, path: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  if (path.includes("..") || path.startsWith("/")) throw new Error(`invalid repository path: ${path}`);
  const response = await gh(`/repos/${ref.owner}/${ref.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`, "application/vnd.github.raw", signal);
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${path}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`${path} is larger than ${maxBytes} bytes`);
  return bytes;
}
