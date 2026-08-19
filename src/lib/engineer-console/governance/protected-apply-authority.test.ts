import { describe, expect, it } from "vitest";
import { assertProtectedApplyAuthority } from "./protected-apply-authority";

describe("protected apply authority split", () => {
  it("forbids executor self-authorization of protected apply", () => {
    const decision = assertProtectedApplyAuthority({
      grant: { actorId: "op-1", displayName: "Same Person", role: "approver" },
      executor: { actorId: "op-1", displayName: "Same Person", role: "executor" },
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("EXECUTOR_SELF_AUTHORIZE_FORBIDDEN");
    }
  });

  it("allows a distinct executor after an approver grant", () => {
    const decision = assertProtectedApplyAuthority({
      grant: { actorId: "admin-1", displayName: "Approver", role: "approver" },
      executor: { actorId: "op-2", displayName: "Executor", role: "executor" },
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.approver.role).toBe("approver");
      expect(decision.executor.role).toBe("executor");
    }
  });

  it("fails closed when the grant is missing", () => {
    const decision = assertProtectedApplyAuthority({
      grant: null,
      executor: { actorId: "op-2", displayName: "Executor", role: "executor" },
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("APPLY_GRANT_MISSING");
    }
  });
});
