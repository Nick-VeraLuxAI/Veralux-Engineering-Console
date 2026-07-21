/** Durable S15 review-bundle store (atomic JSON). */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import type { SeniorReviewBundle } from "./types";
import { utcNow } from "./comparison";

function atomicWriteJson(filePath: string, payload: unknown): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
  renameSync(tmp, filePath);
}

export class SeniorReviewBundleStore {
  readonly root: string;

  constructor(root: string) {
    if (root.includes("/mnt/large-storage")) {
      throw new Error("rejected_large_storage_path");
    }
    this.root = root;
    mkdirSync(path.join(root, "bundles"), { recursive: true });
    mkdirSync(path.join(root, "operator-decisions"), { recursive: true });
    mkdirSync(path.join(root, "comparisons"), { recursive: true });
    mkdirSync(path.join(root, "execution-approvals"), { recursive: true });
    mkdirSync(path.join(root, "senior-correlations"), { recursive: true });
  }

  private bundlePath(id: string): string {
    return path.join(this.root, "bundles", `${id}.json`);
  }

  write(bundle: SeniorReviewBundle): SeniorReviewBundle {
    const next = { ...bundle, updatedAt: utcNow() };
    atomicWriteJson(this.bundlePath(bundle.reviewBundleId), next);
    if (next.comparison) {
      atomicWriteJson(path.join(this.root, "comparisons", `${next.comparison.comparisonId}.json`), next.comparison);
    }
    if (next.operatorDecision) {
      atomicWriteJson(
        path.join(this.root, "operator-decisions", `${next.operatorDecision.decisionId}.json`),
        next.operatorDecision,
      );
    }
    if (next.seniorReviewRequest) {
      atomicWriteJson(
        path.join(this.root, "senior-correlations", `${next.seniorReviewRequest.s14CorrelationId}.json`),
        {
          reviewBundleId: next.reviewBundleId,
          ...next.seniorReviewRequest,
          writtenAt: utcNow(),
        },
      );
    }
    return next;
  }

  read(reviewBundleId: string): SeniorReviewBundle | null {
    const p = this.bundlePath(reviewBundleId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as SeniorReviewBundle;
  }

  list(): SeniorReviewBundle[] {
    const dir = path.join(this.root, "bundles");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as SeniorReviewBundle);
  }

  listNonterminal(): SeniorReviewBundle[] {
    const terminal = new Set([
      "default_only",
      "senior_accepted",
      "senior_rejected",
      "default_retained",
      "senior_cancelled",
      "senior_failed",
      "senior_execution_blocked",
      "stale",
    ]);
    // default_only is terminal for "no senior" path but recoverable; treat nonterminal as pending paths
    return this.list().filter(
      (b) =>
        b.state === "pending_operator_review" ||
        b.state === "senior_requested" ||
        b.state === "senior_executing" ||
        b.state === "senior_completed" ||
        b.state === "comparison_ready" ||
        b.state === "senior_recovery_required" ||
        b.state === "revision_requested" ||
        !terminal.has(b.state),
    );
  }

  writeExecutionApproval(approvalReference: string, artifact: unknown): void {
    atomicWriteJson(path.join(this.root, "execution-approvals", `${approvalReference}.json`), artifact);
  }

  markDecisionConsumed(decisionId: string): void {
    const p = path.join(this.root, "operator-decisions", `${decisionId}.json`);
    if (!existsSync(p)) return;
    const decision = JSON.parse(readFileSync(p, "utf8")) as { consumed?: boolean };
    decision.consumed = true;
    atomicWriteJson(p, decision);
  }
}
