import { execFile } from "node:child_process";
import fs from "node:fs";
import type { GpuInfo, SystemSnapshot } from "./types";

function run(cmd: string, args: string[], timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

export function parseGpuCsv(gpuCsv: string, appsCsv: string): GpuInfo[] {
  const gpus: GpuInfo[] = gpuCsv
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [index, uuid, name, used, total, free, util] = line.split(",").map((s) => s.trim());
      return {
        index: Number(index),
        uuid,
        name,
        memoryUsedMiB: Number(used),
        memoryTotalMiB: Number(total),
        memoryFreeMiB: Number(free),
        utilizationPct: Number(util),
        processes: [],
      };
    });
  for (const line of appsCsv.trim().split("\n").filter(Boolean)) {
    const [uuid, pid, name, used] = line.split(",").map((s) => s.trim());
    const gpu = gpus.find((g) => g.uuid === uuid);
    if (gpu) gpu.processes.push({ pid: Number(pid), name, usedMiB: Number(used) });
  }
  return gpus;
}

export function parseMeminfo(text: string): SystemSnapshot["ram"] {
  const kb = (key: string): number => {
    const match = text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"));
    return match ? Number(match[1]) : 0;
  };
  const gib = (v: number) => Math.round((v / 1024 / 1024) * 10) / 10;
  const total = kb("MemTotal");
  const available = kb("MemAvailable");
  return {
    totalGiB: gib(total),
    availableGiB: gib(available),
    usedGiB: gib(total - available),
    swapTotalGiB: gib(kb("SwapTotal")),
    swapFreeGiB: gib(kb("SwapFree")),
  };
}

export async function getSystemSnapshot(): Promise<SystemSnapshot> {
  let gpus: GpuInfo[] = [];
  let gpuError: string | null = null;
  try {
    const [gpuCsv, appsCsv] = await Promise.all([
      run("nvidia-smi", [
        "--query-gpu=index,uuid,name,memory.used,memory.total,memory.free,utilization.gpu",
        "--format=csv,noheader,nounits",
      ]),
      run("nvidia-smi", [
        "--query-compute-apps=gpu_uuid,pid,process_name,used_memory",
        "--format=csv,noheader,nounits",
      ]),
    ]);
    gpus = parseGpuCsv(gpuCsv, appsCsv);
  } catch (error) {
    gpuError = error instanceof Error ? error.message : "nvidia-smi failed";
  }
  let ram: SystemSnapshot["ram"] = null;
  try {
    ram = parseMeminfo(fs.readFileSync("/proc/meminfo", "utf8"));
  } catch {
    ram = null;
  }
  return { at: new Date().toISOString(), gpus, gpuError, ram };
}
