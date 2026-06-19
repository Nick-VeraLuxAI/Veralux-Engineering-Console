#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const veraBaseUrl = (process.env.VERA_API_BASE_URL || "http://127.0.0.1:8642").replace(/\/+$/, "");
const qwenBaseUrl = (process.env.QWEN_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const veraKey = process.env.VERA_API_KEY || process.env.API_SERVER_KEY || "";

function execText(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function serviceSnapshot() {
  const show = (service) => {
    const raw = execText("systemctl", [
      "show",
      service,
      "-p",
      "MainPID",
      "-p",
      "NRestarts",
      "-p",
      "ActiveState",
      "-p",
      "SubState",
      "-p",
      "ExecStart",
    ]);
    return Object.fromEntries(raw.split("\n").map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }));
  };
  const gpu = execText("nvidia-smi", [
    "--query-gpu=index,memory.used,memory.free",
    "--format=csv,noheader,nounits",
  ]).split("\n").filter(Boolean).map((line) => {
    const [index, usedMiB, freeMiB] = line.split(",").map((part) => part.trim());
    return { index: Number(index), usedMiB: Number(usedMiB), freeMiB: Number(freeMiB) };
  });
  return {
    qwen: show("qwen-llama-server.service"),
    gateway: show("hermes-gateway.service"),
    gpu,
  };
}

async function timed(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    return { name, ok: true, latencyMs: Date.now() - started, ...result };
  } catch (error) {
    return {
      name,
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readJson(response) {
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text.trim() ? JSON.parse(text) : null;
}

async function pollRun(runId) {
  let status = null;
  for (let i = 0; runId && i < 180; i += 1) {
    status = await readJson(await fetch(`${veraBaseUrl}/v1/runs/${runId}`, {
      headers: { Authorization: `Bearer ${veraKey}` },
    }));
    if (["completed", "failed", "cancelled", "stopped"].includes(status?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return status;
}

function createGovernedFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-runtime-probe-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "qwen-runtime-probe",
    scripts: { test: "node test.js" },
  }, null, 2));
  fs.writeFileSync(path.join(root, "math.js"), "function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n");
  fs.writeFileSync(path.join(root, "test.js"), "const { add } = require('./math'); if (add(2, 3) !== 5) { throw new Error('add failed'); } console.log('tests passed');\n");
  execText("git", ["init"], { cwd: root });
  execText("git", ["config", "user.email", "probe@test.local"], { cwd: root });
  execText("git", ["config", "user.name", "Qwen Runtime Probe"], { cwd: root });
  execText("git", ["add", "."], { cwd: root });
  execText("git", ["commit", "-m", "init"], { cwd: root });
  const baseCommit = execText("git", ["rev-parse", "HEAD"], { cwd: root });
  return { root, baseCommit };
}

async function main() {
  const before = serviceSnapshot();
  const probes = [];
  probes.push(await timed("vera.health", async () => {
    const body = await readJson(await fetch(`${veraBaseUrl}/health`));
    return { status: body?.status ?? null };
  }));

  probes.push(await timed("qwen.models", async () => {
    const body = await readJson(await fetch(`${qwenBaseUrl}/v1/models`));
    const models = body?.models ?? body?.data ?? [];
    return { model: models[0]?.name ?? models[0]?.id ?? null, modelCount: models.length };
  }));

  const generationBody = {
    model: "local-qwen",
    messages: [{ role: "user", content: "Reply with exactly: ok" }],
    max_tokens: 8,
    stream: false,
  };
  probes.push(await timed("qwen.generation.nonstream", async () => {
    const body = await readJson(await fetch(`${qwenBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(generationBody),
    }));
    return {
      finishReason: body?.choices?.[0]?.finish_reason ?? null,
      content: String(body?.choices?.[0]?.message?.content ?? "").slice(0, 40),
      usage: body?.usage ?? null,
    };
  }));

  probes.push(await timed("qwen.generation.stream", async () => {
    const response = await fetch(`${qwenBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...generationBody, stream: true }),
    });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let chunks = 0;
    let doneSeen = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks += 1;
      if (decoder.decode(value).includes("[DONE]")) doneSeen = true;
    }
    return { chunks, doneSeen };
  }));

  if (veraKey) {
    probes.push(await timed("vera.runs.short", async () => {
      const submitted = await readJson(await fetch(`${veraBaseUrl}/v1/runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${veraKey}`,
        },
        body: JSON.stringify({
          input: "Reply with exactly: ok",
          instructions: "No tools are needed. Return a short final answer.",
          max_iterations: 2,
        }),
      }));
      const runId = submitted?.run_id ?? null;
      const status = await pollRun(runId);
      return {
        runId,
        submittedStatus: submitted?.status ?? null,
        finalStatus: status?.status ?? null,
        lastEvent: status?.last_event ?? null,
        transportOutcome: status?.transport_outcome ?? null,
        sideEffectsObserved: status?.side_effects_observed ?? null,
        usage: status?.usage ?? null,
      };
    }));

    probes.push(await timed("vera.runs.governed_tool", async () => {
      const fixture = createGovernedFixture();
      let keepWorkspace = false;
      try {
        const submitted = await readJson(await fetch(`${veraBaseUrl}/v1/runs`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${veraKey}`,
          },
          body: JSON.stringify({
            input: [
              "In the assigned workspace, perform this exact runtime probe task:",
              `Workspace path: ${fixture.root}`,
              `Target file path: ${path.join(fixture.root, "math.js")}`,
              "1. Read math.js.",
              "2. Replace exactly `return a - b;` with `return a + b;`.",
              "3. Run `npm test`.",
              "4. Return a concise summary only after the test passes.",
              "Do not stop after a plan. Use tools to edit the file and run the test.",
            ].join("\n"),
            instructions: [
              "Use the assigned workspace only.",
              "This is a governed runtime probe, not a planning task.",
              "Do not access files outside execution_context.workspace_path.",
              "The required source edit is in math.js and must be performed with tools.",
            ].join("\n"),
            session_id: `qwen-runtime-probe:${path.basename(fixture.root)}`,
            max_iterations: 6,
            execution_context: {
              workspace_path: fixture.root,
              repository_path: fixture.root,
              allowed_paths: ["."],
              forbidden_paths: [".env", ".git", "node_modules"],
              protected_paths: [".env"],
              permitted_commands: ["npm test", "node test.js", "git status", "git diff"],
              prohibited_commands: ["git push", "rm -rf", "sudo", "curl", "wget"],
              attempt_id: `probe-${path.basename(fixture.root)}`,
              requirement_id: "probe-requirement",
              run_id: `probe-${path.basename(fixture.root)}`,
              artifact_path: path.join(fixture.root, ".vera", "execution-result.json"),
              timeout_ms: 120000,
              origin: "engineering_console",
              preauthorized: true,
            },
          }),
        }));
        const runId = submitted?.run_id ?? null;
        const status = await pollRun(runId);
        const changedFiles = execText("git", ["status", "--short"], { cwd: fixture.root });
        const diff = execText("git", ["diff", "--", "math.js"], { cwd: fixture.root });
        let testPassed = false;
        let testOutput = "";
        try {
          testOutput = execText("npm", ["test"], { cwd: fixture.root });
          testPassed = testOutput.includes("tests passed");
        } catch (error) {
          testOutput = error instanceof Error ? error.message : String(error);
        }
        const editedMath = diff.includes("return a + b");
        keepWorkspace = status?.status !== "completed" || !editedMath || !testPassed;
        return {
          runId,
          finalStatus: status?.status ?? null,
          lastEvent: status?.last_event ?? null,
          output: String(status?.output ?? "").slice(0, 1000),
          error: String(status?.error ?? "").slice(0, 1000),
          transportOutcome: status?.transport_outcome ?? null,
          sideEffectsObserved: status?.side_effects_observed ?? null,
          usage: status?.usage ?? null,
          workspace: fixture.root,
          baseCommit: fixture.baseCommit,
          changedFiles,
          diff: diff.slice(0, 1000),
          editedMath,
          testPassed,
          testOutput: testOutput.slice(0, 1000),
        };
      } finally {
        if (!keepWorkspace && process.env.QWEN_PROBE_KEEP_WORKSPACES !== "1") {
          fs.rmSync(fixture.root, { recursive: true, force: true });
        }
      }
    }));
  }

  const after = serviceSnapshot();
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), veraBaseUrl, qwenBaseUrl, before, after, probes }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
