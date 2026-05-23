export interface JsonParseResult {
  success: boolean;
  rawText: string;
  jsonText: string | null;
  parsed: unknown | null;
  errors: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tryParseObject(text: string): { ok: true; parsed: unknown } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isPlainObject(parsed)) {
      return { ok: false, error: "JSON must be a single object" };
    }
    return { ok: true, parsed };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}

function extractFencedBlocks(raw: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const body = match[1].trim();
    if (body) blocks.push(body);
  }
  return blocks;
}

function findBalancedJsonObjects(raw: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        candidates.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

export function parseJsonModelOutput(raw: string): JsonParseResult {
  const rawText = raw ?? "";
  const trimmed = rawText.trim();

  if (!trimmed) {
    return {
      success: false,
      rawText,
      jsonText: null,
      parsed: null,
      errors: ["Model output is empty"],
    };
  }

  const direct = tryParseObject(trimmed);
  if (direct.ok) {
    return {
      success: true,
      rawText,
      jsonText: trimmed,
      parsed: direct.parsed,
      errors: [],
    };
  }

  const fenced = extractFencedBlocks(trimmed);
  const fencedParsable: Array<{ jsonText: string; parsed: unknown }> = [];

  for (const block of fenced) {
    const result = tryParseObject(block);
    if (result.ok) {
      fencedParsable.push({ jsonText: block, parsed: result.parsed });
    }
  }

  if (fencedParsable.length === 1) {
    return {
      success: true,
      rawText,
      jsonText: fencedParsable[0].jsonText,
      parsed: fencedParsable[0].parsed,
      errors: [],
    };
  }

  if (fencedParsable.length > 1) {
    return {
      success: false,
      rawText,
      jsonText: null,
      parsed: null,
      errors: ["Multiple JSON objects found in fenced code blocks"],
    };
  }

  const balanced = findBalancedJsonObjects(trimmed);
  const balancedParsable: Array<{ jsonText: string; parsed: unknown }> = [];

  for (const candidate of balanced) {
    const result = tryParseObject(candidate);
    if (result.ok) {
      balancedParsable.push({ jsonText: candidate, parsed: result.parsed });
    }
  }

  if (balancedParsable.length === 1) {
    return {
      success: true,
      rawText,
      jsonText: balancedParsable[0].jsonText,
      parsed: balancedParsable[0].parsed,
      errors: [],
    };
  }

  if (balancedParsable.length > 1) {
    return {
      success: false,
      rawText,
      jsonText: null,
      parsed: null,
      errors: ["Multiple JSON objects found in model output"],
    };
  }

  return {
    success: false,
    rawText,
    jsonText: null,
    parsed: null,
    errors: [direct.error, "Could not extract a single JSON object from model output"],
  };
}
