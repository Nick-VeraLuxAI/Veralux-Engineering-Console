import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "./audit-event-types";
import { requireAuditEvent } from "./append-audit-event";
import { hashRepoPathForAudit } from "../../repo-intelligence/registered-repos/repo-path-policy";

function repoPayload(repoId: string, repoName: string, repoPath: string, extra: Record<string, unknown> = {}) {
  return {
    repoId,
    repoName,
    pathRef: hashRepoPathForAudit(repoPath),
    ...extra,
  };
}

export function auditRepoRegistered(repoId: string, repoName: string, repoPath: string) {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.REPO_REGISTERED,
    entityType: AUDIT_ENTITY_TYPES.REPO,
    entityId: repoId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    payload: repoPayload(repoId, repoName, repoPath),
  });
}

export function auditRepoVerified(repoId: string, repoName: string, repoPath: string) {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.REPO_VERIFIED,
    entityType: AUDIT_ENTITY_TYPES.REPO,
    entityId: repoId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    payload: repoPayload(repoId, repoName, repoPath, { verificationStatus: "ok" }),
  });
}

export function auditRepoVerificationFailed(
  repoId: string,
  repoName: string,
  repoPath: string,
  status: string,
) {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.REPO_VERIFICATION_FAILED,
    entityType: AUDIT_ENTITY_TYPES.REPO,
    entityId: repoId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    payload: repoPayload(repoId, repoName, repoPath, { verificationStatus: status }),
  });
}

export function auditPackageScriptsDetected(
  repoId: string,
  repoName: string,
  repoPath: string,
  scriptNames: string[],
) {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.PACKAGE_SCRIPTS_DETECTED,
    entityType: AUDIT_ENTITY_TYPES.REPO,
    entityId: repoId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    payload: repoPayload(repoId, repoName, repoPath, {
      scriptNames,
      scriptCount: scriptNames.length,
    }),
  });
}

export function auditTestProfileDetected(
  repoId: string,
  repoName: string,
  repoPath: string,
  runner: string,
  confidence: string,
) {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.TEST_PROFILE_DETECTED,
    entityType: AUDIT_ENTITY_TYPES.REPO,
    entityId: repoId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    payload: repoPayload(repoId, repoName, repoPath, { runner, confidence }),
  });
}
