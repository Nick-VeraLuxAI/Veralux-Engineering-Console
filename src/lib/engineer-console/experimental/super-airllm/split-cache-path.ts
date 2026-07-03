import { execFile } from "child_process";
import { access, mkdir } from "fs/promises";
import path from "path";
import { promisify } from "util";
import {
  SUPER_AIRLLM_BLOCKED_SPLIT_FS_TYPES,
  SUPER_AIRLLM_DEFAULT_SPLIT_CACHE_DIR,
  SUPER_AIRLLM_SPLIT_CACHE_ENV_VAR,
} from "./constants";

const execFileAsync = promisify(execFile);

export type SplitCachePathStatus = "ready" | "blocked";

export interface SplitCachePathResult {
  status: SplitCachePathStatus;
  requested_path: string;
  resolved_path: string | null;
  output_path: string | null;
  filesystem_type: string | null;
  materialization_allowed: boolean;
  blocked_reasons: string[];
  diagnostics: string[];
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
    materialization_allowed: true,
    blocked_reasons: [],
    diagnostics,
  };
}
