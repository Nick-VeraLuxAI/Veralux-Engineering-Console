import { createHash } from "crypto";
import { truncateString } from "../../governance/evidence-bundles/redact-evidence-bundle";

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /api[_-]?key[=:]\s*\S+/gi,
  /secret[=:]\s*\S+/gi,
  /password[=:]\s*\S+/gi,
  /token[=:]\s*\S+/gi,
  /-----BEGIN[A-Z\s]+PRIVATE KEY-----[\s\S]*?-----END[A-Z\s]+PRIVATE KEY-----/gi,
];

const MAX_OUTPUT_SUMMARY = 800;

export function redactDeploymentOutput(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  return truncateString(redacted, MAX_OUTPUT_SUMMARY);
}

export function hashDeploymentOutput(stdout: string, stderr: string): string {
  return createHash("sha256").update(`${stdout}\n---\n${stderr}`, "utf8").digest("hex");
}

export function buildOutputSummary(stdout: string, stderr: string): string {
  const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  return redactDeploymentOutput(combined || "(no output)");
}
