/**
 * Model control plane types (VeraLux Engineering Console).
 * The console is the single layer that lists, loads/unloads and routes to
 * workstation models. See docs/source-of-truth/model-control-plane-v1.md.
 */

export type ModelKind =
  /** Served by something the console must never start/stop (e.g. Receptionist vLLM 8082). */
  | "external"
  /** Started/stopped on demand by the console. */
  | "managed"
  /** Weights on disk with no interactive runtime that fits this workstation. */
  | "on_disk";

export type ModelStatus =
  | "ready"
  | "loading"
  | "unloading"
  | "unloaded"
  | "failed"
  | "unavailable"
  | "not_loadable"
  | "running_unmanaged";

export interface ReadinessProbe {
  /** Path on the server origin, e.g. "/health". */
  path: string;
  /** Optional JSON field that must equal `expect` (e.g. status === "ok"). */
  jsonField?: string;
  expect?: string;
}

export interface ManagedLaunchSpec {
  /** Free-form runtime label for display (e.g. "freetoken", "vllm", "llama.cpp"). */
  runtime: string;
  /** How to tell the runtime can actually serve. Default: GET {baseUrl}/models returns 2xx. */
  readiness?: ReadinessProbe;
  /** Optional Python venv root (bin/activate is sourced before launch). */
  venv?: string;
  /** Optional env file sourced after activation (e.g. nccl.env). */
  envFile?: string;
  /** Executable (inside the venv) and args. */
  command: string;
  args: string[];
  cudaVisibleDevices: string;
  env?: Record<string, string>;
  /** Seconds to wait for /v1/models to answer after spawn. */
  readyTimeoutSeconds: number;
}

export interface ModelResourceNeeds {
  gpuIndex: number | null;
  /** Approximate VRAM the runtime takes once loaded (MiB). */
  vramMiB: number;
  /** Approximate host RAM the runtime takes once loaded (GiB). */
  hostRamGiB: number;
}

export interface CatalogModel {
  id: string;
  label: string;
  aliases: string[];
  kind: ModelKind;
  role: string;
  /** OpenAI-compatible base URL ending in /v1. */
  baseUrl: string | null;
  /** Model name the upstream server expects. */
  upstreamModel: string | null;
  contextLength: number | null;
  paths: string[];
  /** The console never starts, stops or reconfigures protected models. */
  protected: boolean;
  /** Upstream is shared with the live Receptionist voice path. */
  sharedWithReceptionist: boolean;
  resources: ModelResourceNeeds | null;
  launch: ManagedLaunchSpec | null;
  notLoadableReason: string | null;
  notes: string | null;
}

export interface ManagedProcessState {
  id: string;
  pid: number;
  startedAt: string;
  readyAt: string | null;
  loadSeconds: number | null;
  logPath: string;
  phase: "loading" | "ready" | "unloading" | "failed";
  error: string | null;
}

export interface GpuInfo {
  index: number;
  uuid: string;
  name: string;
  memoryUsedMiB: number;
  memoryTotalMiB: number;
  memoryFreeMiB: number;
  utilizationPct: number;
  processes: Array<{ pid: number; name: string; usedMiB: number }>;
}

export interface SystemSnapshot {
  at: string;
  gpus: GpuInfo[];
  gpuError: string | null;
  ram: {
    totalGiB: number;
    availableGiB: number;
    usedGiB: number;
    swapTotalGiB: number;
    swapFreeGiB: number;
  } | null;
}

export interface ModelStatusView {
  id: string;
  label: string;
  kind: ModelKind;
  role: string;
  status: ModelStatus;
  aliases: string[];
  upstreamModel: string | null;
  baseUrl: string | null;
  contextLength: number | null;
  protected: boolean;
  sharedWithReceptionist: boolean;
  loadable: boolean;
  unloadable: boolean;
  paths: string[];
  resources: ModelResourceNeeds | null;
  notLoadableReason: string | null;
  notes: string | null;
  process: {
    pid: number;
    startedAt: string;
    readyAt: string | null;
    loadSeconds: number | null;
    logPath: string;
    error: string | null;
  } | null;
  inFlightRequests: number;
  lastUsedAt: string | null;
  pendingUnload: { idleGraceSeconds: number; requestedAt: string } | null;
  idleUnloadMinutes: number;
}
