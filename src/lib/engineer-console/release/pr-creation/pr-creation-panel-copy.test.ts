import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  formatPrCreationErrorMessage,
  PrCreationPanel,
} from "@/components/engineer-console/pr-creation-panel";

describe("PrCreationPanel copy", () => {
  it("renders the loading copy with a space before PR history", () => {
    const html = renderToStaticMarkup(React.createElement(PrCreationPanel, { runId: "run-1" }));

    expect(html).toContain("Loading PR history…");
    expect(html).not.toContain("LoadingPR history…");
  });

  it("adds next-action guidance for GitHub PR validation errors", () => {
    expect(
      formatPrCreationErrorMessage("Invalid GitHub PR body: contains control characters."),
    ).toBe(
      "Invalid GitHub PR body: contains control characters. Next action: update the body and retry draft PR creation.",
    );
  });
});
