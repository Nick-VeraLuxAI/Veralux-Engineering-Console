#!/usr/bin/env node
import fs from "node:fs";

export function analyzeText(text) {
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const counts = new Map();
  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const topRepeatedWords = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([word, count]) => ({ word, count }));
  return {
    wordCount: words.length,
    characterCount: text.length,
    topRepeatedWords,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: word-count-cli.mjs <text-file>");
    process.exit(2);
  }
  const text = fs.readFileSync(inputPath, "utf8");
  console.log(JSON.stringify(analyzeText(text), null, 2));
}
