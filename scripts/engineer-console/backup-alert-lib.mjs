import { spawnSync } from "child_process";
import os from "os";
import path from "path";
import { containsLikelySecret } from "./backup-external-lib.mjs";

export const ALERT_MODES = ["none", "webhook"];

/**
 * @param {object} [env]
 */
export function parseAlertConfig(env = process.env) {
  const rawMode = (env.ENGINEER_CONSOLE_BACKUP_ALERT_MODE ?? "none").trim().toLowerCase();
  const mode = ALERT_MODES.includes(rawMode) ? rawMode : "none";
  const onSuccessRaw = (env.ENGINEER_CONSOLE_BACKUP_ALERT_ON_SUCCESS ?? "false").trim().toLowerCase();
  return {
    mode,
    webhookUrl: env.ENGINEER_CONSOLE_BACKUP_ALERT_WEBHOOK_URL?.trim() || null,
    alertOnSuccess: onSuccessRaw === "true" || onSuccessRaw === "1",
    instanceLabel: env.ENGINEER_CONSOLE_INSTANCE_LABEL?.trim() || null,
  };
}

/**
 * @param {string} url
 */
export function validateWebhookUrl(url) {
  if (!url?.trim()) {
    throw new Error("ENGINEER_CONSOLE_BACKUP_ALERT_WEBHOOK_URL is required when alert mode is webhook");
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("ENGINEER_CONSOLE_BACKUP_ALERT_WEBHOOK_URL must be a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("ENGINEER_CONSOLE_BACKUP_ALERT_WEBHOOK_URL must use http or https");
  }
}

/**
 * @param {string | undefined | null} filePath
 */
export function safeBasename(filePath) {
  if (!filePath) return null;
  return path.basename(filePath);
}

/**
 * @param {string} stdout
 */
export function parseSecurePipelineJson(stdout) {
  const lines = stdout.trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.ok === "boolean") return parsed;
    } catch {
      // continue
    }
  }
  throw new Error("Could not parse backup:db:secure JSON summary from stdout");
}

/**
 * @param {object} params
 * @param {'success' | 'failed'} params.status
 * @param {object | null} [params.summary]
 * @param {object} params.config
 * @param {string | null} [params.errorSummary]
 */
export function buildAlertPayload({ status, summary, config, errorSummary }) {
  const hostLabel = config.instanceLabel ?? os.hostname();
  return {
    event: "engineer_console_backup",
    status,
    timestamp: new Date().toISOString(),
    instanceLabel: hostLabel,
    backupBasename: safeBasename(summary?.verify?.backupPath ?? summary?.backupPath),
    encrypted: Boolean(summary?.encrypt?.enabled),
    encryptionTool: summary?.encrypt?.tool ?? null,
    offhost: Boolean(summary?.offhost?.enabled),
    offhostTargetSummary: summary?.offhost?.targetSummary ?? null,
    failedStep: summary?.failedStep ?? null,
    errorSummary: errorSummary ?? summary?.error ?? null,
    stepsCompleted: summary?.stepsCompleted ?? [],
  };
}

/**
 * @param {object} config
 * @param {boolean} backupOk
 */
export function shouldSendAlert(config, backupOk) {
  if (config.mode === "none") return false;
  if (!backupOk) return true;
  return config.alertOnSuccess;
}

/**
 * @param {object} payload
 * @param {string | null} webhookUrl
 */
export function assertPayloadSafe(payload, webhookUrl) {
  const serialized = JSON.stringify(payload);
  if (webhookUrl && serialized.includes(webhookUrl)) {
    throw new Error("Alert payload must not contain webhook URL");
  }
  if (containsLikelySecret(serialized)) {
    throw new Error("Alert payload must not contain secrets");
  }
}

/**
 * @param {string} webhookUrl
 * @param {object} payload
 * @param {(url: string, init: RequestInit) => Promise<Response>} fetchFn
 */
export async function sendWebhookAlert(webhookUrl, payload, fetchFn) {
  validateWebhookUrl(webhookUrl);
  assertPayloadSafe(payload, webhookUrl);
  const response = await fetchFn(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Webhook alert failed with HTTP ${response.status}`);
  }
}

/**
 * @param {object} options
 * @param {object} [options.env]
 * @param {(cmd: string) => { status: number | null; stdout?: string; stderr?: string }} [options.runNpm]
 * @param {(url: string, init: RequestInit) => Promise<Response>} [options.fetchFn]
 * @param {(line: string) => void} [options.log]
 */
export async function runBackupAlertWrapper(options = {}) {
  const env = options.env ?? process.env;
  const log = options.log ?? (() => {});
  const config = parseAlertConfig(env);

  if (config.mode === "webhook") {
    validateWebhookUrl(config.webhookUrl);
  }

  const runNpm =
    options.runNpm ??
    ((cmd) =>
      spawnSync(cmd, {
        shell: true,
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      }));

  log("alert-wrapper: running backup:db:secure");
  const proc = runNpm("npm run backup:db:secure");

  let summary = null;
  let parseError = null;
  try {
    summary = parseSecurePipelineJson(proc.stdout ?? "");
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
    summary = { ok: false, error: parseError };
  }

  const backupOk = proc.status === 0 && summary?.ok === true;
  const status = backupOk ? "success" : "failed";
  const errorSummary =
    parseError ??
    (proc.status !== 0 ? "backup:db:secure exited nonzero" : null) ??
    summary?.error ??
    null;

  const alertPayload = buildAlertPayload({
    status,
    summary,
    config,
    errorSummary,
  });

  let alertSent = false;
  let alertError = null;

  if (shouldSendAlert(config, backupOk)) {
    if (config.mode !== "webhook") {
      log(`alert: skipped (mode=${config.mode}, backup ${status})`);
    } else {
      try {
        const fetchFn = options.fetchFn ?? globalThis.fetch;
        if (!fetchFn) {
          throw new Error("fetch is not available; use Node 18+ for webhook alerts");
        }
        log(`alert: sending webhook notification (${status})`);
        await sendWebhookAlert(config.webhookUrl, alertPayload, fetchFn);
        alertSent = true;
        log("alert: webhook notification sent");
      } catch (error) {
        alertError = error instanceof Error ? error.message : String(error);
        log(`alert: webhook failed: ${alertError}`);
      }
    }
  } else {
    log(`alert: no notification (${status}, mode=${config.mode})`);
  }

  const result = {
    ok: backupOk,
    status,
    backup: summary,
    alert: {
      mode: config.mode,
      sent: alertSent,
      error: alertError,
      payload: alertPayload,
    },
  };

  return result;
}

/**
 * @param {object} result
 */
export function formatAlertWrapperSummary(result) {
  return JSON.stringify({
    ok: result.ok,
    status: result.status,
    alert: {
      mode: result.alert.mode,
      sent: result.alert.sent,
      error: result.alert.error,
    },
    backup: result.backup?.verify
      ? {
          backupBasename: safeBasename(result.backup.verify.backupPath),
          sha256: result.backup.verify.sha256,
        }
      : undefined,
    failedStep: result.backup?.failedStep,
    errorSummary: result.alert.payload?.errorSummary,
  });
}
