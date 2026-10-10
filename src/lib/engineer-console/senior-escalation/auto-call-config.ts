/**
 * Env-gated senior auto-call for the AE loop. Constants in types.ts stay false so
 * unit tests and unset env remain manual-only; operator .env.local enables live auto.
 */
export const SENIOR_ESCALATION_AUTO_CALL_ENV = "ENGINEER_CONSOLE_SENIOR_ESCALATION_AUTO_CALL" as const;

export function isSeniorEscalationAutoCallAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SENIOR_ESCALATION_AUTO_CALL_ENV]?.trim() === "true";
}

export function isSeniorEscalationWiredIntoAeLoop(env: NodeJS.ProcessEnv = process.env): boolean {
  return isSeniorEscalationAutoCallAllowed(env);
}

export function isSeniorInvocationWiredIntoAeLoop(env: NodeJS.ProcessEnv = process.env): boolean {
  return isSeniorEscalationAutoCallAllowed(env);
}
