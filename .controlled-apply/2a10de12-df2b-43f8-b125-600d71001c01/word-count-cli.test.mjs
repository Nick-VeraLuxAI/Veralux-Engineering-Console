import assert from "node:assert/strict";
import test from "node:test";
import { analyzeText } from "./word-count-cli.mjs";

test("analyzes word, character, and repeated word counts", () => {
  const result = analyzeText("Alpha beta beta gamma gamma gamma");
  assert.equal(result.wordCount, 6);
  assert.equal(result.characterCount, 33);
  assert.deepEqual(result.topWords.slice(0, 3), [
    { word: "gamma", count: 3 },
    { word: "beta", count: 2 },
    { word: "alpha", count: 1 },
  ]);
});
