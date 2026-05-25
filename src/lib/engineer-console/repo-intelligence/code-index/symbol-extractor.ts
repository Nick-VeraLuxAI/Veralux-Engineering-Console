import type { ExtractedSymbol } from "./code-index-types";

const JS_LANGS = new Set(["typescript", "typescriptreact", "javascript", "javascriptreact"]);

export function extractSymbolsFromContent(content: string, language: string): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (JS_LANGS.has(language)) {
      let match = line.match(/^(export\s+)?((?:async\s+)?function\s+(\w+))/);
      if (match) {
        symbols.push({
          name: match[3],
          kind: "function",
          lineStart: lineNum,
          lineEnd: lineNum,
          signature: match[2].slice(0, 200),
          exported: !!match[1],
        });
        continue;
      }

      match = line.match(/^(export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*\w[^=]*)?\s*=\s*(?:async\s+)?\(/);
      if (match) {
        symbols.push({
          name: match[2],
          kind: "function",
          lineStart: lineNum,
          lineEnd: lineNum,
          signature: `const ${match[2]}`.slice(0, 200),
          exported: !!match[1],
        });
        continue;
      }

      match = line.match(/^(export\s+)?((?:abstract\s+)?class\s+(\w+))/);
      if (match) {
        symbols.push({
          name: match[3],
          kind: "class",
          lineStart: lineNum,
          lineEnd: lineNum,
          signature: match[2].slice(0, 200),
          exported: !!match[1],
        });
        continue;
      }

      match = line.match(/^(export\s+)?((?:interface|type)\s+(\w+))/);
      if (match) {
        const kind = match[2].startsWith("interface") ? "interface" : "type";
        symbols.push({
          name: match[3],
          kind,
          lineStart: lineNum,
          lineEnd: lineNum,
          signature: match[2].slice(0, 200),
          exported: !!match[1],
        });
        continue;
      }

      match = line.match(/^(export\s+)?(enum\s+(\w+))/);
      if (match) {
        symbols.push({
          name: match[3],
          kind: "enum",
          lineStart: lineNum,
          lineEnd: lineNum,
          signature: match[2].slice(0, 200),
          exported: !!match[1],
        });
      }
      continue;
    }

    if (language === "python") {
      let match = line.match(/^(class\s+(\w+))/);
      if (match) {
        symbols.push({
          name: match[2],
          kind: "class",
          lineStart: lineNum,
          lineEnd: lineNum,
          signature: match[1].slice(0, 200),
          exported: !match[2].startsWith("_"),
        });
        continue;
      }

      match = line.match(/^((?:async\s+)?def\s+(\w+))/);
      if (match) {
        symbols.push({
          name: match[2],
          kind: "function",
          lineStart: lineNum,
          lineEnd: lineNum,
          signature: match[1].slice(0, 200),
          exported: !match[2].startsWith("_"),
        });
      }
      continue;
    }

    if (language === "markdown") {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        symbols.push({
          name: match[2].trim().slice(0, 120),
          kind: `heading_${level}`,
          lineStart: lineNum,
          lineEnd: lineNum,
          signature: line.trim().slice(0, 200),
          exported: true,
        });
      }
    }
  }

  return symbols;
}
