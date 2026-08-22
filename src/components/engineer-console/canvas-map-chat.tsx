"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  MapChatBackendId,
  MapChatMode,
  MapChatModel,
  MapChatModelId,
} from "@/lib/engineer-console/dashboard/map-chat";
import {
  createMapChatThread,
  loadMapChatThreads,
  mergeThreadFocus,
  resolveThreadFocus,
  saveMapChatThreads,
  titleFromThreadLines,
  type MapChatProject,
  type MapChatThread,
  type MapChatThreadFocus,
} from "@/lib/engineer-console/dashboard/map-chat-threads";

const MODES: Array<{ id: MapChatMode; label: string; hint: string }> = [
  { id: "plan", label: "Plan", hint: "Think through the map. No run start." },
  { id: "ask", label: "Ask", hint: "Questions only." },
  { id: "multitask", label: "Multitask", hint: "Keep more than one thread in play." },
  { id: "agent", label: "Agent", hint: "Plan, answer, and recommend the next action." },
];

const DEFAULT_MODELS: MapChatModel[] = [
  { id: "nano30b", label: "Nano 30B", role: "Primary worker" },
  { id: "deepseek", label: "DeepSeek", role: "On-demand senior" },
  { id: "auto", label: "Auto", role: "Escalate when Nano is down or fails" },
];

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070d]";

function updateActiveThread(
  threads: MapChatThread[],
  activeId: string,
  patch: Partial<MapChatThread>,
): MapChatThread[] {
  return threads.map((thread) =>
    thread.id === activeId ? { ...thread, ...patch, updatedAt: Date.now() } : thread,
  );
}

export function CanvasMapChat({
  mapSummary,
  projects = [],
  onSnapMap,
}: {
  mapSummary: string;
  projects?: MapChatProject[];
  onSnapMap?: (focus: MapChatThreadFocus) => void;
}) {
  const initial = useMemo(() => createMapChatThread(), []);
  const [threads, setThreads] = useState<MapChatThread[]>([initial]);
  const [activeId, setActiveId] = useState(initial.id);
  const [hydrated, setHydrated] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [models, setModels] = useState<MapChatModel[]>(DEFAULT_MODELS);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [escalateReason, setEscalateReason] = useState<string | undefined>();
  const endRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const snapKeyRef = useRef("");

  const active = threads.find((thread) => thread.id === activeId) ?? threads[0];
  const mode = active?.mode ?? "agent";
  const model = active?.model ?? "nano30b";
  const working = active?.working ?? "nano30b";
  const workingLabel = active?.workingLabel ?? "Nano 30B";
  const lines = active?.lines ?? [];
  const escalated = lines.some((line) => line.escalated);
  const listedModels = models.length ? models : DEFAULT_MODELS;
  const modeHint = MODES.find((item) => item.id === mode)?.hint ?? "";

  useEffect(() => {
    const stored = loadMapChatThreads();
    setThreads(stored.threads);
    setActiveId(stored.activeId);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveMapChatThreads(threads, activeId);
  }, [activeId, hydrated, threads]);

  useEffect(() => {
    void fetch("/api/engineer-console/map-chat", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as { models?: MapChatModel[] };
        if (payload.models?.length) setModels(payload.models);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines, busy]);

  useEffect(() => {
    const focus = active?.focus;
    const key = `${activeId}:${focus?.nodeId ?? ""}:${focus?.projectId ?? ""}`;
    if (!hydrated || !focus || key === snapKeyRef.current) return;
    snapKeyRef.current = key;
    onSnapMap?.(focus);
  }, [active?.focus, activeId, hydrated, onSnapMap]);

  function patchActive(patch: Partial<MapChatThread>) {
    setThreads((current) => updateActiveThread(current, activeId, patch));
  }

  function startThread() {
    const next = createMapChatThread();
    setThreads((current) => [next, ...current]);
    setActiveId(next.id);
    setHistoryOpen(false);
    setError(null);
    setEscalateReason(undefined);
  }

  function selectThread(id: string) {
    setActiveId(id);
    setHistoryOpen(false);
    setError(null);
    setEscalateReason(undefined);
  }

  async function send(text: string) {
    const next = text.trim();
    if (!next || busy || !active) return;
    setDraft("");
    setError(null);
    if (fieldRef.current) fieldRef.current.style.height = "auto";
    const nextLines = [...lines, { role: "user" as const, content: next }];
    const nextFocus = mergeThreadFocus(active.focus, resolveThreadFocus(next, projects));
    patchActive({
      lines: nextLines,
      title: titleFromThreadLines(nextLines, active.focus?.projectLabel ?? active.title),
      focus: nextFocus,
    });
    setBusy(true);
    try {
      const history = nextLines
        .filter((line) => line.role === "user" || line.role === "assistant")
        .slice(-16)
        .map((line) => ({ role: line.role, content: line.content }));
      const projectLine = nextFocus?.projectLabel ? `Project: ${nextFocus.projectLabel}.` : "";
      const response = await fetch("/api/engineer-console/map-chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: next,
          mode,
          model,
          history,
          followWorking: model === "auto" ? working : undefined,
          mapSummary: [mapSummary, projectLine].filter(Boolean).join(" "),
        }),
      });
      const payload = (await response.json()) as {
        reply?: string;
        error?: string;
        workingModel?: MapChatBackendId;
        workingLabel?: string;
        escalated?: boolean;
        reason?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Chat failed");
      }
      const replyLines = [
        ...nextLines,
        {
          role: "assistant" as const,
          content: payload.reply || "",
          workingLabel: payload.workingLabel,
          escalated: payload.escalated,
        },
      ];
      const replyFocus = mergeThreadFocus(nextFocus, resolveThreadFocus(payload.reply || "", projects));
      patchActive({
        lines: replyLines,
        title: titleFromThreadLines(replyLines, replyFocus?.projectLabel ?? active.title),
        focus: replyFocus,
        working: payload.workingModel ?? working,
        workingLabel: payload.workingLabel || workingLabel,
      });
      setEscalateReason(payload.reason);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Chat failed";
      setError(message);
      patchActive({
        lines: [...nextLines, { role: "assistant", content: message }],
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      data-canvas-map-chat="true"
      aria-label="Map chat"
      className="pointer-events-auto absolute bottom-24 left-3 top-[4.25rem] z-30 flex w-[20.5rem] flex-col rounded-[1.6rem] border border-white/8 bg-[#05070d]/72 shadow-[0_16px_34px_rgba(2,6,23,0.28)] backdrop-blur-xl"
    >
      <header className="px-3 pt-3">
        <div className="mb-2 flex items-center gap-1">
          <button
            type="button"
            data-map-chat-new-thread="true"
            aria-label="New thread"
            onClick={startThread}
            className={`${focusRing} inline-flex h-7 w-7 items-center justify-center rounded-full text-white/45 transition hover:bg-white/[0.05] hover:text-white`}
          >
            +
          </button>
          <button
            type="button"
            data-map-chat-threads="true"
            aria-expanded={historyOpen}
            aria-label="Thread history"
            onClick={() => setHistoryOpen((open) => !open)}
            className={`${focusRing} min-w-0 flex-1 rounded-full px-2 py-1 text-left text-[12px] tracking-tight text-white/55 transition hover:bg-white/[0.04] hover:text-white`}
          >
            <span className="block truncate">{active?.title ?? "New"}</span>
          </button>
        </div>
        {historyOpen ? (
          <div
            data-map-chat-thread-list="true"
            className="mb-2 max-h-40 overflow-y-auto rounded-[1.1rem] border border-white/8 bg-black/25 p-1"
          >
            {threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                data-map-chat-thread={thread.id}
                onClick={() => selectThread(thread.id)}
                className={`${focusRing} flex w-full items-center justify-between gap-2 rounded-[0.9rem] px-2.5 py-1.5 text-left text-[12px] tracking-tight ${
                  thread.id === activeId ? "bg-white/[0.07] text-white" : "text-white/45 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                <span className="truncate">{thread.title}</span>
                {thread.focus?.projectLabel ? (
                  <span className="shrink-0 text-white/28">{thread.focus.projectLabel}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        <div
          className="flex items-center gap-0.5 rounded-full border border-white/8 bg-black/20 p-0.5"
          role="tablist"
          aria-label="Chat mode"
        >
          {MODES.map((item) => {
            const selected = mode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                title={item.hint}
                disabled={busy}
                onClick={() => patchActive({ mode: item.id })}
                className={`${focusRing} min-w-0 flex-1 rounded-full px-1.5 py-1.5 text-[12px] tracking-tight transition ${
                  selected
                    ? "bg-white/[0.08] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
                    : "text-white/40 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <p className="sr-only">Chat</p>
        <p
          className={`mt-2 px-1 text-[12px] tracking-tight ${escalated ? "text-amber-100/70" : "text-white/40"}`}
          role="status"
          data-map-chat-working={working}
          data-map-chat-project={active?.focus?.projectId ?? ""}
        >
          <span>
            Working on {workingLabel}
            {active?.focus?.projectLabel ? ` · ${active.focus.projectLabel}` : ""}
            {escalated ? " · escalated from Nano 30B" : ""}
          </span>
          <span className="sr-only">. {modeHint}</span>
        </p>
        {escalateReason ? (
          <p className="mt-1 px-1 text-[12px] tracking-tight text-white/30">{escalateReason}</p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" data-map-chat-log="true">
        {lines.map((line, index) => (
          <div
            key={`${line.role}-${index}`}
            className={
              line.role === "user"
                ? "ml-8 rounded-[1.15rem] bg-white/[0.07] px-3 py-2 text-[13px] leading-6 tracking-tight text-white"
                : "text-[13px] leading-6 tracking-tight text-white/78"
            }
          >
            {line.role === "assistant" && line.workingLabel ? (
              <p className="mb-1.5 text-[11px] text-white/35">
                {line.workingLabel}
                {line.escalated ? " · escalated" : ""}
              </p>
            ) : null}
            <p className="whitespace-pre-wrap">{line.content}</p>
          </div>
        ))}
        {busy ? <p className="text-[12px] text-white/35">{workingLabel} is working…</p> : null}
        {error ? <p className="text-[12px] text-rose-300/70">{error}</p> : null}
        <div ref={endRef} />
      </div>

      <form
        className="px-3 pb-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <label className="sr-only" htmlFor="map-chat-draft">
          Message
        </label>
        <div className="rounded-[1.25rem] border border-white/8 bg-black/25 px-3 py-2 backdrop-blur-xl">
          <div className="mb-1 px-0.5">
            <label className="sr-only" htmlFor="map-chat-model">
              Model
            </label>
            <select
              id="map-chat-model"
              value={model}
              disabled={busy}
              aria-label="Model"
              onChange={(event) => {
                const next = event.target.value as MapChatModelId;
                patchActive({
                  model: next,
                  ...(next === "nano30b" || next === "deepseek"
                    ? {
                        working: next,
                        workingLabel: next === "nano30b" ? "Nano 30B" : "DeepSeek",
                      }
                    : {}),
                });
                setEscalateReason(undefined);
              }}
              className={`${focusRing} appearance-none bg-transparent text-[12px] tracking-tight text-white/45`}
            >
              {listedModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.reachable === false ? " · offline" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <textarea
              id="map-chat-draft"
              ref={fieldRef}
              value={draft}
              rows={1}
              placeholder={`Ask Vera…`}
              disabled={busy}
              onChange={(event) => {
                setDraft(event.target.value);
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(event.target.scrollHeight, 132)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
              className="max-h-32 min-h-8 flex-1 resize-none bg-transparent text-[15px] leading-6 tracking-tight text-white outline-none placeholder:text-white/28"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Send"
              className={`${focusRing} mb-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-white/70 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-25`}
            >
              <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3">
                <path
                  d="M2.2 6h7.6M6.4 2.8 9.8 6 6.4 9.2"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                />
              </svg>
            </button>
          </div>
        </div>
      </form>
    </aside>
  );
}
