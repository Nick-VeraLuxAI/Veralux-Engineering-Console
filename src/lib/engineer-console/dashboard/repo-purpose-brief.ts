import { isCodeSymbolKind } from "./repo-control-plane";

export const REPO_PURPOSE_MAX_CHARS = 2200;
export const REPO_PURPOSE_README_CHARS = 1100;
export const REPO_PURPOSE_MAX_ITEMS = 8;

export type RepoPurposeRoute = {
  method: string;
  routePath: string;
};

export type RepoPurposeExport = {
  name: string;
  kind: string;
};

export type RepoPurposeFacts = {
  name: string;
  language: string;
  registeredDescription: string;
  packageDescription: string;
  readmeExcerpt: string;
  folders: string[];
  routes: RepoPurposeRoute[];
  exports: RepoPurposeExport[];
  scripts: string[];
  testRunner: string | null;
};

const README_STOP =
  /^(#{1,6}\s+)?(quick start|getting started|installation|install|production|environment|env vars|local development)\b/i;

export function publicPurposeText(value: string, maxChars = 1600): string {
  return value
    .replace(/\/(?:home|mnt|tmp|Users)\/[^\s"'`]+/g, "…")
    .replace(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?[^\s"'`]*/gi, "…")
    .replace(/\b(?:localhost|127\.0\.0\.1)(?::\d+)?\b/gi, "…")
    .replace(/\b0\.0\.0\.0\b/g, "…")
    .replace(/--(?:host|port)\s+\S+/gi, "[bind]")
    .replace(/`[A-Z][A-Z0-9_]{2,}`/g, "`[env]`")
    .replace(/\b[A-Z][A-Z0-9_]{3,}=[^\s]+/g, "[redacted]")
    .trim()
    .slice(0, maxChars);
}

export function excerptReadme(raw: string, maxChars = REPO_PURPOSE_README_CHARS): string {
  const cleaned = publicPurposeText(raw, maxChars * 2);
  const lines: string[] = [];
  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (README_STOP.test(line)) break;
    if (/^\[!\[/.test(line) || /^!\[/.test(line)) continue;
    if (/^<!--/.test(line) || /^<img\b/i.test(line)) continue;
    lines.push(line);
    if (lines.length >= 12) break;
  }
  const text = lines.join("\n");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trim()}…`;
}

export function firstReadmeParagraph(excerpt: string): string {
  for (const line of excerpt.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || /^#{1,6}\s+/.test(trimmed) || /^[-*|>]/.test(trimmed)) continue;
    return publicPurposeText(trimmed.replace(/\*\*/g, ""), 240);
  }
  return "";
}

export function looksLikeGithubPointer(text: string): boolean {
  return /github\.com\//i.test(text) || /^github\s+[\w.-]+\/[\w.-]+/i.test(text) || /^[\w.-]+\/[\w.-]+$/.test(text);
}

export function publicLanguageLabel(value: string): string {
  const language = publicPurposeText(value, 40);
  return !language || /^unknown$/i.test(language) ? "" : language;
}

export function isHostConsoleRepo(name: string): boolean {
  return /engineering-console/i.test(name);
}

export function takePurposeRoutes(
  surfaces: Array<{ surfaceType: string; method: string | null; routePath: string | null }>,
): RepoPurposeRoute[] {
  const seen = new Set<string>();
  const routes: RepoPurposeRoute[] = [];
  for (const surface of surfaces) {
    if (surface.surfaceType !== "rest_route" || !surface.routePath) continue;
    const method = (surface.method ?? "GET").toUpperCase();
    const routePath = publicPurposeText(surface.routePath, 80);
    if (!routePath) continue;
    const key = `${method} ${routePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ method, routePath });
    if (routes.length >= REPO_PURPOSE_MAX_ITEMS) break;
  }
  return routes;
}

export function takePurposeExports(
  symbols: Array<{ name: string; kind: string; exported: boolean }>,
): RepoPurposeExport[] {
  const seen = new Set<string>();
  const exports: RepoPurposeExport[] = [];
  for (const symbol of symbols) {
    if (!symbol.exported || !isCodeSymbolKind(symbol.kind)) continue;
    const name = publicPurposeText(symbol.name, 80);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    exports.push({ name, kind: symbol.kind });
    if (exports.length >= REPO_PURPOSE_MAX_ITEMS) break;
  }
  return exports;
}

function purposeLine(facts: RepoPurposeFacts): string {
  const fromReadme = firstReadmeParagraph(facts.readmeExcerpt);
  if (fromReadme) return fromReadme;
  const registered = publicPurposeText(facts.registeredDescription, 240);
  if (registered && !looksLikeGithubPointer(registered)) return registered;
  const pkg = publicPurposeText(facts.packageDescription, 240);
  if (pkg && !looksLikeGithubPointer(pkg)) return pkg;
  return "";
}

export function buildRepoPurposeBrief(facts: RepoPurposeFacts): string {
  const name = publicPurposeText(facts.name, 80) || "Unnamed repo";
  const language = publicLanguageLabel(facts.language);
  const purpose = purposeLine(facts);
  const testRunner = facts.testRunner ? publicLanguageLabel(facts.testRunner) : "";
  const readme = facts.readmeExcerpt ? excerptReadme(facts.readmeExcerpt) : "";
  const folders = facts.folders.map((folder) => publicPurposeText(folder, 40)).filter(Boolean).slice(0, REPO_PURPOSE_MAX_ITEMS);
  const routes = facts.routes.slice(0, REPO_PURPOSE_MAX_ITEMS);
  const exports = facts.exports.filter((item) => isCodeSymbolKind(item.kind)).slice(0, REPO_PURPOSE_MAX_ITEMS);
  const scripts = facts.scripts.map((script) => publicPurposeText(script, 40)).filter(Boolean).slice(0, REPO_PURPOSE_MAX_ITEMS);
  const sameAsHost = isHostConsoleRepo(name);
  const hostLine = sameAsHost
    ? "This working repo is the Engineering Console host itself."
    : "This working repo is a registered local codebase, not the Engineering Console host.";

  const lines = [
    `Working repository: ${name}${language ? ` (${language})` : ""}. ${hostLine}`,
    purpose ? `Purpose: ${purpose}` : "Purpose is not recorded in the registered description or package.json.",
    readme ? `README:\n${readme}` : "README: not found.",
    folders.length > 0 ? `Layout: ${folders.join(", ")}` : null,
    routes.length > 0
      ? `Entry routes: ${routes.map((route) => `${route.method} ${route.routePath}`).join(", ")}`
      : null,
    exports.length > 0
      ? `Notable code exports: ${exports.map((item) => item.name).join(", ")}`
      : null,
    scripts.length > 0 ? `Scripts: ${scripts.join(", ")}` : null,
    testRunner ? `Test runner: ${testRunner}` : null,
    purpose || readme
      ? "If the operator asks what this repo is for, answer from Purpose and README. File and export counts are inventory, not purpose. Do not ask the operator what the repo is for. Do not invent a product name from markdown headings or 'unknown' symbols."
      : "Purpose text is missing. You may describe folders and routes. Do not invent a product story from file counts, export counts, or markdown headings.",
  ].filter((line): line is string => Boolean(line));

  const brief = lines.join("\n");
  if (brief.length <= REPO_PURPOSE_MAX_CHARS) return brief;
  return `${brief.slice(0, REPO_PURPOSE_MAX_CHARS).trim()}…`;
}
