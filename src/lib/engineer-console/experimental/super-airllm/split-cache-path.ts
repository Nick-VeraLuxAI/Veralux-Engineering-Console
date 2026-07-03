import { execFile } from "child_process";
import { access, mkdir, statfs } from "fs/promises";
import path from "path";
import { promisify } from "util";
import {
  SUPER_AIRLLM_BLOCKED_SPLIT_FS_TYPES,
  SUPER_AIRLLM_DEFAULT_SPLIT_CACHE_DIR,
  SUPER_AIRLLM_MIN_SPLIT_FREE_GIB,
  SUPER_AIRLLM_SPLIT_CACHE_ENV_VAR,
} from "./constants";

const execFileAsync = promisify(execFile);
const MIN_SPLIT_FREE_BYTES = SUPER_AIRLLM_MIN_SPLIT_FREE_GIB * 1024 * 1024 * 1024;

export type SplitCachePathStatus = "ready" | "blocked";

export interface SplitCachePathResult {
  status: SplitCachePathStatus;
  requested_path: string;
  resolved_path: string | null;
  output_path: string | null;
  filesystem_type: string | null;
  free_bytes: number | null;
  materialization_allowed: boolean;
  blocked_reasons: string[];
  diagnostics: string[];
}

export interface StorageCandidateAudit {
  path: string;
  role: string;
  filesystem_type: string | null;
  free_bytes: number | null;
  total_bytes: number | null;
  split_output_safe: boolean;
  materialization_allowed: boolean;
}

export function readSplitCacheDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env[SUPER_AIRLLM_SPLIT_CACHE_ENV_VAR]?.trim() || SUPER_AIRLLM_DEFAULT_SPLIT_CACHE_DIR;
}

export async function detectFilesystemType(targetPath: string): Promise<string | null> {
  let current = path.resolve(targetPath);
  const candidates = [current];
  while (path.dirname(current) !== current) {
    current = path.dirname(current);
    candidates.push(current);
  }
  for (const candidate of candidates) {
    try {
      const result = await execFileAsync("findmnt", ["-no", "FSTYPE", candidate]);
      const lines = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase())
        .filter(Boolean);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (lines[index] !== "autofs") return lines[index];
      }
      if (lines.length > 0) return lines[lines.length - 1];
    } catch {
      continue;
    }
  }
  return null;
}

export async function getFreeBytes(targetPath: string): Promise<number | null> {
  try {
    const stats = await statfs(targetPath);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

export async function validateSplitCacheFilesystem(targetPath: string): Promise<{
  ok: boolean;
  filesystem_type: string | null;
  diagnostics: string[];
}> {
  const filesystem_type = await detectFilesystemType(targetPath);
  const diagnostics: string[] = [];
  if (!filesystem_type) {
    diagnostics.push("SPLIT_CACHE_FSTYPE_UNKNOWN");
    return { ok: false, filesystem_type, diagnostics };
  }
  if (SUPER_AIRLLM_BLOCKED_SPLIT_FS_TYPES.includes(filesystem_type as typeof SUPER_AIRLLM_BLOCKED_SPLIT_FS_TYPES[number])) {
    diagnostics.push(`SPLIT_CACHE_FSTYPE_BLOCKED:${filesystem_type}`);
    return { ok: false, filesystem_type, diagnostics };
  }
  diagnostics.push(`SPLIT_CACHE_FSTYPE_OK:${filesystem_type}`);
  return { ok: true, filesystem_type, diagnostics };
}

export async function resolveSplitCachePath(input: {
  env?: NodeJS.ProcessEnv;
  create?: boolean;
} = {}): Promise<SplitCachePathResult> {
  const requested_path = readSplitCacheDirFromEnv(input.env);
  const blocked_reasons: string[] = [];
  const diagnostics: string[] = [];

  let resolved_path: string;
  try {
    resolved_path = path.resolve(requested_path);
    if (input.create) {
      await mkdir(resolved_path, { recursive: true });
    } else {
      await access(resolved_path);
    }
  } catch {
    blocked_reasons.push("SPLIT_CACHE_PATH_MISSING");
    diagnostics.push(`SPLIT_CACHE_PATH_NOT_FOUND:${requested_path}`);
    return {
      status: "blocked",
      requested_path,
      resolved_path: null,
      output_path: null,
      filesystem_type: null,
      free_bytes: null,
      materialization_allowed: false,
      blocked_reasons,
      diagnostics,
    };
  }

  const fsCheck = await validateSplitCacheFilesystem(resolved_path);
  diagnostics.push(...fsCheck.diagnostics);
  if (!fsCheck.ok) {
    blocked_reasons.push("SPLIT_CACHE_FSTYPE_NOT_EXT4_SAFE");
    return {
      status: "blocked",
      requested_path,
      resolved_path,
      output_path: null,
      filesystem_type: fsCheck.filesystem_type,
      free_bytes: await getFreeBytes(resolved_path),
      materialization_allowed: false,
      blocked_reasons,
      diagnostics,
    };
  }

  const free_bytes = await getFreeBytes(resolved_path);
  if (free_bytes === null) {
    blocked_reasons.push("SPLIT_CACHE_FREE_SPACE_UNKNOWN");
    diagnostics.push("SPLIT_CACHE_FREE_SPACE_UNKNOWN");
    return {
      status: "blocked",
      requested_path,
      resolved_path,
      output_path: null,
      filesystem_type: fsCheck.filesystem_type,
      free_bytes: null,
      materialization_allowed: false,
      blocked_reasons,
      diagnostics,
    };
  }

  diagnostics.push(`SPLIT_CACHE_FREE_BYTES:${free_bytes}`);
  if (free_bytes < MIN_SPLIT_FREE_BYTES) {
    blocked_reasons.push("SPLIT_CACHE_FREE_SPACE_INSUFFICIENT");
    diagnostics.push(`SPLIT_CACHE_MIN_FREE_BYTES:${MIN_SPLIT_FREE_BYTES}`);
    return {
      status: "blocked",
      requested_path,
      resolved_path,
      output_path: null,
      filesystem_type: fsCheck.filesystem_type,
      free_bytes,
      materialization_allowed: false,
      blocked_reasons,
      diagnostics,
    };
  }

  const output_path = path.join(resolved_path, "splitted_model");
  return {
    status: "ready",
    requested_path,
    resolved_path,
    output_path,
    filesystem_type: fsCheck.filesystem_type,
    free_bytes,
    materialization_allowed: true,
    blocked_reasons: [],
    diagnostics,
  };
}

export async function auditStorageCandidates(): Promise<StorageCandidateAudit[]> {
  const candidates: Array<{ path: string; role: string }> = [
    { path: "/", role: "root_home" },
    { path: "/home", role: "home" },
    { path: "/home/ndesantis/vera-workspace/super-airllm-splits", role: "legacy_s2_default" },
    { path: SUPER_AIRLLM_DEFAULT_SPLIT_CACHE_DIR, role: "s3_recommended" },
    { path: "/mnt/large-storage", role: "canonical_raw_ntfs" },
  ];

  return Promise.all(candidates.map(async (candidate) => {
    const filesystem_type = await detectFilesystemType(candidate.path);
    const free_bytes = await getFreeBytes(candidate.path);
    let total_bytes: number | null = null;
    try {
      const stats = await statfs(candidate.path);
      total_bytes = Number(stats.blocks) * Number(stats.bsize);
    } catch {
      total_bytes = null;
    }
    const split_output_safe = filesystem_type
      ? !SUPER_AIRLLM_BLOCKED_SPLIT_FS_TYPES.includes(filesystem_type as typeof SUPER_AIRLLM_BLOCKED_SPLIT_FS_TYPES[number])
      : false;
    const materialization_allowed = split_output_safe
      && free_bytes !== null
      && free_bytes >= MIN_SPLIT_FREE_BYTES;
    return {
      ...candidate,
      filesystem_type,
      free_bytes,
      total_bytes,
      split_output_safe,
      materialization_allowed,
    };
  }));
}
