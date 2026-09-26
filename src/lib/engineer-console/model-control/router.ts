import http from "node:http";
import { Readable } from "node:stream";
import { getCatalog, resolveCatalogModel } from "./catalog";
import { ensureRoutable, ModelControlError, modelStatus, trackRequestStart } from "./manager";
import type { CatalogModel } from "./types";

export interface UpstreamResult {
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array>;
}

/** POST JSON to an upstream OpenAI-compatible server without client-side timeouts
 *  (big-model generations can exceed undici's 300 s header timeout). */
function postUpstream(url: string, payload: string, onClose: () => void, signal?: AbortSignal): Promise<UpstreamResult> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          authorization: "Bearer local",
        },
      },
      (res) => {
        res.on("close", onClose);
        res.on("error", onClose);
        const headers: Record<string, string> = {};
        const ct = res.headers["content-type"];
        if (ct) headers["content-type"] = Array.isArray(ct) ? ct[0] : ct;
        resolve({
          status: res.statusCode ?? 502,
          headers,
          body: Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>,
        });
      },
    );
    req.on("error", (err) => {
      onClose();
      reject(err);
    });
    if (signal) {
      signal.addEventListener("abort", () => req.destroy(new Error("client aborted")), { once: true });
    }
    req.end(payload);
  });
}

export interface RoutedRequest {
  model: CatalogModel;
  autoLoaded: boolean;
  loadSeconds: number | null;
  upstream: UpstreamResult;
}

/** Route an OpenAI chat/completions body to the chosen model (auto-loading if needed). */
export async function routeChatCompletion(
  body: Record<string, unknown>,
  signal?: AbortSignal,
  endpoint: "chat/completions" | "completions" = "chat/completions",
): Promise<RoutedRequest> {
  const requested = typeof body.model === "string" ? body.model : "";
  const model = resolveCatalogModel(requested);
  if (!model) {
    const known = getCatalog().filter((m) => m.kind !== "on_disk").map((m) => m.id);
    throw new ModelControlError("MODEL_NOT_FOUND", `Unknown model "${requested}". Routable: ${known.join(", ")}`, 404);
  }
  const { autoLoaded, loadSeconds } = await ensureRoutable(model);
  const payload = JSON.stringify({ ...body, model: model.upstreamModel });
  const done = trackRequestStart(model.id);
  try {
    const upstream = await postUpstream(`${model.baseUrl!.replace(/\/+$/, "")}/${endpoint}`, payload, done, signal);
    return { model, autoLoaded, loadSeconds, upstream };
  } catch (error) {
    done();
    throw new ModelControlError(
      "UPSTREAM_ERROR",
      `${model.id} upstream failed: ${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }
}

/** Non-streaming convenience used by MCP tools. */
export async function chatOnce(input: {
  model: string;
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<{
  model: string;
  upstreamModel: string | null;
  content: string;
  reasoning: string | null;
  usage: Record<string, number> | null;
  autoLoaded: boolean;
  loadSeconds: number | null;
  elapsedSeconds: number;
  completionTokensPerSecond: number | null;
}> {
  const started = Date.now();
  const messages: Array<{ role: string; content: string }> = [];
  if (input.system) messages.push({ role: "system", content: input.system });
  messages.push({ role: "user", content: input.prompt });
  const routed = await routeChatCompletion({
    model: input.model,
    messages,
    max_tokens: input.maxTokens ?? 512,
    temperature: input.temperature ?? 0.2,
    stream: false,
  });
  const text = await new Response(routed.upstream.body).text();
  const genStarted = routed.autoLoaded && routed.loadSeconds ? started + routed.loadSeconds * 1000 : started;
  if (routed.upstream.status >= 400) {
    throw new ModelControlError("UPSTREAM_HTTP", `${routed.model.id} HTTP ${routed.upstream.status}: ${text.slice(0, 300)}`, 502);
  }
  const data = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null } }>;
    usage?: Record<string, number>;
  };
  const elapsedSeconds = (Date.now() - started) / 1000;
  const genSeconds = (Date.now() - genStarted) / 1000;
  const completion = data.usage?.completion_tokens;
  return {
    model: routed.model.id,
    upstreamModel: routed.model.upstreamModel,
    content: data.choices?.[0]?.message?.content ?? "",
    reasoning: data.choices?.[0]?.message?.reasoning_content ?? null,
    usage: data.usage ?? null,
    autoLoaded: routed.autoLoaded,
    loadSeconds: routed.loadSeconds,
    elapsedSeconds: Math.round(elapsedSeconds * 10) / 10,
    completionTokensPerSecond: completion && genSeconds > 0 ? Math.round((completion / genSeconds) * 10) / 10 : null,
  };
}

/** OpenAI /v1/models view of routable models. */
export async function openAiModelList(): Promise<{ object: "list"; data: Array<Record<string, unknown>> }> {
  const routable = getCatalog().filter((m) => m.kind !== "on_disk");
  const views = await Promise.all(routable.map((m) => modelStatus(m)));
  return {
    object: "list",
    data: views.map((v) => ({
      id: v.id,
      object: "model",
      created: 0,
      owned_by: "veralux-engineering-console",
      root: v.upstreamModel,
      context_length: v.contextLength,
      max_model_len: v.contextLength,
      status: v.status,
      aliases: v.aliases,
      protected: v.protected,
    })),
  };
}
