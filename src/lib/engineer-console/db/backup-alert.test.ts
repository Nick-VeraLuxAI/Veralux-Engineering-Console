import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
  assertPayloadSafe,
  buildAlertPayload,
  formatAlertWrapperSummary,
  parseAlertConfig,
  parseSecurePipelineJson,
  runBackupAlertWrapper,
  sendWebhookAlert,
  shouldSendAlert,
  validateWebhookUrl,
} from "../../../../scripts/engineer-console/backup-alert-lib.mjs";

describe("backup alert config", () => {
  it("defaults alert mode to none", () => {
    expect(parseAlertConfig({}).mode).toBe("none");
    expect(parseAlertConfig({}).alertOnSuccess).toBe(false);
  });

  it("webhook mode requires URL when validated", () => {
    expect(() => validateWebhookUrl("")).toThrow(/WEBHOOK_URL/i);
    expect(() => validateWebhookUrl("not-a-url")).toThrow(/valid URL/i);
    expect(() => validateWebhookUrl("https://hooks.example.com/backup")).not.toThrow();
  });
});

describe("backup alert payload", () => {
  it("builds safe payload with basename only", () => {
    const payload = buildAlertPayload({
      status: "success",
      summary: {
        ok: true,
        verify: { backupPath: "/var/secret/path/engineer-console-20260101.db" },
        encrypt: { enabled: true, tool: "age" },
        offhost: { enabled: true, targetSummary: "rsync host backup.internal:***" },
        stepsCompleted: ["backup-verify", "encrypt", "offhost"],
      },
      config: parseAlertConfig({ ENGINEER_CONSOLE_INSTANCE_LABEL: "staging-1" }),
    });
    expect(payload.backupBasename).toBe("engineer-console-20260101.db");
    expect(payload.backupBasename).not.toContain("/var/");
    expect(payload.status).toBe("success");
    expect(payload.encrypted).toBe(true);
    expect(payload.offhost).toBe(true);
  });

  it("redacts webhook URL from payload", () => {
    const url = "https://hooks.example.com/secret-token-path";
    const payload = buildAlertPayload({
      status: "failed",
      summary: { ok: false, error: "verify failed" },
      config: parseAlertConfig({}),
      errorSummary: "verify failed",
    });
    expect(() => assertPayloadSafe(payload, url)).not.toThrow();
    expect(() => assertPayloadSafe({ ...payload, note: url }, url)).toThrow(/webhook URL/i);
  });

  it("should alert on failure by default", () => {
    const config = parseAlertConfig({ ENGINEER_CONSOLE_BACKUP_ALERT_MODE: "webhook" });
    expect(shouldSendAlert(config, false)).toBe(true);
    expect(shouldSendAlert(config, true)).toBe(false);
  });

  it("sends success alert only when enabled", () => {
    const config = parseAlertConfig({
      ENGINEER_CONSOLE_BACKUP_ALERT_MODE: "webhook",
      ENGINEER_CONSOLE_BACKUP_ALERT_ON_SUCCESS: "true",
    });
    expect(shouldSendAlert(config, true)).toBe(true);
  });
});

describe("backup alert wrapper", () => {
  it("succeeds with alert mode none without fetch", async () => {
    const fetchFn = vi.fn();
    const result = await runBackupAlertWrapper({
      env: { ENGINEER_CONSOLE_BACKUP_ALERT_MODE: "none" },
      runNpm: () => ({
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          stepsCompleted: ["backup-verify", "encrypt-skipped", "offhost-skipped"],
          verify: { backupPath: "/backups/test.db", sha256: "a".repeat(64) },
        }),
      }),
      fetchFn,
    });
    expect(result.ok).toBe(true);
    expect(result.alert.sent).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("exits nonzero path when backup fails", async () => {
    const result = await runBackupAlertWrapper({
      env: { ENGINEER_CONSOLE_BACKUP_ALERT_MODE: "none" },
      runNpm: () => ({
        status: 1,
        stdout: JSON.stringify({ ok: false, failedStep: "backup-verify", error: "failed" }),
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
  });

  it("sends failure webhook with safe payload", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const webhookUrl = "https://hooks.example.com/veralux-backup";
    const result = await runBackupAlertWrapper({
      env: {
        ENGINEER_CONSOLE_BACKUP_ALERT_MODE: "webhook",
        ENGINEER_CONSOLE_BACKUP_ALERT_WEBHOOK_URL: webhookUrl,
      },
      runNpm: () => ({
        status: 1,
        stdout: JSON.stringify({ ok: false, error: "backup:db:verify failed" }),
      }),
      fetchFn,
    });
    expect(result.ok).toBe(false);
    expect(result.alert.sent).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [, init] = fetchFn.mock.calls[0];
    const body = JSON.parse(String(init.body));
    expect(body.status).toBe("failed");
    expect(body.errorSummary).toMatch(/failed|nonzero/i);
    expect(JSON.stringify(body)).not.toContain(webhookUrl);
  });

  it("does not send success webhook unless enabled", async () => {
    const fetchFn = vi.fn();
    await runBackupAlertWrapper({
      env: {
        ENGINEER_CONSOLE_BACKUP_ALERT_MODE: "webhook",
        ENGINEER_CONSOLE_BACKUP_ALERT_WEBHOOK_URL: "https://hooks.example.com/hook",
      },
      runNpm: () => ({
        status: 0,
        stdout: JSON.stringify({ ok: true, verify: { backupPath: "/backups/x.db" } }),
      }),
      fetchFn,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("summary JSON does not include secrets", async () => {
    const result = await runBackupAlertWrapper({
      env: { ENGINEER_CONSOLE_BACKUP_ALERT_MODE: "none" },
      runNpm: () => ({
        status: 0,
        stdout: JSON.stringify({ ok: true, verify: { backupPath: "/backups/x.db" } }),
      }),
    });
    const json = formatAlertWrapperSummary(result);
    expect(json).not.toContain("SESSION_SECRET");
    expect(json).not.toContain("KIMI_API_KEY");
  });
});

describe("parseSecurePipelineJson", () => {
  it("parses last JSON line from stdout", () => {
    const stdout = "log line\n" + JSON.stringify({ ok: true, stepsCompleted: [] });
    expect(parseSecurePipelineJson(stdout).ok).toBe(true);
  });
});

describe("sendWebhookAlert", () => {
  it("posts JSON body via fetch mock", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const url = "https://hooks.example.com/alert";
    await sendWebhookAlert(
      url,
      buildAlertPayload({
        status: "failed",
        summary: null,
        config: parseAlertConfig({}),
        errorSummary: "test",
      }),
      fetchFn,
    );
    expect(fetchFn.mock.calls[0][0]).toBe(url);
  });
});

describe("ops documentation", () => {
  const repoRoot = process.cwd();

  it("cron example contains no obvious real secrets", () => {
    const content = fs.readFileSync(
      path.join(repoRoot, "docs/examples/cron-backup-alert.example"),
      "utf8",
    );
    expect(content).not.toMatch(/SESSION_SECRET=[^<\s]/);
    expect(content).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
    expect(content).toContain("backup:db:alert");
  });

  it("production launch checklist covers auth, backups, gates, and TLS", () => {
    const content = fs.readFileSync(
      path.join(repoRoot, "docs/production-launch-checklist.md"),
      "utf8",
    );
    expect(content).toMatch(/auth/i);
    expect(content).toMatch(/backup/i);
    expect(content).toMatch(/release gates/i);
    expect(content).toMatch(/TLS/i);
    expect(content).toMatch(/rollback/i);
  });
});
