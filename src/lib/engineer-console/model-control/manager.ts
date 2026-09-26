import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getCatalog, resolveCatalogModel } from "./catalog";
import { getSystemSnapshot } from "./system";
import type {
  CatalogModel,
  ManagedProcessState,
  ModelStatus,
  ModelStatusView,
} from "./types";

export class ModelControlError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ModelControlError";
    this.code = code;
    this.status = status;
  }
}

interface Runtime {
  inFlight: Map<string, number>;
  lastUsed: Map<string, number>;
  pendingUnload: Map<string, { idleGraceSeconds: number; requestedAt: number }>;
  loading: Map<string, Promise<ModelStatusView>>;
  probeCache: Map<string, { at: number; ok: boolean }>;
  timer: NodeJS.Timeout | null;
  adopted: boolean;
}

const GLOBAL_KEY = "__veraluxModelControlRuntime";
type GlobalWithRuntime = typeof globalThis & { [GLOBAL_KEY]?: Runtime };

function rt(): Runtime {
  const g = globalThis as GlobalWithRuntime;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      inFlight: new Map(),
      lastUsed: new Map(),
      pendingUnload: new Map(),
      loading: new Map(),
      probeCache: new Map(),
      timer: null,
      adopted: false,
    };
  }
  return g[GLOBAL_KEY]!;
}

function envNum(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function getStateDir(): string {
  return (
    process.env.ENGINEER_CONSOLE_MODEL_CONTROL_DIR?.trim() ||
    path.join(os.homedir(), ".veralux-engineering-console", "model-control")
  );
}

export function idleUnloadMinutes(): number {
  return envNum("ENGINEER_CONSOLE_MODEL_IDLE_UNLOAD_MINUTES", 30);
}

function gpuReserveMiB(): number {
  return envNum("ENGINEER_CONSOLE_GPU_RESERVE_MIB", 4096);
}

function ramReserveGiB(): number {
  return envNum("ENGINEER_CONSOLE_RAM_RESERVE_GIB", 32);
}

function statePath(id: string): string {
  return path.join(getStateDir(), "state", `${id}.json`);
}

function readState(id: string): ManagedProcessState | null {
  try {
    return JSON.parse(fs.readFileSync(statePath(id), "utf8")) as ManagedProcessState;
  } catch {
    return null;
  }
}

function writeState(state: ManagedProcessState): void {
  fs.mkdirSync(path.dirname(statePath(state.id)), { recursive: true });
  const tmp = `${statePath(state.id)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, statePath(state.id));
}

function clearState(id: string): void {
  try {
    fs.unlinkSync(statePath(id));
  } catch {
    // already gone
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** True while any process in process group `pgid` is still alive (runtimes fork workers). */
function groupAlive(pgid: number): boolean {
  try {
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = fs.readFileSync(`/proc/${entry}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        if (Number(fields[2]) === pgid && fields[0] !== "Z") return true;
      } catch {
        // process exited while scanning
      }
    }
  } catch {
    return pidAlive(pgid);
  }
  return false;
}

function launchPortArg(model: CatalogModel): string | null {
  const args = model.launch?.args ?? [];
  const i = args.indexOf("--port");
  return i >= 0 ? args[i + 1] ?? null : null;
}

/** Only ever signal a pid whose cmdline proves it is the runtime we launched. */
function pidMatchesModel(pid: number, model: CatalogModel): boolean {
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ");
    const port = launchPortArg(model);
    return cmdline.includes(" serve") && (!port || cmdline.includes(`--port ${port}`));
  } catch {
    return false;
  }
}

async function probeModels(baseUrl: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ready = the runtime can actually serve. Uses the catalog entry's readiness probe
 *  when given (some runtimes answer /v1/models while still loading weights). */
async function probeReady(model: CatalogModel, timeoutMs = 3000): Promise<boolean> {
  if (!model.baseUrl) return false;
  const probe = model.launch?.readiness;
  if (!probe) return probeModels(model.baseUrl, timeoutMs);
  try {
    const res = await fetch(`${new URL(model.baseUrl).origin}${probe.path}`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return false;
    if (!probe.jsonField) return true;
    const body = (await res.json()) as Record<string, unknown>;
    return String(body[probe.jsonField]) === (probe.expect ?? "ok");
  } catch {
    return false;
  }
}

async function probeCached(model: CatalogModel, maxAgeMs = 4000): Promise<boolean> {
  if (!model.baseUrl) return false;
  const cache = rt().probeCache.get(model.id);
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.ok;
  const ok = await probeReady(model);
  rt().probeCache.set(model.id, { at: Date.now(), ok });
  return ok;
}

function tailLog(logPath: string, bytes = 2000): string {
  try {
    const stat = fs.statSync(logPath);
    const fd = fs.openSync(logPath, "r");
    const len = Math.min(bytes, stat.size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, stat.size - len);
    fs.closeSync(fd);
    return buf.toString("utf8").replace(/\r/g, "\n").split("\n").filter(Boolean).slice(-8).join("\n");
  } catch {
    return "";
  }
}

function adoptOnce(): void {
  const r = rt();
  if (r.adopted) return;
  r.adopted = true;
  for (const model of getCatalog()) {
    if (model.kind !== "managed") continue;
    const state = readState(model.id);
    if (!state) continue;
    if (pidAlive(state.pid) && pidMatchesModel(state.pid, model)) {
      r.lastUsed.set(model.id, Date.now());
    } else {
      clearState(model.id);
    }
  }
  ensureTimer();
}

function ensureTimer(): void {
  const r = rt();
  if (r.timer) return;
  r.timer = setInterval(() => {
    void housekeeping().catch(() => undefined);
  }, 5000);
  r.timer.unref?.();
}

async function housekeeping(): Promise<void> {
  const r = rt();
  const idleMin = idleUnloadMinutes();
  for (const model of getCatalog()) {
    if (model.kind !== "managed") continue;
    const state = readState(model.id);
    if (!state || state.phase !== "ready") continue;
    const inflight = r.inFlight.get(model.id) ?? 0;
    if (inflight > 0) continue;
    const idleMs = Date.now() - (r.lastUsed.get(model.id) ?? Date.parse(state.readyAt ?? state.startedAt));
    const pending = r.pendingUnload.get(model.id);
    if (pending && idleMs >= pending.idleGraceSeconds * 1000) {
      await unloadModel(model.id, { force: true });
      continue;
    }
    if (idleMin > 0 && idleMs >= idleMin * 60_000) {
      await unloadModel(model.id, { force: true });
    }
  }
}

export async function modelStatus(model: CatalogModel): Promise<ModelStatusView> {
  adoptOnce();
  const r = rt();
  let status: ModelStatus;
  let proc: ModelStatusView["process"] = null;

  if (model.kind === "on_disk") {
    status = "not_loadable";
  } else if (model.kind === "external") {
    status = (await probeCached(model)) ? "ready" : "unavailable";
  } else {
    const state = readState(model.id);
    if (state && pidAlive(state.pid) && pidMatchesModel(state.pid, model)) {
      proc = {
        pid: state.pid,
        startedAt: state.startedAt,
        readyAt: state.readyAt,
        loadSeconds: state.loadSeconds,
        logPath: state.logPath,
        error: state.error,
      };
      status = state.phase === "failed" ? "failed" : state.phase;
    } else if (state && state.phase === "failed") {
      status = "failed";
      proc = {
        pid: state.pid,
        startedAt: state.startedAt,
        readyAt: null,
        loadSeconds: null,
        logPath: state.logPath,
        error: state.error,
      };
    } else {
      if (state) clearState(model.id);
      status = (await probeCached(model, 2000)) ? "running_unmanaged" : "unloaded";
    }
  }

  const pending = r.pendingUnload.get(model.id);
  const lastUsed = r.lastUsed.get(model.id);
  return {
    id: model.id,
    label: model.label,
    kind: model.kind,
    role: model.role,
    status,
    aliases: model.aliases,
    upstreamModel: model.upstreamModel,
    baseUrl: model.baseUrl,
    contextLength: model.contextLength,
    protected: model.protected,
    sharedWithReceptionist: model.sharedWithReceptionist,
    loadable: model.kind === "managed" && !model.protected,
    unloadable: model.kind === "managed" && !model.protected,
    paths: model.paths,
    resources: model.resources,
    notLoadableReason: model.notLoadableReason,
    notes: model.notes,
    process: proc,
    inFlightRequests: r.inFlight.get(model.id) ?? 0,
    lastUsedAt: lastUsed ? new Date(lastUsed).toISOString() : null,
    pendingUnload: pending
      ? { idleGraceSeconds: pending.idleGraceSeconds, requestedAt: new Date(pending.requestedAt).toISOString() }
      : null,
    idleUnloadMinutes: idleUnloadMinutes(),
  };
}

export async function listModelStatuses(): Promise<ModelStatusView[]> {
  return Promise.all(getCatalog().map((m) => modelStatus(m)));
}

export function requireModel(name: string): CatalogModel {
  const model = resolveCatalogModel(name);
  if (!model) {
    throw new ModelControlError("MODEL_NOT_FOUND", `Unknown model: ${name}`, 404);
  }
  return model;
}

async function preflight(model: CatalogModel): Promise<void> {
  const needs = model.resources;
  const snap = await getSystemSnapshot();
  if (needs && needs.gpuIndex !== null) {
    const gpu = snap.gpus.find((g) => g.index === needs.gpuIndex);
    if (!gpu) {
      throw new ModelControlError("GPU_UNAVAILABLE", `GPU ${needs.gpuIndex} not visible: ${snap.gpuError ?? "missing"}`, 409);
    }
    const required = needs.vramMiB + gpuReserveMiB();
    if (gpu.memoryFreeMiB < required) {
      throw new ModelControlError(
        "INSUFFICIENT_VRAM",
        `GPU ${gpu.index} has ${gpu.memoryFreeMiB} MiB free; ${model.id} needs ~${needs.vramMiB} MiB plus ${gpuReserveMiB()} MiB reserved headroom for other GPU tenants (Whisper/Kokoro). Refusing to load.`,
        409,
      );
    }
  }
  if (needs && snap.ram && snap.ram.availableGiB < needs.hostRamGiB + ramReserveGiB()) {
    throw new ModelControlError(
      "INSUFFICIENT_RAM",
      `Host RAM available ${snap.ram.availableGiB} GiB < ${needs.hostRamGiB} + ${ramReserveGiB()} GiB reserve.`,
      409,
    );
  }
  if (model.baseUrl && (await probeModels(model.baseUrl, 1500))) {
    throw new ModelControlError("PORT_IN_USE", `${model.baseUrl} already answers; an unmanaged server is running there.`, 409);
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function waitForReady(model: CatalogModel, state: ManagedProcessState): Promise<void> {
  const timeoutMs = (model.launch?.readyTimeoutSeconds ?? 600) * 1000;
  const started = Date.parse(state.startedAt);
  while (Date.now() - started < timeoutMs) {
    await new Promise((res) => setTimeout(res, 2000));
    const current = readState(model.id);
    if (!current || current.pid !== state.pid || current.phase === "unloading") {
      throw new ModelControlError("LOAD_CANCELLED", `${model.id} load was cancelled`, 409);
    }
    if (!pidAlive(state.pid)) {
      const err = `runtime exited during load. Log tail:\n${tailLog(state.logPath)}`;
      writeState({ ...current, phase: "failed", error: err });
      throw new ModelControlError("LOAD_FAILED", `${model.id}: ${err}`, 500);
    }
    if (await probeReady(model, 2000)) {
      const readyAt = new Date();
      writeState({
        ...current,
        phase: "ready",
        readyAt: readyAt.toISOString(),
        loadSeconds: Math.round((readyAt.getTime() - started) / 100) / 10,
      });
      rt().lastUsed.set(model.id, Date.now());
      rt().probeCache.delete(model.id);
      return;
    }
  }
  await killProcessGroup(model, state.pid);
  const current = readState(model.id);
  if (current) writeState({ ...current, phase: "failed", error: `not ready after ${timeoutMs / 1000}s` });
  throw new ModelControlError("LOAD_TIMEOUT", `${model.id} not ready after ${timeoutMs / 1000}s`, 504);
}

export async function loadModel(name: string, opts: { wait?: boolean } = {}): Promise<ModelStatusView> {
  adoptOnce();
  const model = requireModel(name);
  if (model.kind !== "managed" || model.protected || !model.launch) {
    throw new ModelControlError(
      "NOT_LOADABLE",
      `${model.id} cannot be loaded by the console: ${model.notLoadableReason ?? model.kind}`,
      409,
    );
  }
  const r = rt();
  r.pendingUnload.delete(model.id);
  const existing = r.loading.get(model.id);
  if (existing) return opts.wait === false ? modelStatus(model) : existing;

  const current = await modelStatus(model);
  if (current.status === "ready" || current.status === "running_unmanaged") {
    r.lastUsed.set(model.id, Date.now());
    return current;
  }
  if (current.status === "unloading") {
    throw new ModelControlError("BUSY_UNLOADING", `${model.id} is unloading; retry shortly`, 409);
  }
  if (current.status === "loading") {
    // Adopted mid-load (e.g. console restarted during a load): just wait for it.
    const st = readState(model.id);
    if (st) {
      const waiting = waitForReady(model, st)
        .then(() => modelStatus(model))
        .finally(() => r.loading.delete(model.id));
      r.loading.set(model.id, waiting);
      return opts.wait === false ? current : waiting;
    }
  }

  // One managed load per GPU at a time.
  for (const other of getCatalog()) {
    if (other.id === model.id || other.kind !== "managed") continue;
    if (other.resources?.gpuIndex === model.resources?.gpuIndex && r.loading.has(other.id)) {
      throw new ModelControlError("GPU_BUSY", `${other.id} is loading on the same GPU`, 409);
    }
  }

  const promise = (async () => {
    await preflight(model);
    const launch = model.launch!;
    const logDir = path.join(getStateDir(), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logPath = path.join(logDir, `${model.id}-${stamp}.log`);
    const logFd = fs.openSync(logPath, "a");
    const script = [
      launch.venv ? `source ${shellQuote(path.join(launch.venv, "bin", "activate"))}` : "true",
      launch.envFile ? `[ -f ${shellQuote(launch.envFile)} ] && source ${shellQuote(launch.envFile)}` : "true",
      `exec ${[launch.command, ...launch.args].map(shellQuote).join(" ")}`,
    ].join("\n");
    fs.writeSync(logFd, `# model-control launch ${new Date().toISOString()}\n# CUDA_VISIBLE_DEVICES=${launch.cudaVisibleDevices}\n${script}\n`);
    const child = spawn("bash", ["-c", script], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, ...launch.env, CUDA_VISIBLE_DEVICES: launch.cudaVisibleDevices },
    });
    child.unref();
    fs.closeSync(logFd);
    if (!child.pid) throw new ModelControlError("SPAWN_FAILED", `could not spawn ${model.id}`, 500);
    const state: ManagedProcessState = {
      id: model.id,
      pid: child.pid,
      startedAt: new Date().toISOString(),
      readyAt: null,
      loadSeconds: null,
      logPath,
      phase: "loading",
      error: null,
    };
    writeState(state);
    await waitForReady(model, state);
    return modelStatus(model);
  })().finally(() => {
    r.loading.delete(model.id);
  });
  r.loading.set(model.id, promise);
  if (opts.wait === false) {
    promise.catch(() => undefined);
    await new Promise((res) => setTimeout(res, 300));
    return modelStatus(model);
  }
  return promise;
}

async function killProcessGroup(model: CatalogModel, pid: number): Promise<void> {
  if (!pidAlive(pid)) {
    if (groupAlive(pid)) {
      try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
    }
    return;
  }
  if (!pidMatchesModel(pid, model)) {
    throw new ModelControlError("PID_MISMATCH", `pid ${pid} is not ${model.id}'s runtime; refusing to signal it`, 409);
  }
  const signal = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        process.kill(pid, sig);
      } catch {
        // gone
      }
    }
  };
  signal("SIGTERM");
  const deadline = Date.now() + envNum("ENGINEER_CONSOLE_MODEL_STOP_TIMEOUT_S", 60) * 1000;
  // Wait for the whole group (workers hold GPU memory until they exit).
  while (Date.now() < deadline && (pidAlive(pid) || groupAlive(pid))) {
    await new Promise((res) => setTimeout(res, 500));
  }
  if (pidAlive(pid) || groupAlive(pid)) {
    signal("SIGKILL");
    await new Promise((res) => setTimeout(res, 2000));
  }
}

export async function unloadModel(
  name: string,
  opts: { idleGraceSeconds?: number; force?: boolean } = {},
): Promise<ModelStatusView & { unloadSeconds?: number; deferred?: boolean }> {
  adoptOnce();
  const model = requireModel(name);
  if (model.kind !== "managed" || model.protected) {
    throw new ModelControlError(
      "NOT_UNLOADABLE",
      `${model.id} cannot be unloaded by the console: ${model.notLoadableReason ?? model.kind}`,
      409,
    );
  }
  const r = rt();
  const state = readState(model.id);
  if (!state) {
    const view = await modelStatus(model);
    if (view.status === "running_unmanaged") {
      throw new ModelControlError(
        "UNMANAGED",
        `${model.baseUrl} is served by a process the console did not start; stop it manually.`,
        409,
      );
    }
    return view;
  }
  const grace = Math.max(0, opts.idleGraceSeconds ?? 0);
  const inflight = r.inFlight.get(model.id) ?? 0;
  if (!opts.force && (grace > 0 || inflight > 0)) {
    r.pendingUnload.set(model.id, { idleGraceSeconds: grace, requestedAt: Date.now() });
    ensureTimer();
    return { ...(await modelStatus(model)), deferred: true };
  }
  const started = Date.now();
  writeState({ ...state, phase: "unloading" });
  r.pendingUnload.delete(model.id);
  await killProcessGroup(model, state.pid);
  clearState(model.id);
  r.probeCache.delete(model.id);
  r.lastUsed.delete(model.id);
  return { ...(await modelStatus(model)), unloadSeconds: Math.round((Date.now() - started) / 100) / 10 };
}

/** Called by the router around every proxied request. */
export function trackRequestStart(id: string): () => void {
  const r = rt();
  r.inFlight.set(id, (r.inFlight.get(id) ?? 0) + 1);
  r.lastUsed.set(id, Date.now());
  let done = false;
  return () => {
    if (done) return;
    done = true;
    r.inFlight.set(id, Math.max(0, (r.inFlight.get(id) ?? 1) - 1));
    r.lastUsed.set(id, Date.now());
  };
}

/** Make sure a routable model is ready, auto-loading managed models when allowed. */
export async function ensureRoutable(model: CatalogModel): Promise<{ autoLoaded: boolean; loadSeconds: number | null }> {
  if (model.kind === "on_disk" || !model.baseUrl || !model.upstreamModel) {
    throw new ModelControlError("NOT_ROUTABLE", `${model.id} is not servable: ${model.notLoadableReason ?? "no runtime"}`, 409);
  }
  const view = await modelStatus(model);
  if (view.status === "ready" || view.status === "running_unmanaged") return { autoLoaded: false, loadSeconds: null };
  if (model.kind === "external") {
    throw new ModelControlError("UPSTREAM_UNAVAILABLE", `${model.id} upstream ${model.baseUrl} is not answering`, 503);
  }
  const autoLoad = (process.env.ENGINEER_CONSOLE_MODEL_AUTOLOAD ?? "true") !== "false";
  if (!autoLoad) {
    throw new ModelControlError("MODEL_NOT_LOADED", `${model.id} is ${view.status}; load it first`, 503);
  }
  const loaded = await loadModel(model.id, { wait: true });
  return { autoLoaded: true, loadSeconds: loaded.process?.loadSeconds ?? null };
}
