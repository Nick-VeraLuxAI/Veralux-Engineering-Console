import { AUDIT_ACTOR_TYPES } from "../governance/audit-ledger/audit-event-types";
import { isAuthEnabled } from "./auth-config";
import type { AuthenticatedOperator, HumanActorIdentity } from "./security-types";
import { LOCAL_DEV_OPERATOR } from "./security-types";

export function resolveHumanActor(
  operator: AuthenticatedOperator,
  clientActorLabel?: string | null,
): HumanActorIdentity {
  if (!isAuthEnabled()) {
    return {
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: clientActorLabel?.trim() || LOCAL_DEV_OPERATOR.displayName,
      operatorId: LOCAL_DEV_OPERATOR.id,
    };
  }

  return {
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: operator.displayName || operator.email,
    operatorId: operator.id,
  };
}
