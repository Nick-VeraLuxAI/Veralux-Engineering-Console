/**
 * Repair common model JSON-over-escape mistakes in worker plan file bodies.
 */
export function sanitizeWorkerPlanFileContent(content: string): string {
  if (!content) return content;
  let out = content;

  const looksJsonEscaped =
    out.includes('\\"') &&
    (out.includes('from \\"') ||
      out.includes('import \\"') ||
      out.includes('describe\\(') ||
      out.includes('it\\(') ||
      out.includes('require\\('));

  if (looksJsonEscaped) {
    out = out.replace(/\\"/g, '"').replace(/\\'/g, "'");
  }

  if (out.includes("\\n") && !out.includes("\n") && out.length > 20) {
    out = out.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }

  return out;
}

export function hasJsonOverEscapedSource(content: string): boolean {
  if (!content) return false;
  return (
    content.includes('\\"') &&
    (content.includes('from \\"') ||
      content.includes('import \\"') ||
      content.includes('describe\\(') ||
      content.includes('it\\('))
  );
}
