export const GOVERNANCE_ACTOR_ROLES = ["approver", "executor", "release_authorizer"] as const;
export type GovernanceActorRole = (typeof GOVERNANCE_ACTOR_ROLES)[number];

export interface GovernanceActor {
  actorId: string;
  displayName: string;
  role: GovernanceActorRole;
}

export type ProtectedApplyDecision =
  | { allowed: true; approver: GovernanceActor; executor: GovernanceActor }
  | {
      allowed: false;
      code: "APPLY_GRANT_MISSING" | "EXECUTOR_SELF_AUTHORIZE_FORBIDDEN" | "AUTONOMOUS_EXECUTOR_FORBIDDEN";
      reason: string;
    };

function normalizeActorId(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function mapOperatorRoleToGovernanceActor(
  operatorRole: "admin" | "operator" | "viewer" | string,
  action: "grant" | "apply" | "release",
): GovernanceActorRole {
  if (action === "release") return "release_authorizer";
  if (action === "grant") return operatorRole === "admin" ? "approver" : "approver";
  return "executor";
}

export function assertProtectedApplyAuthority(input: {
  grant: { actorId: string; displayName: string; role?: string } | null;
  executor: { actorId: string; displayName: string; role?: string };
}): ProtectedApplyDecision {
  if (!input.grant || !normalizeActorId(input.grant.actorId || input.grant.displayName)) {
    return {
      allowed: false,
      code: "APPLY_GRANT_MISSING",
      reason: "Protected apply requires a recorded approver grant before the executor may perform it.",
    };
  }

  const executorId = normalizeActorId(input.executor.actorId || input.executor.displayName);
  if (executorId === "autonomous_executor" || input.executor.role === "autonomous_executor") {
    return {
      allowed: false,
      code: "AUTONOMOUS_EXECUTOR_FORBIDDEN",
      reason: "Autonomous executor cannot perform protected apply.",
    };
  }

  const approverId = normalizeActorId(input.grant.actorId || input.grant.displayName);
  if (approverId === executorId) {
    return {
      allowed: false,
      code: "EXECUTOR_SELF_AUTHORIZE_FORBIDDEN",
      reason: "Executor cannot self-authorize protected apply. Approver must grant, then a different executor may perform.",
    };
  }

  return {
    allowed: true,
    approver: {
      actorId: input.grant.actorId || input.grant.displayName,
      displayName: input.grant.displayName,
      role: "approver",
    },
    executor: {
      actorId: input.executor.actorId || input.executor.displayName,
      displayName: input.executor.displayName,
      role: "executor",
    },
  };
}
