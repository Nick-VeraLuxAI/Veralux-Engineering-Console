import fs from "node:fs";

export function analyzeText(text) {
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const counts = new Map();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const topWords = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([word, count]) => ({ word, count }));
  return { wordCount: words.length, characterCount: text.length, topWords };
}

export function analyzeFile(filePath) {
  return analyzeText(fs.readFileSync(filePath, "utf8"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node word-count-cli.mjs <file>");
    process.exit(1);
  }
  console.log(JSON.stringify(analyzeFile(filePath), null, 2));
}
