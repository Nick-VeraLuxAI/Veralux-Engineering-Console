import { chatOnce } from "./router";
import { listModelStatuses, loadModel, requireModel, modelStatus, unloadModel } from "./manager";
import { getSystemSnapshot } from "./system";

/**
 * Minimal stateless MCP (JSON-RPC over Streamable HTTP, JSON responses) so
 * Hermes Agent can drive the console's model control plane as tools.
 */

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

const SERVER_INFO = { name: "veralux-model-control", version: "1.0.0" };

export const MCP_TOOLS = [
  {
    name: "list_models",
    description:
      "List every model the VeraLux Engineering Console knows on this workstation (served, loadable on demand, or on disk only) with live status (ready/loading/unloaded/not_loadable), context length and GPU needs.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "system_status",
    description: "Current GPU (per-GPU VRAM used/free, processes) and host RAM usage on the workstation.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "load_model",
    description:
      "Load (start serving) a model through the console, e.g. 'deepseek-v4-flash' (the big DeepSeek-V4-Flash model, ~40 s). Waits until it is ready and returns load time. Protected/on-disk-only models are refused.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "Model id or alias from list_models" },
        wait: { type: "boolean", description: "Wait until ready (default true)" },
      },
      required: ["model"],
      additionalProperties: false,
    },
  },
  {
    name: "unload_model",
    description:
      "Unload (stop serving) a console-managed model to free GPU/RAM. By default it unloads once the model has been idle for idle_grace_seconds (default 20) so an in-progress reply can finish; set force=true to stop immediately.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string" },
        idle_grace_seconds: { type: "number", description: "Unload after this many idle seconds (default 20)" },
        force: { type: "boolean", description: "Stop immediately even if busy" },
      },
      required: ["model"],
      additionalProperties: false,
    },
  },
  {
    name: "chat_with_model",
    description:
      "Send one prompt to a specific model through the console router and return its reply with timing and tokens/sec. Managed models auto-load if needed. Note: 'receptionist-qwen' is shared with live phone calls; use it sparingly.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string" },
        prompt: { type: "string" },
        system: { type: "string" },
        max_tokens: { type: "number", description: "Default 512" },
      },
      required: ["model", "prompt"],
      additionalProperties: false,
    },
  },
] as const;

function toolText(value: unknown, isError = false) {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    isError,
  };
}

async function callTool(name: string, args: Record<string, unknown>) {
  const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  switch (name) {
    case "list_models": {
      const models = await listModelStatuses();
      return toolText(
        models.map((m) => ({
          id: m.id,
          status: m.status,
          kind: m.kind,
          label: m.label,
          contextLength: m.contextLength,
          loadable: m.loadable,
          protected: m.protected,
          sharedWithReceptionist: m.sharedWithReceptionist,
          vramMiB: m.resources?.vramMiB ?? null,
          gpu: m.resources?.gpuIndex ?? null,
          notLoadableReason: m.status === "not_loadable" || m.protected ? m.notLoadableReason : undefined,
          loadSeconds: m.process?.loadSeconds ?? undefined,
        })),
      );
    }
    case "system_status":
      return toolText(await getSystemSnapshot());
    case "load_model": {
      const started = Date.now();
      const view = await loadModel(str("model"), { wait: args.wait !== false });
      return toolText({
        id: view.id,
        status: view.status,
        loadSeconds: view.process?.loadSeconds ?? null,
        toolElapsedSeconds: Math.round((Date.now() - started) / 100) / 10,
        pid: view.process?.pid ?? null,
      });
    }
    case "unload_model": {
      const grace = typeof args.idle_grace_seconds === "number" ? args.idle_grace_seconds : 20;
      const view = await unloadModel(str("model"), { idleGraceSeconds: grace, force: args.force === true });
      return toolText({
        id: view.id,
        status: view.status,
        deferred: view.deferred ?? false,
        message: view.deferred
          ? `Unload scheduled: ${view.id} will stop after ${grace}s idle.`
          : `${view.id} is now ${view.status}.`,
        unloadSeconds: view.unloadSeconds ?? null,
      });
    }
    case "chat_with_model": {
      requireModel(str("model"));
      const result = await chatOnce({
        model: str("model"),
        prompt: str("prompt"),
        system: str("system") || undefined,
        maxTokens: typeof args.max_tokens === "number" ? args.max_tokens : 512,
      });
      const status = await modelStatus(requireModel(result.model));
      return toolText({ ...result, reasoning: undefined, modelStatus: status.status });
    }
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { rpcCode: -32602 });
  }
}

export async function handleMcpMessage(msg: JsonRpcRequest): Promise<Record<string, unknown> | null> {
  const id = msg.id ?? null;
  const isNotification = msg.id === undefined || msg.id === null;
  try {
    switch (msg.method) {
      case "initialize": {
        const requested = (msg.params?.protocolVersion as string) || "2025-03-26";
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: requested,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions:
              "VeraLux Engineering Console model control: list/load/unload workstation models, check GPU/RAM, and route prompts to a chosen model.",
          },
        };
      }
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        const args = (msg.params?.arguments as Record<string, unknown>) ?? {};
        try {
          return { jsonrpc: "2.0", id, result: await callTool(name, args) };
        } catch (error) {
          if ((error as { rpcCode?: number }).rpcCode) throw error;
          return { jsonrpc: "2.0", id, result: toolText(`Error: ${error instanceof Error ? error.message : String(error)}`, true) };
        }
      }
      default:
        if (isNotification) return null;
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
    }
  } catch (error) {
    if (isNotification) return null;
    return {
      jsonrpc: "2.0",
      id,
      error: { code: (error as { rpcCode?: number }).rpcCode ?? -32603, message: error instanceof Error ? error.message : String(error) },
    };
  }
}
