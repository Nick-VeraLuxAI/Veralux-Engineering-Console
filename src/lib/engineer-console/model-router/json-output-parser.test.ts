import { describe, expect, it } from "vitest";
import { parseJsonModelOutput } from "./json-output-parser";

describe("parseJsonModelOutput", () => {
  it("parses plain JSON object", () => {
    const result = parseJsonModelOutput('{"runId":"r1","summary":"x","allowedFiles":[],"operations":[]}');
    expect(result.success).toBe(true);
    expect(result.parsed).toMatchObject({ runId: "r1" });
  });

  it("parses json fenced block", () => {
    const result = parseJsonModelOutput(
      'Here is the plan:\n```json\n{"runId":"r1","summary":"x","allowedFiles":[],"operations":[]}\n```',
    );
    expect(result.success).toBe(true);
    expect(result.jsonText).toContain("runId");
  });

  it("parses generic fenced block", () => {
    const result = parseJsonModelOutput(
      '```\n{"runId":"r1","summary":"x","allowedFiles":[],"operations":[]}\n```',
    );
    expect(result.success).toBe(true);
  });

  it("rejects empty output", () => {
    const result = parseJsonModelOutput("   ");
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("empty");
  });

  it("rejects multiple JSON objects", () => {
    const result = parseJsonModelOutput('{"a":1}{"b":2}');
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("Multiple"))).toBe(true);
  });

  it("captures malformed JSON", () => {
    const result = parseJsonModelOutput("{ not valid json");
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
