import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { analyzeText } from "./word-count-cli.mjs";

const sample = fs.readFileSync("./sample.txt", "utf8");

test("analyzeText reports counts and top repeated words", () => {
  assert.deepEqual(analyzeText(sample), {
    wordCount: 10,
    characterCount: sample.length,
    topRepeatedWords: [
      { word: "tiny", count: 3 },
      { word: "builds", count: 2 },
      { word: "hello", count: 2 },
      { word: "tools", count: 1 },
      { word: "vera", count: 1 },
    ],
  });
});

test("CLI prints JSON analysis for a file path", () => {
  const output = execFileSync(process.execPath, ["./word-count-cli.mjs", "./sample.txt"], { encoding: "utf8" });
  const parsed = JSON.parse(output);
  assert.equal(parsed.wordCount, 10);
  assert.equal(parsed.characterCount, sample.length);
  assert.equal(parsed.topRepeatedWords[0].word, "tiny");
});
