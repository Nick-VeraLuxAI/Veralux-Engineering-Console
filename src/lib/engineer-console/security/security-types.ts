export const OPERATOR_ROLES = ["admin", "operator", "viewer"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export interface OperatorAccount {
  id: string;
  email: string;
  displayName: string;
  role: OperatorRole;
  createdAt: string;
  updatedAt: string;
}

export interface AuthenticatedOperator {
  id: string;
  email: string;
  displayName: string;
  role: OperatorRole;
  sessionId: string;
}

export interface HumanActorIdentity {
  actorType: "human";
  actorLabel: string;
  operatorId: string;
}

export const LOCAL_DEV_OPERATOR: AuthenticatedOperator = {
  id: "local-dev-operator",
  email: "local-dev@engineer-console",
  displayName: "Local Dev Operator",
  role: "admin",
  sessionId: "local-dev-session",
};
