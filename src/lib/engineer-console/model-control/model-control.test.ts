import { describe, expect, it } from "vitest";
import { defaultCatalog, resolveCatalogModel } from "./catalog";
import { handleMcpMessage, MCP_TOOLS } from "./mcp";
import { parseGpuCsv, parseMeminfo } from "./system";

describe("model-control catalog", () => {
  const catalog = defaultCatalog({} as NodeJS.ProcessEnv);

  it("protects the Receptionist 8082 model and never makes it loadable", () => {
    const qwen = resolveCatalogModel("Nemotron-Nano-30B-A3B-NVFP4", catalog, {} as NodeJS.ProcessEnv)!;
    expect(qwen.id).toBe("receptionist-qwen");
    expect(qwen.kind).toBe("external");
    expect(qwen.protected).toBe(true);
    expect(qwen.launch).toBeNull();
  });

  it("resolves default/auto and aliases to DeepSeek on GPU 0 with a capped expert cache", () => {
    const ds = resolveCatalogModel("default", catalog, {} as NodeJS.ProcessEnv)!;
    expect(ds.id).toBe("deepseek-v4-flash");
    expect(resolveCatalogModel("deepseek-v4-flash-ftw-tp1", catalog, {} as NodeJS.ProcessEnv)?.id).toBe("deepseek-v4-flash");
    expect(ds.launch?.cudaVisibleDevices).toBe("0");
    expect(ds.launch?.args).toContain("--moe-cache-size");
    expect(ds.launch?.args).not.toContain("--moe-cache-auto");
    expect(ds.contextLength).toBeGreaterThanOrEqual(64000);
  });

  it("lists big on-disk models as not loadable with a reason", () => {
    const sup = resolveCatalogModel("nemotron-super", catalog, {} as NodeJS.ProcessEnv)!;
    expect(sup.kind).toBe("on_disk");
    expect(sup.notLoadableReason).toMatch(/GPU/);
  });
});

describe("model-control system parsing", () => {
  it("parses nvidia-smi csv and maps processes to GPUs", () => {
    const gpus = parseGpuCsv(
      "0, GPU-a, RTX 5090, 2501, 32607, 30106, 0\n1, GPU-b, RTX 5090, 31731, 32607, 876, 3\n",
      "GPU-b, 10920, VLLM::EngineCore, 31708\n",
    );
    expect(gpus[1].processes[0]).toEqual({ pid: 10920, name: "VLLM::EngineCore", usedMiB: 31708 });
    expect(gpus[0].memoryFreeMiB).toBe(30106);
  });

  it("parses /proc/meminfo", () => {
    const ram = parseMeminfo("MemTotal:       527000000 kB\nMemAvailable:   480000000 kB\nSwapTotal: 8388608 kB\nSwapFree: 8388608 kB\n")!;
    expect(ram.totalGiB).toBeGreaterThan(500);
    expect(ram.swapTotalGiB).toBe(8);
  });
});

describe("model-control MCP", () => {
  it("initializes and lists tools", async () => {
    const init = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect((init?.result as { protocolVersion: string }).protocolVersion).toBe("2025-06-18");
    const list = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = ((list?.result as { tools: Array<{ name: string }> }).tools).map((t) => t.name);
    expect(names).toEqual(MCP_TOOLS.map((t) => t.name));
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  it("refuses to load protected models", async () => {
    const res = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "load_model", arguments: { model: "receptionist-qwen" } },
    });
    const result = res?.result as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/cannot be loaded/);
  });
});
