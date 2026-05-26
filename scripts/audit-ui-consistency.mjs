#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const UI_AUDIT_OUTPUT_DIR = "docs/generated";
export const UI_AUDIT_OUTPUT_FILES = {
  markdown: "ui-consistency-audit.md",
  json: "ui-consistency-audit.json",
};
export const UI_AUDIT_SCORING_KEYS = [
  "canvasConsistency",
  "routeConsistency",
  "componentReuse",
  "accessibility",
  "visualDensityRisk",
  "legacyPatternRisk",
];
export const UI_AUDIT_ROUTE_AREAS = [
  {
    route: "/engineer",
    label: "Immersive engineer canvas",
    files: [
      "src/app/(main)/engineer/page.tsx",
      "src/components/engineer-console/engineering-console-canvas-home.tsx",
      "src/components/engineer-console/workflow-canvas.tsx",
      "src/components/engineer-console/canvas-top-bar.tsx",
      "src/components/engineer-console/canvas-bottom-dock.tsx",
      "src/components/engineer-console/canvas-overlay-window.tsx",
    ],
  },
  {
    route: "/engineer/repos",
    label: "Repositories",
    files: [
      "src/app/(main)/engineer/repos/page.tsx",
      "src/components/engineer-console/registered-repos-panel.tsx",
      "src/components/engineer-console/engineer-route-shell.tsx",
    ],
  },
  {
    route: "/engineer/compatibility",
    label: "Compatibility",
    files: [
      "src/app/(main)/engineer/compatibility/page.tsx",
      "src/components/engineer-console/compatibility-panel.tsx",
      "src/components/engineer-console/engineer-route-shell.tsx",
    ],
  },
  {
    route: "/engineer/tasks",
    label: "Task entry surfaces",
    files: [
      "src/components/engineer-console/engineer-task-list.tsx",
      "src/components/engineer-console/create-task-form.tsx",
      "src/app/(main)/engineer/tasks/[id]/page.tsx",
      "src/components/engineer-console/engineer-route-shell.tsx",
    ],
  },
  {
    route: "/engineer/runs/:id",
    label: "Run workspace",
    files: [
      "src/app/(main)/engineer/runs/[id]/page.tsx",
      "src/components/engineer-console/run-live-panel.tsx",
      "src/components/engineer-console/run-workspace-shell.tsx",
      "src/components/engineer-console/run-issue-center.tsx",
      "src/components/engineer-console/run-quick-nav.tsx",
    ],
  },
  {
    route: "/engineer/login",
    label: "Engineer login",
    files: [
      "src/app/(main)/engineer/login/page.tsx",
      "src/app/(main)/engineer/login/layout.tsx",
    ],
  },
];

const INCLUDED_SOURCE_DIRS = ["src/app", "src/components", "docs"];
const INCLUDED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".md", ".json"]);
const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "backups",
  "test-results",
  "coverage",
  "dist",
  "build",
]);
const SEVERITY_PENALTY = {
  critical: 25,
  high: 12,
  medium: 5,
  low: 2,
};
const SEVERITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
const PREMIUM_COMPONENTS = [
  ["Canvas overlay window", "src/components/engineer-console/canvas-overlay-window.tsx"],
  ["Canvas minimized bar", "src/components/engineer-console/canvas-minimized-bar.tsx"],
  ["Dashboard issue center", "src/components/engineer-console/dashboard-issue-center.tsx"],
  ["Canvas detail drawer", "src/components/engineer-console/canvas-detail-drawer.tsx"],
  ["Canvas bottom dock", "src/components/engineer-console/canvas-bottom-dock.tsx"],
  ["Canvas top chrome", "src/components/engineer-console/canvas-top-bar.tsx"],
  ["Status badge", "src/components/engineer-console/status-badge.tsx"],
  ["Operator help", "src/components/engineer-console/operator-help.tsx"],
  ["Workflow canvas", "src/components/engineer-console/workflow-canvas.tsx"],
];
const ALLOWED_IMMERSIVE_HEX_COLORS = new Set([
  "#02050a",
  "#03060b",
  "#04070d",
  "#05070d",
  "#06101a",
  "#07101c",
  "#08111c",
  "#0c1627",
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function countMatches(content, pattern) {
  return [...content.matchAll(pattern)].length;
}

function firstItems(values, limit = 3) {
  return values.slice(0, limit).join(", ");
}

function titleCase(value) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeMarkdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br/>");
}

function isImmersivePremiumFile(filePath) {
  return /src\/components\/engineer-console\/(?:canvas-|workflow-canvas|engineering-console-canvas-home|engineer-route-shell)/.test(
    filePath,
  );
}

function describeSeverity(counts) {
  const ordered = ["critical", "high", "medium", "low"]
    .filter((severity) => (counts[severity] ?? 0) > 0)
    .map((severity) => `${counts[severity]} ${severity}`);
  return ordered.length > 0 ? ordered.join(", ") : "none";
}

function scoreToStatus(score) {
  if (score >= 88) return "premium aligned";
  if (score >= 76) return "acceptable";
  if (score >= 60) return "inconsistent";
  if (score >= 45) return "needs visual pass";
  return "legacy/high-density";
}

function scoreToRisk(score) {
  if (score >= 82) return "low";
  if (score >= 62) return "medium";
  return "high";
}

function extractVisibleCopyStats(content) {
  const blocks = [...content.matchAll(/>([^<>{]{30,})</g)]
    .map((match) => match[1].replace(/\s+/g, " ").trim())
    .filter((block) => block.split(/\s+/).length >= 8);
  const words = blocks.reduce((total, block) => total + block.split(/\s+/).length, 0);
  return {
    blocks,
    blockCount: blocks.length,
    wordCount: words,
  };
}

function extractIconButtonsMissingLabel(content) {
  const results = [];
  for (const match of content.matchAll(/<button\b([\s\S]*?)>([\s\S]*?)<\/button>/g)) {
    const attrs = match[1] ?? "";
    const inner = match[2] ?? "";
    const hasLabel = /\baria-label=|\baria-labelledby=|\btitle=/.test(attrs);
    const stripped = inner
      .replace(/<svg[\s\S]*?<\/svg>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&[a-z]+;/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const iconOnly = stripped === "" || ["+", "-", "x", "×"].includes(stripped);
    if (iconOnly && !hasLabel) {
      results.push(match[0].slice(0, 120).replace(/\s+/g, " ").trim());
    }
  }
  return results;
}

function hasEscapeHandling(content) {
  return /Escape|event\.key\s*!==\s*["']Escape["']|event\.key\s*===\s*["']Escape["']/.test(content);
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(rootDir, relativeDir) {
  const targetDir = path.join(rootDir, relativeDir);
  if (!(await exists(targetDir))) {
    return [];
  }

  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) {
      continue;
    }
    const absolutePath = path.join(targetDir, entry.name);
    const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(rootDir, relativePath)));
      continue;
    }
    if (INCLUDED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(relativePath);
    }
  }
  return files;
}

function normalizeFinding(finding) {
  return {
    file: finding.file,
    category: finding.category,
    severity: finding.severity,
    message: finding.message,
    evidence: finding.evidence,
    suggestedFix: finding.suggestedFix,
  };
}

function pushFinding(store, seen, finding) {
  const normalized = normalizeFinding(finding);
  const key = JSON.stringify(normalized);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  store.push(normalized);
}

function analyzeFile(filePath, content, context) {
  const findings = [];
  const seen = new Set();
  const isRouteFile =
    filePath.startsWith("src/app/") && !filePath.includes("/api/") && /(page|layout)\.(ts|tsx|js|jsx)$/.test(filePath);
  const isComponentFile = filePath.startsWith("src/components/");
  const isEngineerConsole = filePath.startsWith("src/components/engineer-console/");
  const isTopSurface = /(page|home|route-shell|panel|drawer|issue-center|inspector|dock|toolbar)\.(tsx|ts|jsx|js)$/.test(
    filePath,
  );
  const isLoginSurface = /\/engineer\/login\/|login\/page\.tsx$|login\/layout\.tsx$/.test(filePath);

  if ((isRouteFile || isTopSurface) && /\bmx-auto\b/.test(content)) {
    pushFinding(findings, seen, {
      file: filePath,
      category: "legacy-layout",
      severity: isLoginSurface ? "low" : filePath.includes("/engineer") ? "high" : "medium",
      message: "Uses centered `mx-auto` wrappers on a major UI surface.",
      evidence: "Found `mx-auto` in a route-level or major shell component.",
      suggestedFix: "Review whether this surface should stay boxed or move toward a more intentional full-bleed/layout-shell pattern.",
    });
  }

  const maxWidthMatches = uniqueSorted(content.match(/\bmax-w-[\w[\]/:.%-]+\b/g) ?? []).filter(
    (value) => value !== "max-w-full",
  );
  if ((isRouteFile || isTopSurface) && maxWidthMatches.length > 0) {
    pushFinding(findings, seen, {
      file: filePath,
      category: "legacy-layout",
      severity: isLoginSurface ? "low" : filePath.includes("engineer-route-shell") ? "high" : "medium",
      message: "Uses `max-w-*` layout boxing on a major surface.",
      evidence: firstItems(maxWidthMatches, 4),
      suggestedFix: "Confirm this route intentionally uses boxed content rather than inheriting the newer immersive or calmer shell patterns.",
    });
  }

  const panelShellCount = countMatches(
    content,
    /border-\[var\(--border\)\][\s\S]{0,120}bg-\[var\(--(?:card|background)\)\]/g,
  );
  if (panelShellCount >= 4) {
    pushFinding(findings, seen, {
      file: filePath,
      category: "legacy-layout",
      severity: panelShellCount >= 6 ? "high" : "medium",
      message: "Stacks many repeated card/panel shells in one file.",
      evidence: `${panelShellCount} repeated border/card shell patterns detected.`,
      suggestedFix: "Consolidate repeated shells into shared primitives or reduce first-screen panel density on this surface.",
    });
  }

  const heavyPadding = uniqueSorted(content.match(/\b(?:p|px|py|pt|pb|pl|pr)-(?:8|9|10|11|12)\b/g) ?? []);
  if (heavyPadding.length >= 2 && (isRouteFile || isTopSurface)) {
    pushFinding(findings, seen, {
      file: filePath,
      category: "legacy-layout",
      severity: "medium",
      message: "Uses larger page/card padding that may reinforce older high-density layouts.",
      evidence: firstItems(heavyPadding, 4),
      suggestedFix: "Check whether this surface can use calmer spacing or progressive disclosure instead of large padded card stacks.",
    });
  }

  const hexColors = uniqueSorted(content.match(/#[0-9a-fA-F]{3,8}/g) ?? []);
  const usesOnlyAllowedImmersiveHexes =
    hexColors.length > 0 && hexColors.every((color) => ALLOWED_IMMERSIVE_HEX_COLORS.has(color.toLowerCase()));
  if (
    hexColors.length > 0 &&
    filePath !== "src/app/globals.css" &&
    !(isImmersivePremiumFile(filePath) && usesOnlyAllowedImmersiveHexes)
  ) {
    pushFinding(findings, seen, {
      file: filePath,
      category: "inconsistent-styling",
      severity: hexColors.length >= 3 ? "high" : "medium",
      message: "Uses hardcoded hex colors outside the global token palette.",
      evidence: firstItems(hexColors, 5),
      suggestedFix: "Prefer shared CSS variables or a smaller set of intentional surface tokens over per-file hex colors.",
    });
  }

  const customDarkBackgrounds = uniqueSorted(content.match(/bg-\[#(?:[0-9a-fA-F]{3,8})\](?:\/\d+)?/g) ?? []);
  if (customDarkBackgrounds.length >= 2 && !isEngineerConsole) {
    pushFinding(findings, seen, {
      file: filePath,
      category: "inconsistent-styling",
      severity: "high",
      message: "Uses bespoke dark background classes outside the immersive engineering console surface.",
      evidence: firstItems(customDarkBackgrounds, 5),
      suggestedFix: "Route these surfaces through shared dark/glass tokens if they are meant to align with the premium console language.",
    });
  }

  const mutedDrift = uniqueSorted(content.match(/\btext-(?:gray|slate|zinc|neutral)-[4567]00\b/g) ?? []);
  if (mutedDrift.length > 0) {
    pushFinding(findings, seen, {
      file: filePath,
      category: "inconsistent-styling",
      severity: "medium",
      message: "Uses ad hoc muted text utilities instead of the shared muted token.",
      evidence: firstItems(mutedDrift, 4),
      suggestedFix: "Prefer `text-[var(--muted)]` or a consolidated muted text utility to keep typography tone consistent.",
    });
  }

  const lightModeAssumptions = uniqueSorted(
    content.match(/\b(?:bg-white(?!\/)|text-black\b|text-slate-9\d{2}\b|bg-slate-50\b)\b/g) ?? [],
  );
  if (lightModeAssumptions.length > 0 && filePath.includes("/engineer")) {
    pushFinding(findings, seen, {
      file: filePath,
      category: "inconsistent-styling",
      severity: "high",
      message: "Mixes light-surface assumptions into an engineer-facing dark UI surface.",
      evidence: firstItems(lightModeAssumptions, 4),
      suggestedFix: "Audit this surface for dark-theme token alignment before making larger visual changes elsewhere.",
    });
  }

  const radiusClasses = uniqueSorted(content.match(/\brounded(?:-[\w[\]/:.%-]+)?\b/g) ?? []);
  if (radiusClasses.length >= 6) {
    pushFinding(findings, seen, {
      file: filePath,
      category: "inconsistent-styling",
      severity: "low",
      message: "Uses many radius variants in a single file.",
      evidence: firstItems(radiusClasses, 6),
      suggestedFix: "Normalize radius choices around a smaller set of surface tiers.",
    });
  }

  const shadowClasses = uniqueSorted(content.match(/\bshadow(?:-\[[^\]]+\]|-[\w/.-]+)?\b/g) ?? []);
  if (shadowClasses.length >= 5) {
    pushFinding(findings, seen, {
      file: filePath,
      category: "inconsistent-styling",
      severity: "low",
      message: "Uses many shadow/glow variants in a single file.",
      evidence: firstItems(shadowClasses, 6),
      suggestedFix: "Reduce one-off shadows and align with a clearer surface elevation scale.",
    });
  }

  const repeatedBadgeMarkup = countMatches(content, /rounded-full[\s\S]{0,80}border[\s\S]{0,80}text-\[11px\]/g);
  if (repeatedBadgeMarkup >= 3 && filePath !== "src/components/engineer-console/status-badge.tsx") {
    pushFinding(findings, seen, {
      file: filePath,
      category: "component-reuse",
      severity: repeatedBadgeMarkup >= 5 ? "medium" : "low",
      message: "Repeats custom badge/status markup instead of reusing a shared primitive.",
      evidence: `${repeatedBadgeMarkup} badge-like rounded pill patterns detected.`,
      suggestedFix: "Consider routing repeated pill/status treatments through a smaller shared badge vocabulary.",
    });
  }

  const clickableNonButtons = [...content.matchAll(/<(div|span|li|section|aside)\b[^>]*onClick=/g)].map((match) => match[1]);
  if (clickableNonButtons.length > 0) {
    pushFinding(findings, seen, {
      file: filePath,
      category: "accessibility",
      severity: "high",
      message: "Uses clickable non-button elements.",
      evidence: firstItems(uniqueSorted(clickableNonButtons), 5),
      suggestedFix: "Use semantic buttons/links or add the correct role, keyboard handling, and focus treatment.",
    });
  }

  const iconButtonsMissingLabel = extractIconButtonsMissingLabel(content);
  if (iconButtonsMissingLabel.length > 0) {
    pushFinding(findings, seen, {
      file: filePath,
      category: "accessibility",
      severity: "high",
      message: "Contains icon-only or symbol-only buttons without an accessible label.",
      evidence: firstItems(iconButtonsMissingLabel, 2),
      suggestedFix: "Add `aria-label`, `aria-labelledby`, or visible text to icon-only controls.",
    });
  }

  const interactiveCount = countMatches(content, /<(?:button|a|Link)\b/g);
  if (interactiveCount >= 4 && /hover:/.test(content) && !content.includes("focus-visible:")) {
    pushFinding(findings, seen, {
      file: filePath,
      category: "accessibility",
      severity: "low",
      message: "Interactive elements appear without explicit `focus-visible` styling.",
      evidence: `${interactiveCount} button/link elements detected and no focus-visible utility found.`,
      suggestedFix: "Add consistent keyboard focus treatment to interactive controls on this surface.",
    });
  }

  if (/(overlay|drawer|issue-center|menu|toolbar|dock)/.test(path.basename(filePath)) && /<button\b/.test(content)) {
    const unlabeledToolbarButtons = extractIconButtonsMissingLabel(content);
    if (unlabeledToolbarButtons.length > 0) {
      pushFinding(findings, seen, {
        file: filePath,
        category: "accessibility",
        severity: "high",
        message: "Overlay/menu/toolbar controls include unlabeled icon actions.",
        evidence: firstItems(unlabeledToolbarButtons, 2),
        suggestedFix: "Ensure icon-only controls in chrome and overlays always carry an accessible label.",
      });
    }
  }

  const copyStats = extractVisibleCopyStats(content);
  if (copyStats.wordCount >= 140 && (isTopSurface || isRouteFile)) {
    pushFinding(findings, seen, {
      file: filePath,
      category: "density",
      severity: copyStats.wordCount >= 220 ? "high" : "medium",
      message: "Contains a large amount of visible copy for a first-screen or primary surface.",
      evidence: `${copyStats.blockCount} visible text blocks, about ${copyStats.wordCount} words.`,
      suggestedFix: "Check whether some explanation can move behind details-on-demand, help affordances, or deeper panels.",
    });
  }

  const checklistRisk = countMatches(content, /\b(checklist|why it matters|suggested action|staging helper|approval report)\b/gi);
  if (checklistRisk >= 5 && (isTopSurface || isRouteFile)) {
    pushFinding(findings, seen, {
      file: filePath,
      category: "density",
      severity: "medium",
      message: "Reads like a checklist-heavy or explanation-heavy default surface.",
      evidence: `${checklistRisk} checklist/help-style phrases detected.`,
      suggestedFix: "Review whether this first-view surface can be simplified or progressively disclosed.",
    });
  }

  context.rawButtonFiles += /<button\b/.test(content) ? 1 : 0;
  context.panelShellFiles += panelShellCount > 0 ? 1 : 0;
  context.hardcodedColorFiles += hexColors.length > 0 && filePath !== "src/app/globals.css" ? 1 : 0;
  context.badgeHeavyFiles += repeatedBadgeMarkup >= 3 ? 1 : 0;
  context.accessibilityFiles += findings.some((finding) => finding.category === "accessibility") ? 1 : 0;
  context.densityFiles += findings.some((finding) => finding.category === "density") ? 1 : 0;
  context.legacyFiles += findings.some((finding) => finding.category === "legacy-layout") ? 1 : 0;

  return findings;
}

function collectRouteFinding(routeArea, routeFiles, findings) {
  const related = findings.filter((finding) => routeFiles.includes(finding.file));
  const penalty = related.reduce((total, finding) => total + SEVERITY_PENALTY[finding.severity], 0);
  const score = clamp(100 - penalty, 0, 100);
  const mainFinding = related[0];
  return {
    route: routeArea.route,
    area: routeArea.label,
    status: scoreToStatus(score),
    risk: scoreToRisk(score),
    score,
    mainIssue: mainFinding?.message ?? "No high-signal drift detected by static audit heuristics.",
    recommendedAction:
      mainFinding?.suggestedFix ??
      "Maintain current route styling and revisit only during the next intentional visual pass.",
    files: routeFiles,
  };
}

function buildStrengths(context, fileMap, docPaths) {
  const strengths = [];
  const premiumCoverage = PREMIUM_COMPONENTS.filter(([, filePath]) => fileMap.has(filePath));
  if (premiumCoverage.length >= 7) {
    strengths.push(
      `Premium immersive engineering chrome is centralized in ${premiumCoverage.length} reusable canvas components.`,
    );
  }
  if (fileMap.has("src/components/engineer-console/status-badge.tsx")) {
    strengths.push("A shared status badge primitive exists for at least part of the state vocabulary.");
  }
  if (fileMap.has("src/components/engineer-console/operator-help.tsx") && docPaths.includes("docs/operator-glossary.md")) {
    strengths.push("Operator help and glossary guidance are already documented and partially componentized.");
  }
  if (context.focusVisibleFiles > 0) {
    strengths.push(`Keyboard focus styling appears in ${context.focusVisibleFiles} scanned source files.`);
  }
  if (fileMap.has("src/app/globals.css")) {
    strengths.push("The app already exposes a small global token palette through CSS variables in `globals.css`.");
  }
  return strengths.slice(0, 5);
}

function buildTopRisks(findings) {
  return findings.slice(0, 5).map((finding) => ({
    severity: finding.severity,
    message: finding.message,
    file: finding.file,
  }));
}

function summarizeCounts(findings, category) {
  return findings.filter((finding) => finding.category === category).length;
}

function buildRecommendedPlan(findings, globalStats) {
  const topReuse = findings.find((finding) => finding.category === "component-reuse");
  const topLegacy = findings.find((finding) => finding.category === "legacy-layout");
  const topAccessibility = findings.find((finding) => finding.category === "accessibility");
  return [
    {
      phase: "Phase 1",
      title: "Fix critical inconsistency",
      items: [
        topLegacy?.message ?? "Address the highest-risk legacy layout shell on a main engineer route.",
        topAccessibility?.message ?? "Fix the most visible accessibility mismatch on interactive chrome first.",
      ],
    },
    {
      phase: "Phase 2",
      title: "Migrate shared primitives",
      items: [
        topReuse?.message ?? "Consolidate repeated panel, badge, button, and overlay shells into fewer shared primitives.",
        "Establish a smaller surface/elevation vocabulary for dark glass, borders, radius, and shadows.",
      ],
    },
    {
      phase: "Phase 3",
      title: "Route-by-route polish",
      items: [
        "Apply the immersive design language intentionally across boxed engineer routes without weakening governance or density controls.",
        "Review route shells that still rely on `max-w-*`, `mx-auto`, or dense stacked cards.",
      ],
    },
    {
      phase: "Phase 4",
      title: "Visual regression screenshots if needed",
      items: [
        "Add optional screenshot-based route checks after the static audit has been triaged.",
        "Capture `/engineer`, repos, compatibility, task entry, and run workspace first-screen states only if the flows are stable.",
      ],
    },
  ];
}

function renderMarkdownReport(audit) {
  const routeRows = audit.routeFindings
    .map(
      (routeFinding) =>
        `| ${escapeMarkdownCell(routeFinding.route)} | ${escapeMarkdownCell(routeFinding.status)} | ${escapeMarkdownCell(
          routeFinding.risk,
        )} | ${escapeMarkdownCell(routeFinding.mainIssue)} | ${escapeMarkdownCell(routeFinding.recommendedAction)} |`,
    )
    .join("\n");

  const componentRows = audit.findings
    .slice(0, 40)
    .map(
      (finding) =>
        `| ${escapeMarkdownCell(finding.file)} | ${escapeMarkdownCell(finding.message)} | ${escapeMarkdownCell(
          titleCase(finding.severity),
        )} | ${escapeMarkdownCell(finding.evidence)} | ${escapeMarkdownCell(finding.suggestedFix)} |`,
    )
    .join("\n");

  const accessibilityFindings = audit.findings
    .filter((finding) => finding.category === "accessibility")
    .slice(0, 8)
    .map((finding) => `- \`${finding.file}\`: ${finding.message} (${finding.evidence})`)
    .join("\n");

  const densityFindings = audit.findings
    .filter((finding) => finding.category === "density" || finding.category === "legacy-layout")
    .slice(0, 8)
    .map((finding) => `- \`${finding.file}\`: ${finding.message} (${finding.evidence})`)
    .join("\n");

  const phases = audit.recommendedPlan
    .map(
      (phase) =>
        `### ${phase.phase}\n- ${phase.title}\n- ${phase.items.join("\n- ")}`,
    )
    .join("\n\n");

  return `# VeraLux UI Consistency Audit

## Executive Summary
- Overall score: **${audit.overallScore}/100**
- Top 5 risks:
${audit.topRisks.map((risk) => `- ${titleCase(risk.severity)}: ${risk.message} (\`${risk.file}\`)`).join("\n")}
- Top 5 strengths:
${audit.topStrengths.map((strength) => `- ${strength}`).join("\n")}
- Recommended next action: **${audit.recommendedNextAction}**

## Scorecard
- Overall UI consistency score: **${audit.overallScore}/100**
- Engineering Console canvas consistency: **${audit.scores.canvasConsistency}/100**
- Route consistency: **${audit.scores.routeConsistency}/100**
- Component reuse: **${audit.scores.componentReuse}/100**
- Accessibility polish: **${audit.scores.accessibility}/100**
- Visual density risk: **${audit.scores.visualDensityRisk}/100** (higher is worse)
- Legacy pattern risk: **${audit.scores.legacyPatternRisk}/100** (higher is worse)

## Route-Level Findings
| Route / Area | Status | Risk | Main issue | Recommended action |
| --- | --- | --- | --- | --- |
${routeRows}

## Component-Level Findings
Showing the top 40 findings by severity and path.

| File | Finding | Severity | Evidence | Suggested fix |
| --- | --- | --- | --- | --- |
${componentRows}

## Design-System Drift
- Hardcoded colors: **${audit.summary.hardcodedColorFindings}** findings across **${audit.summary.hardcodedColorFiles}** files.
- One-off cards / panel shells: **${audit.summary.panelShellFiles}** files use repeated border/card shell patterns.
- Duplicate overlays: **${audit.summary.overlayComponentCount}** overlay-like component files detected.
- Duplicate badges: **${audit.summary.badgeHeavyFiles}** files repeat badge-like markup.
- Duplicate buttons: **${audit.summary.rawButtonFiles}** files use raw button markup.
- Premium engineering-console components centralized: **${audit.summary.premiumComponentCoverage.present}/${audit.summary.premiumComponentCoverage.total}** expected immersive components found.

## Accessibility Findings
${accessibilityFindings || "- No accessibility findings were emitted by the current static heuristics."}

## Density Findings
${densityFindings || "- No density findings were emitted by the current static heuristics."}

## Recommended Remediation Plan
${phases}

## Do Not Change
- Governance rules and role checks
- Backend workflow authority
- Audit ledger logic
- Approval and release controls
- PR creation and release gates
- Any automation boundaries around run, PR, merge, deploy, or sign-off
`;
}

export async function buildUiConsistencyAudit({ repoRoot } = {}) {
  const resolvedRoot = repoRoot ? path.resolve(repoRoot) : path.resolve(__dirname, "..");
  const filePaths = uniqueSorted(
    (
      await Promise.all(INCLUDED_SOURCE_DIRS.map((relativeDir) => collectFiles(resolvedRoot, relativeDir)))
    ).flat(),
  );
  const extraFiles = ["package.json", "postcss.config.mjs"];
  const existingExtraFiles = [];
  for (const extraFile of extraFiles) {
    if (await exists(path.join(resolvedRoot, extraFile))) {
      existingExtraFiles.push(extraFile);
    }
  }

  const allPaths = uniqueSorted([...filePaths, ...existingExtraFiles]);
  const fileMap = new Map();
  for (const filePath of allPaths) {
    fileMap.set(filePath, await fs.readFile(path.join(resolvedRoot, filePath), "utf8"));
  }

  const findings = [];
  const findingSeen = new Set();
  const globalContext = {
    rawButtonFiles: 0,
    panelShellFiles: 0,
    hardcodedColorFiles: 0,
    badgeHeavyFiles: 0,
    accessibilityFiles: 0,
    densityFiles: 0,
    legacyFiles: 0,
    focusVisibleFiles: [...fileMap.entries()].filter(([, content]) => content.includes("focus-visible:")).length,
  };

  for (const [filePath, content] of fileMap.entries()) {
    if (!filePath.startsWith("src/app/") && !filePath.startsWith("src/components/")) {
      continue;
    }
    for (const finding of analyzeFile(filePath, content, globalContext)) {
      pushFinding(findings, findingSeen, finding);
    }
  }

  const componentPaths = [...fileMap.keys()].filter((filePath) => filePath.startsWith("src/components/"));
  const docPaths = [...fileMap.keys()].filter((filePath) => filePath.startsWith("docs/") && filePath.endsWith(".md"));
  const overlayComponentCount = componentPaths.filter((filePath) =>
    /(overlay|drawer|issue-center|inspector|floating-menu)/.test(path.basename(filePath)),
  ).length;
  const navComponentCount = componentPaths.filter((filePath) =>
    /(route-shell|top-bar|bottom-dock|floating-menu|quick-nav|toolbar)/.test(path.basename(filePath)),
  ).length;
  const sharedUiFolderPresent = componentPaths.some((filePath) => filePath.startsWith("src/components/ui/"));
  const genericButtonPrimitivePresent = componentPaths.some((filePath) =>
    /src\/components\/(?:ui\/)?button\.(tsx|ts|jsx|js)$/.test(filePath),
  );
  const genericCardPrimitivePresent = componentPaths.some((filePath) =>
    /src\/components\/(?:ui\/)?(?:card|surface)\.(tsx|ts|jsx|js)$/.test(filePath),
  );
  const escapeHandlersPresent = [...fileMap.entries()].some(
    ([filePath, content]) => filePath.startsWith("src/components/engineer-console/") && hasEscapeHandling(content),
  );

  if (!sharedUiFolderPresent) {
    pushFinding(findings, findingSeen, {
      file: "src/components",
      category: "component-reuse",
      severity: "medium",
      message: "No shared `src/components/ui` design-system layer was found.",
      evidence: "Audit found bespoke feature components but no generic `components/ui` directory.",
      suggestedFix: "If shared primitives are becoming widespread, introduce them intentionally instead of continuing ad hoc feature-level styling.",
    });
  }

  if (!genericButtonPrimitivePresent && globalContext.rawButtonFiles >= 10) {
    pushFinding(findings, findingSeen, {
      file: "src/components",
      category: "component-reuse",
      severity: "high",
      message: "Raw button usage is widespread without a shared Button primitive.",
      evidence: `${globalContext.rawButtonFiles} component files include raw \`<button>\` elements.`,
      suggestedFix: "Introduce a reusable button primitive or at least a smaller button style vocabulary before further visual polish spreads.",
    });
  }

  if (!genericCardPrimitivePresent && globalContext.panelShellFiles >= 12) {
    pushFinding(findings, findingSeen, {
      file: "src/components",
      category: "component-reuse",
      severity: "high",
      message: "Repeated panel/card shells appear without a shared surface primitive.",
      evidence: `${globalContext.panelShellFiles} files repeat border/card shell patterns.`,
      suggestedFix: "Create a shared surface/panel primitive or refactor repeated shells into fewer reusable wrappers.",
    });
  }

  if (overlayComponentCount >= 5) {
    pushFinding(findings, findingSeen, {
      file: "src/components/engineer-console",
      category: "component-reuse",
      severity: "medium",
      message: "Multiple overlay-like implementations increase drift risk across drawers, windows, and issue centers.",
      evidence: `${overlayComponentCount} overlay-like component files detected.`,
      suggestedFix: "Keep converging overlay shells around shared window/drawer primitives rather than adding new bespoke wrappers.",
    });
  }

  if (navComponentCount >= 5) {
    pushFinding(findings, findingSeen, {
      file: "src/components/engineer-console",
      category: "component-reuse",
      severity: "medium",
      message: "Navigation chrome is implemented across several separate patterns.",
      evidence: `${navComponentCount} nav/chrome component files detected across route shell, menu, dock, top bar, toolbar, and quick nav.`,
      suggestedFix: "Audit shared spacing, focus, chip, and active-state rules across nav patterns before more route-specific variants appear.",
    });
  }

  if (!escapeHandlersPresent && overlayComponentCount > 0) {
    pushFinding(findings, findingSeen, {
      file: "src/components/engineer-console",
      category: "accessibility",
      severity: "high",
      message: "Overlay-like surfaces were found without any detectable Escape handling in engineer-console components.",
      evidence: `${overlayComponentCount} overlay-like files detected and no Escape handling found.`,
      suggestedFix: "Add or centralize Escape handling in the owning shells for overlays, drawers, and menus.",
    });
  }

  const sortedFindings = [...findings].sort((left, right) => {
    const severityDiff = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    if (severityDiff !== 0) return severityDiff;
    const fileDiff = left.file.localeCompare(right.file);
    if (fileDiff !== 0) return fileDiff;
    return left.message.localeCompare(right.message);
  });

  const canvasFiles = sortedFindings.filter((finding) =>
    /(engineering-console-canvas-home|workflow-canvas|canvas-|dashboard-issue-center)/.test(finding.file),
  );
  const accessibilityFindings = sortedFindings.filter((finding) => finding.category === "accessibility");
  const densityFindings = sortedFindings.filter((finding) => finding.category === "density");
  const legacyFindings = sortedFindings.filter((finding) => finding.category === "legacy-layout");
  const componentReuseFindings = sortedFindings.filter((finding) => finding.category === "component-reuse");

  const canvasConsistency = clamp(
    100 - Math.round(canvasFiles.reduce((total, finding) => total + SEVERITY_PENALTY[finding.severity], 0) * 0.7),
    0,
    100,
  );
  const componentReuse = clamp(
    100 -
      Math.round(componentReuseFindings.reduce((total, finding) => total + SEVERITY_PENALTY[finding.severity], 0) * 0.8),
    0,
    100,
  );
  const accessibility = clamp(
    100 - Math.round(accessibilityFindings.reduce((total, finding) => total + SEVERITY_PENALTY[finding.severity], 0) * 0.75),
    0,
    100,
  );
  const visualDensityRisk = clamp(
    Math.round(densityFindings.reduce((total, finding) => total + SEVERITY_PENALTY[finding.severity], 0) * 0.7),
    0,
    100,
  );
  const legacyPatternRisk = clamp(
    Math.round(legacyFindings.reduce((total, finding) => total + SEVERITY_PENALTY[finding.severity], 0) * 0.45),
    0,
    100,
  );

  const routeFindings = UI_AUDIT_ROUTE_AREAS.map((routeArea) => {
    const routeFiles = routeArea.files.filter((filePath) => fileMap.has(filePath));
    return collectRouteFinding(routeArea, routeFiles, sortedFindings);
  });
  const routeConsistency = Math.round(
    routeFindings.reduce((total, routeFinding) => total + routeFinding.score, 0) /
      Math.max(routeFindings.length, 1),
  );

  const overallScore = Math.round(
    0.25 * canvasConsistency +
      0.25 * routeConsistency +
      0.2 * componentReuse +
      0.2 * accessibility +
      0.05 * (100 - visualDensityRisk) +
      0.05 * (100 - legacyPatternRisk),
  );

  const severityCounts = sortedFindings.reduce(
    (counts, finding) => ({
      ...counts,
      [finding.severity]: counts[finding.severity] + 1,
    }),
    { critical: 0, high: 0, medium: 0, low: 0 },
  );
  const premiumComponentPresent = PREMIUM_COMPONENTS.filter(([, filePath]) => fileMap.has(filePath)).length;
  const topRisks = buildTopRisks(sortedFindings);
  const topStrengths = buildStrengths(globalContext, fileMap, docPaths);
  const recommendedPlan = buildRecommendedPlan(sortedFindings, globalContext);

  const audit = {
    overallScore,
    scores: {
      canvasConsistency,
      routeConsistency,
      componentReuse,
      accessibility,
      visualDensityRisk,
      legacyPatternRisk,
    },
    findings: sortedFindings,
    routeFindings,
    recommendedPlan,
    topRisks,
    topStrengths,
    recommendedNextAction:
      topRisks[0]?.message ??
      "No high-severity drift surfaced; continue with route-by-route visual review only when the product team is ready.",
    summary: {
      severityCounts,
      severitySummary: describeSeverity(severityCounts),
      rawButtonFiles: globalContext.rawButtonFiles,
      panelShellFiles: globalContext.panelShellFiles,
      hardcodedColorFiles: globalContext.hardcodedColorFiles,
      hardcodedColorFindings: summarizeCounts(sortedFindings, "inconsistent-styling"),
      badgeHeavyFiles: globalContext.badgeHeavyFiles,
      accessibilityFiles: globalContext.accessibilityFiles,
      densityFiles: globalContext.densityFiles,
      legacyFiles: globalContext.legacyFiles,
      overlayComponentCount,
      navComponentCount,
      premiumComponentCoverage: {
        present: premiumComponentPresent,
        total: PREMIUM_COMPONENTS.length,
      },
      sharedUiFolderPresent,
      genericButtonPrimitivePresent,
      genericCardPrimitivePresent,
      escapeHandlersPresent,
      docsWithUiGuidance: docPaths.filter((filePath) =>
        /(ux|architecture|glossary|runbook|guide|audit)/i.test(path.basename(filePath)),
      ).length,
    },
  };

  return audit;
}

export async function writeUiConsistencyAuditReports(audit, { repoRoot, outputDir } = {}) {
  const resolvedRoot = repoRoot ? path.resolve(repoRoot) : path.resolve(__dirname, "..");
  const resolvedOutputDir = outputDir
    ? path.resolve(outputDir)
    : path.join(resolvedRoot, UI_AUDIT_OUTPUT_DIR);
  await fs.mkdir(resolvedOutputDir, { recursive: true });

  const markdownPath = path.join(resolvedOutputDir, UI_AUDIT_OUTPUT_FILES.markdown);
  const jsonPath = path.join(resolvedOutputDir, UI_AUDIT_OUTPUT_FILES.json);

  await fs.writeFile(markdownPath, `${renderMarkdownReport(audit)}\n`, "utf8");
  await fs.writeFile(jsonPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

  return {
    markdownPath,
    jsonPath,
  };
}

export async function runUiConsistencyAudit(options = {}) {
  const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : path.resolve(__dirname, "..");
  const audit = await buildUiConsistencyAudit({ repoRoot });
  const outputs = await writeUiConsistencyAuditReports(audit, {
    repoRoot,
    outputDir: options.outputDir,
  });
  return {
    audit,
    ...outputs,
  };
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const { audit, markdownPath, jsonPath } = await runUiConsistencyAudit({ repoRoot });
  console.log("VeraLux UI consistency audit complete.");
  console.log(`  Overall score: ${audit.overallScore}/100`);
  console.log(`  Findings:      ${audit.findings.length} (${audit.summary.severitySummary})`);
  console.log(`  Markdown:      ${path.relative(repoRoot, markdownPath)}`);
  console.log(`  JSON:          ${path.relative(repoRoot, jsonPath)}`);
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("audit-ui-consistency.mjs") || process.argv[1].includes("audit-ui-consistency"));

if (isMain) {
  main().catch((error) => {
    console.error("UI consistency audit failed.");
    console.error(error);
    process.exit(1);
  });
}
