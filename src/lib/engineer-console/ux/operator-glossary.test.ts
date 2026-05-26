import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvidenceBundlePanel } from "@/components/engineer-console/evidence-bundle-panel";
import { OperatorHelp } from "@/components/engineer-console/operator-help";
import { PolicyResultsPanel } from "@/components/engineer-console/policy-results-panel";
import { PrCreationPanel } from "@/components/engineer-console/pr-creation-panel";
import { ReleaseChecklistPanel } from "@/components/engineer-console/release-checklist-panel";
import { ReleaseSignoffPanel } from "@/components/engineer-console/release-signoff-panel";
import { ReplayVerificationPanel } from "@/components/engineer-console/replay-verification-panel";
import {
  OPERATOR_GLOSSARY,
  REQUIRED_OPERATOR_GLOSSARY_TERMS,
} from "./operator-glossary";

describe("operator glossary and help", () => {
  it("contains all required glossary terms", () => {
    for (const term of REQUIRED_OPERATOR_GLOSSARY_TERMS) {
      expect(OPERATOR_GLOSSARY[term]).toBeDefined();
      expect(OPERATOR_GLOSSARY[term].plainEnglish.length).toBeGreaterThan(0);
      expect(OPERATOR_GLOSSARY[term].whyItMatters.length).toBeGreaterThan(0);
      expect(OPERATOR_GLOSSARY[term].operatorAction.length).toBeGreaterThan(0);
    }
  });

  it("renders operator help as a native disclosure", () => {
    const html = renderToStaticMarkup(
      React.createElement(OperatorHelp, {
        term: "evidence_bundle",
        label: "What is an evidence bundle?",
      }),
    );

    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("Plain English:");
    expect(html).toContain("A saved snapshot of the run facts used for review and audit.");
  });

  it("renders passive help text without mutation controls", () => {
    const html = renderToStaticMarkup(
      React.createElement(OperatorHelp, {
        term: "release_signoff",
        label: "What is release sign-off?",
      }),
    );

    expect(html).not.toContain("type=\"submit\"");
    expect(html).not.toContain("<form");
    expect(html).toContain("What to do next:");
  });

  it("evidence panel shows plain-English help", () => {
    const html = renderToStaticMarkup(
      React.createElement(EvidenceBundlePanel, { runId: "run-123" }),
    );

    expect(html).toContain("What is an evidence bundle?");
    expect(html).toContain("Generate or refresh evidence");
  });

  it("replay panel shows plain-English help", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReplayVerificationPanel, { runId: "run-123" }),
    );

    expect(html).toContain("What is replay verification?");
    expect(html).toContain("Check replay");
  });

  it("policy panel shows plain-English help", () => {
    const html = renderToStaticMarkup(
      React.createElement(PolicyResultsPanel, { runId: "run-123" }),
    );

    expect(html).toContain("What is governance policy?");
    expect(html).toContain("Evaluate policy");
  });

  it("pr creation panel shows readiness help and preserves technical details", () => {
    const html = renderToStaticMarkup(
      React.createElement(PrCreationPanel, { runId: "run-123" }),
    );

    expect(html).toContain("What is PR readiness?");
    expect(html).toContain("safe draft PR");
    expect(html).toContain("Technical readiness details");
  });

  it("release checklist and sign-off panels render glossary help", () => {
    const checklistHtml = renderToStaticMarkup(
      React.createElement(ReleaseChecklistPanel, { runId: "run-123" }),
    );
    const signoffHtml = renderToStaticMarkup(
      React.createElement(ReleaseSignoffPanel, { runId: "run-123" }),
    );

    expect(checklistHtml).toContain("What is the release checklist?");
    expect(signoffHtml).toContain("What is release sign-off?");
  });
});
