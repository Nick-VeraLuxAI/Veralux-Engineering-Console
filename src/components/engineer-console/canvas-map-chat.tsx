"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MapChatBackendId, MapChatMode, MapChatModel, MapChatModelId } from "@/lib/engineer-console/dashboard/map-chat";
import { commissionTaskReply, type CommissionTaskProposal } from "@/lib/engineer-console/dashboard/commission-task-intent";
import { parseMapChatProposal } from "@/lib/engineer-console/dashboard/map-chat-proposal";
import { jobsFromFleet, type FleetJobRef } from "@/lib/engineer-console/dashboard/multitask-fleet-intent";
import {
  adaptMapChatFrameToViewport,
  clampMapChatFrame,
  defaultMapChatDockSize,
  defaultMapChatFrame,
  isCompactMapChatViewport,
  loadMapChatFrame,
  readVisibleViewport,
  moveMapChatFrame,
  projectMapChatSheetHeight,
  resizeMapChatDock,
  resizeMapChatFrame,
  saveMapChatFrame,
  snapMapChatSheetHeight,
  stepMapChatSheetSpring,
  type MapChatDockSize,
  type MapChatFrame,
  type MapChatResizeEdge,
} from "@/lib/engineer-console/dashboard/map-chat-frame";
import {
  createMapChatThread,
  createPlaceholderMapChatThread,
  loadMapChatThreads,
  MAP_CHAT_SSR_THREAD_ID,
  mergeThreadFocus,
  resolveThreadFocusFromLines,
  saveMapChatThreads,
  titleFromThreadLines,
  type MapChatProject,
  type MapChatThread,
  type MapChatThreadFocus,
} from "@/lib/engineer-console/dashboard/map-chat-threads";
import { MAP_CHAT_JOB_RECOVERY_PROMPT } from "@/lib/engineer-console/dashboard/map-chat-self-model";
import { AlignmentQuestionnaireForm } from "./alignment-questionnaire-form";
import { bulkyProposalLabel, ChatStageWorkbench } from "./canvas-chat-workbench";

const EMPTY_DISMISSED_WORKBENCH: ReadonlySet<string> = new Set();
import { ChatApprovalBar } from "./chat-approval-bar";
import { ChatHumanConfirmShell } from "./chat-human-confirm-shell";
import { CommissionTaskForm } from "./commission-task-form";
import { MultitaskFleetBoard } from "./multitask-fleet-board";
import { StartRepoForm } from "./start-repo-form";

const MODES: Array<{ id: MapChatMode; label: string; hint: string }> = [
  { id: "plan", label: "Plan", hint: "Think through the map. No run start." },
  { id: "ask", label: "Ask", hint: "Questions only." },
  { id: "multitask", label: "Multitask", hint: "Split only when you ask. Compact list, one commence." },
  { id: "agent", label: "Agent", hint: "One thread, like Cursor. Specs stay one job." },
];

const DEFAULT_MODELS: MapChatModel[] = [
  { id: "nano30b", label: "Nano 30B", role: "Primary worker" },
  { id: "deepseek", label: "DeepSeek", role: "On-demand senior" },
  { id: "auto", label: "Auto", role: "Escalate when Nano is down or fails" },
];

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070d]";

const RESIZE_HANDLES: Array<{ edge: MapChatResizeEdge; className: string; label: string }> = [
  { edge: "n", className: "-top-0.5 left-3 right-3 h-3 cursor-n-resize", label: "Resize top" },
  { edge: "s", className: "-bottom-0.5 left-3 right-3 h-3 cursor-s-resize", label: "Resize bottom" },
  { edge: "e", className: "bottom-3 -right-0.5 top-3 w-3 cursor-e-resize", label: "Resize right" },
  { edge: "w", className: "bottom-3 -left-0.5 top-3 w-3 cursor-w-resize", label: "Resize left" },
  { edge: "ne", className: "-right-0.5 -top-0.5 h-4 w-4 cursor-ne-resize", label: "Resize top right" },
  { edge: "nw", className: "-left-0.5 -top-0.5 h-4 w-4 cursor-nw-resize", label: "Resize top left" },
  { edge: "se", className: "-bottom-0.5 -right-0.5 h-4 w-4 cursor-se-resize", label: "Resize bottom right" },
  { edge: "sw", className: "-bottom-0.5 -left-0.5 h-4 w-4 cursor-sw-resize", label: "Resize bottom left" },
];

function readViewport() {
  return readVisibleViewport();
}

function isChatChromeTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest("button, summary, a, input, textarea, select, details, [data-map-chat-resize], [data-map-chat-select]"),
    )
  );
}

function QuietSelect({
  id,
  label,
  value,
  disabled,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  options: Array<{ id: string; label: string; hint?: string }>;
  onChange: (value: string) => void;
}) {
  const selected = options.find((item) => item.id === value);

  return (
    <details
      id={id}
      data-map-chat-select={id}
      className="relative min-w-0 flex-1"
      onToggle={(event) => {
        if (!event.currentTarget.open) return;
        const root = event.currentTarget.closest("[data-map-chat-selectors]");
        root?.querySelectorAll("details[data-map-chat-select]").forEach((node) => {
          if (node !== event.currentTarget) (node as HTMLDetailsElement).open = false;
        });
      }}
    >
      <summary
        aria-label={label}
        aria-disabled={disabled ? true : undefined}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
        className={`${focusRing} flex cursor-pointer list-none items-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] tracking-tight text-white/55 transition hover:bg-white/[0.04] hover:text-white [&::-webkit-details-marker]:hidden ${
          disabled ? "cursor-default opacity-40" : ""
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? label}</span>
        <svg aria-hidden="true" viewBox="0 0 12 12" className="h-2.5 w-2.5 shrink-0 text-white/60">
          <path
            d="M3 4.5 6 8l3-3.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
        </svg>
      </summary>
      <div
        role="listbox"
        aria-label={label}
        className="absolute bottom-full left-0 right-0 z-40 mb-1.5 max-h-44 overflow-y-auto rounded-[1.1rem] border border-white/10 bg-[#0b1220] p-1 shadow-[0_18px_32px_rgba(2,6,23,0.55)]"
      >
        {options.map((item) => {
          const active = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={active}
              disabled={disabled}
              onClick={(event) => {
                const root = event.currentTarget.closest("details");
                if (root) root.open = false;
                onChange(item.id);
              }}
              className={`${focusRing} flex w-full items-center justify-between gap-2 rounded-[0.9rem] px-2.5 py-1.5 text-left text-[12px] tracking-tight ${
                active
                  ? "bg-white/[0.08] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
                  : "text-white/75 hover:bg-white/[0.05] hover:text-white"
              }`}
            >
              <span className="truncate">{item.label}</span>
              {item.hint ? <span className="shrink-0 text-white/60">{item.hint}</span> : null}
            </button>
          );
        })}
      </div>
    </details>
  );
}

type SoftScrollThumb = { top: string; height: string };

function readSoftScrollThumb(el: HTMLElement): SoftScrollThumb | null {
  const overflow = el.scrollHeight - el.clientHeight;
  if (overflow <= 1) return null;
  const height = Math.max(16, (el.clientHeight / el.scrollHeight) * 100);
  const top = (el.scrollTop / overflow) * (100 - height);
  return { top: `${top}%`, height: `${height}%` };
}

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
  repos = [],
  workingRepo = null,
  layout = "overlay",
  dockSize,
  onWorkingRepoChange,
  onSnapMap,
  onFrameChange,
  onDockSizeChange,
  onDockSizeCommit,
  onStartRepo,
  pendingApproval = null,
  workbenchTabId = null,
  dismissedWorkbenchIds,
  onWorkbenchTabs,
  onSelectWorkbenchTab,
  onDismissWorkbenchTab,
  onClearWorkbenchDismissals,
}: {
  mapSummary: string;
  projects?: MapChatProject[];
  repos?: Array<{ id: string; name: string }>;
  workingRepo?: { id: string; name: string } | null;
  layout?: "overlay" | "docked";
  dockSize?: MapChatDockSize;
  onWorkingRepoChange?: (repoId: string) => void;
  onSnapMap?: (focus: MapChatThreadFocus) => void;
  onFrameChange?: (frame: MapChatFrame) => void;
  onDockSizeChange?: (size: MapChatDockSize) => void;
  onDockSizeCommit?: (size: MapChatDockSize) => void;
  onStartRepo?: () => void;
  pendingApproval?: import("@/lib/engineer-console/dashboard/workflow-map").ChatPendingApproval | null;
  workbenchTabId?: string | null;
  dismissedWorkbenchIds?: ReadonlySet<string>;
  onWorkbenchTabs?: (tabs: Array<{ id: string; label: string }>) => void;
  onSelectWorkbenchTab?: (id: string) => void;
  onDismissWorkbenchTab?: (id: string) => void;
  onClearWorkbenchDismissals?: () => void;
}) {
  const [threads, setThreads] = useState<MapChatThread[]>(() => [createPlaceholderMapChatThread()]);
  const [activeId, setActiveId] = useState(MAP_CHAT_SSR_THREAD_ID);
  const [hydrated, setHydrated] = useState(false);
  const historyRef = useRef<HTMLDetailsElement>(null);
  const [models, setModels] = useState<MapChatModel[]>(DEFAULT_MODELS);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [escalateReason, setEscalateReason] = useState<string | undefined>();
  const endRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [logThumb, setLogThumb] = useState<SoftScrollThumb | null>(null);
  const [logRailActive, setLogRailActive] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const snapKeyRef = useRef("");
  const recoveryKickRef = useRef<string | null>(null);
  const lastRepoIdRef = useRef<string | null | undefined>(undefined);
  const sendRef = useRef<(text: string, options?: { hideUser?: boolean; runId?: string }) => Promise<void>>(
    async () => undefined,
  );
  const [recoveryRunId, setRecoveryRunId] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const frameRef = useRef<MapChatFrame | null>(null);
  const dragRef = useRef<
    | { kind: "move"; pointerOffsetX: number; pointerOffsetY: number }
    | { kind: "resize"; edge: MapChatResizeEdge; startX: number; startY: number; start: MapChatFrame }
    | {
        kind: "sheet";
        startY: number;
        startHeight: number;
        samples: Array<{ height: number; at: number }>;
      }
    | null
  >(null);
  const sheetAnimationRef = useRef<number | null>(null);
  const [sheetDragging, setSheetDragging] = useState(false);
  const [frame, setFrame] = useState<MapChatFrame | null>(null);
  const layoutRef = useRef(layout);
  const dockSizeRef = useRef<MapChatDockSize>(
    dockSize ?? defaultMapChatDockSize({ width: 1280, height: 800 }),
  );
  const onDockSizeChangeRef = useRef(onDockSizeChange);
  const onDockSizeCommitRef = useRef(onDockSizeCommit);
  layoutRef.current = layout;
  dockSizeRef.current = dockSize ?? dockSizeRef.current;
  onDockSizeChangeRef.current = onDockSizeChange;
  onDockSizeCommitRef.current = onDockSizeCommit;

  function commitFrame(next: MapChatFrame) {
    frameRef.current = next;
    setFrame(next);
    saveMapChatFrame(next);
  }

  const active = threads.find((thread) => thread.id === activeId) ?? threads[0];
  const mode = active?.mode ?? "agent";
  const model = active?.model ?? "nano30b";
  const working = active?.working ?? "nano30b";
  const workingLabel = active?.workingLabel ?? "Nano 30B";
  const lines = active?.lines ?? [];
  const escalated = lines.some((line) => line.escalated);
  const listedModels = models.length ? models : DEFAULT_MODELS;
  const repoLabel = workingRepo?.name ?? "";
  const repoId = workingRepo?.id ?? "";
  const listedThreads = useMemo(
    () =>
      [...threads]
        .filter((thread) => thread.id !== MAP_CHAT_SSR_THREAD_ID)
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [threads],
  );
  const modeHint = MODES.find((item) => item.id === mode)?.hint ?? "";
  const [workbenchHost, setWorkbenchHost] = useState<Element | null>(null);

  useLayoutEffect(() => {
    if (layout !== "docked") {
      setWorkbenchHost(null);
      return;
    }
    setWorkbenchHost(document.querySelector("[data-canvas-workbench]"));
  }, [hydrated, layout, lines.length, pendingApproval]);

  const useStage = Boolean(workbenchHost);
  const workbenchLineIndex = useMemo(() => {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i]?.proposal) return i;
    }
    return -1;
  }, [lines]);
  const planWorkbenchId =
    workbenchLineIndex >= 0 ? `plan:${workbenchLineIndex}` : null;
  const decisionWorkbenchId = pendingApproval ? `decision:${pendingApproval.runId}` : null;
  const dismissedIds = dismissedWorkbenchIds ?? EMPTY_DISMISSED_WORKBENCH;
  const workbenchTabs = useMemo(() => {
    const tabs: Array<{ id: string; label: string }> = [];
    if (decisionWorkbenchId && !dismissedIds.has(decisionWorkbenchId)) {
      tabs.push({ id: decisionWorkbenchId, label: pendingApproval?.title?.trim() || "Decision" });
    }
    const proposal = workbenchLineIndex >= 0 ? lines[workbenchLineIndex]?.proposal : undefined;
    if (proposal && planWorkbenchId && !dismissedIds.has(planWorkbenchId)) {
      tabs.push({ id: planWorkbenchId, label: bulkyProposalLabel(proposal) });
    }
    return tabs;
  }, [decisionWorkbenchId, dismissedIds, lines, pendingApproval?.title, planWorkbenchId, workbenchLineIndex]);

  function dismissWorkbenchTab(id: string) {
    onDismissWorkbenchTab?.(id);
  }

  function openWorkbenchTab(id: string) {
    onSelectWorkbenchTab?.(id);
  }

  function isPlanWorkbenchId(id: string | null | undefined): boolean {
    return Boolean(id?.startsWith("plan:"));
  }

  useEffect(() => {
    onWorkbenchTabs?.(workbenchTabs);
  }, [onWorkbenchTabs, workbenchTabs]);

  useLayoutEffect(() => {
    const stored = loadMapChatThreads();
    setThreads(stored.threads);
    setActiveId(stored.activeId);
    if (layoutRef.current !== "docked") {
      const nextFrame = loadMapChatFrame(readViewport());
      frameRef.current = nextFrame;
      setFrame(nextFrame);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (pendingApproval?.runId) setRecoveryRunId(pendingApproval.runId);
  }, [pendingApproval?.runId]);

  useEffect(() => {
    if (!hydrated || !pendingApproval?.runId) return;
    const runId = pendingApproval.runId;
    if (recoveryKickRef.current === runId) return;
    try {
      const key = `map-chat-recovery:${runId}`;
      if (sessionStorage.getItem(key) === "1") {
        recoveryKickRef.current = runId;
        return;
      }
      sessionStorage.setItem(key, "1");
    } catch {
      recoveryKickRef.current = runId;
    }
    recoveryKickRef.current = runId;
    void sendRef.current(MAP_CHAT_JOB_RECOVERY_PROMPT, { hideUser: true, runId });
  }, [hydrated, pendingApproval?.runId]);

  useEffect(() => {
    if (frame) onFrameChange?.(frame);
  }, [frame, onFrameChange]);

  useEffect(() => {
    if (layout === "docked") return;
    const handleResize = () => {
      const current = frameRef.current ?? defaultMapChatFrame(readViewport());
      commitFrame(adaptMapChatFrameToViewport(current, readViewport()));
    };
    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, [layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const cancelSheetAnimation = () => {
      if (sheetAnimationRef.current !== null) {
        window.cancelAnimationFrame(sheetAnimationRef.current);
        sheetAnimationRef.current = null;
      }
    };

    const emitDockSize = (next: MapChatDockSize) => {
      dockSizeRef.current = next;
      onDockSizeChangeRef.current?.(next);
    };

    const commitDockSize = (next: MapChatDockSize) => {
      dockSizeRef.current = next;
      if (onDockSizeCommitRef.current) {
        onDockSizeCommitRef.current(next);
      } else {
        onDockSizeChangeRef.current?.(next);
      }
    };

    const animateSheetTo = (targetHeight: number, initialVelocity: number) => {
      cancelSheetAnimation();
      const viewport = readViewport();
      const width = dockSizeRef.current.width;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reducedMotion) {
        const next = { width, height: targetHeight };
        emitDockSize(next);
        commitDockSize(next);
        return;
      }

      let height = dockSizeRef.current.height;
      let velocity = initialVelocity;
      let previousTime = performance.now();

      const tick = (time: number) => {
        if (layoutRef.current !== "docked") {
          sheetAnimationRef.current = null;
          return;
        }
        const next = stepMapChatSheetSpring(
          height,
          targetHeight,
          velocity,
          time - previousTime,
        );
        height = next.height;
        velocity = next.velocity;
        previousTime = time;
        emitDockSize({ width, height: Math.round(height) });
        if (next.settled) {
          sheetAnimationRef.current = null;
          commitDockSize({ width, height: targetHeight });
          return;
        }
        sheetAnimationRef.current = window.requestAnimationFrame(tick);
      };

      sheetAnimationRef.current = window.requestAnimationFrame(tick);
    };

    const startDrag = (event: PointerEvent | MouseEvent) => {
      if (event.button !== 0 || dragRef.current) return;
      const docked = layoutRef.current === "docked";
      const current = docked
        ? { x: 0, y: 0, width: dockSizeRef.current.width, height: dockSizeRef.current.height }
        : frameRef.current;
      if (!current) return;
      const target = event.target;
      if (!(target instanceof Element) || !root.contains(target)) return;
      cancelSheetAnimation();

      const resize = target.closest("[data-map-chat-resize]");
      if (resize instanceof HTMLElement) {
        const edge = resize.getAttribute("data-map-chat-resize") as MapChatResizeEdge | null;
        if (!edge) return;
        event.preventDefault();
        dragRef.current = {
          kind: "resize",
          edge,
          startX: event.clientX,
          startY: event.clientY,
          start: current,
        };
        return;
      }

      const viewport = readViewport();
      if (
        docked &&
        isCompactMapChatViewport(viewport) &&
        !isChatChromeTarget(target) &&
        target.closest("[data-map-chat-drag-handle]")
      ) {
        event.preventDefault();
        dragRef.current = {
          kind: "sheet",
          startY: event.clientY,
          startHeight: current.height,
          samples: [{ height: current.height, at: performance.now() }],
        };
        setSheetDragging(true);
        if (event instanceof PointerEvent) {
          try {
            root.setPointerCapture(event.pointerId);
          } catch {
            // Window listeners still preserve the gesture when capture is unavailable.
          }
        }
        return;
      }

      if (docked || isChatChromeTarget(target)) return;
      if (!target.closest("[data-map-chat-drag-handle]")) return;
      event.preventDefault();
      dragRef.current = {
        kind: "move",
        pointerOffsetX: event.clientX - current.x,
        pointerOffsetY: event.clientY - current.y,
      };
    };

    const handlePointerMove = (event: PointerEvent | MouseEvent) => {
      const drag = dragRef.current;
      const docked = layoutRef.current === "docked";
      const current = docked
        ? { x: 0, y: 0, width: dockSizeRef.current.width, height: dockSizeRef.current.height }
        : frameRef.current;
      if (!drag || !current) return;
      event.preventDefault();
      const viewport = readViewport();
      if (drag.kind === "sheet") {
        const height = projectMapChatSheetHeight(
          drag.startHeight + drag.startY - event.clientY,
          viewport,
        );
        const now = performance.now();
        drag.samples = [...drag.samples, { height, at: now }]
          .filter((sample) => now - sample.at <= 140)
          .slice(-8);
        emitDockSize({ width: current.width, height });
        return;
      }
      if (drag.kind === "move") {
        if (docked) return;
        commitFrame(
          moveMapChatFrame(
            current,
            { x: event.clientX - drag.pointerOffsetX, y: event.clientY - drag.pointerOffsetY },
            viewport,
          ),
        );
        return;
      }
      if (docked) {
        emitDockSize(
          resizeMapChatDock(
            { width: drag.start.width, height: drag.start.height },
            drag.edge,
            { x: event.clientX - drag.startX, y: event.clientY - drag.startY },
            viewport,
          ),
        );
        return;
      }
      commitFrame(
        resizeMapChatFrame(
          drag.start,
          drag.edge,
          { x: event.clientX - drag.startX, y: event.clientY - drag.startY },
          viewport,
        ),
      );
    };
    const handlePointerUp = () => {
      const drag = dragRef.current;
      const docked = layoutRef.current === "docked";
      if (!drag) return;
      dragRef.current = null;
      setSheetDragging(false);

      if (!docked) return;
      const viewport = readViewport();
      const current = dockSizeRef.current;
      if (drag.kind === "sheet") {
        const last = drag.samples[drag.samples.length - 1];
        const first = drag.samples[0];
        const elapsed = last && first ? Math.max(1, last.at - first.at) : 1;
        const velocity = last && first ? ((last.height - first.height) / elapsed) * 1000 : 0;
        animateSheetTo(snapMapChatSheetHeight(current.height, velocity, viewport), velocity);
        return;
      }

      if (
        drag.kind === "resize" &&
        isCompactMapChatViewport(viewport) &&
        (drag.edge === "n" || drag.edge === "s")
      ) {
        animateSheetTo(snapMapChatSheetHeight(current.height, 0, viewport), 0);
        return;
      }

      commitDockSize(current);
    };

    window.addEventListener("pointerdown", startDrag, true);
    window.addEventListener("mousedown", startDrag, true);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("mouseup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointerdown", startDrag, true);
      window.removeEventListener("mousedown", startDrag, true);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("mouseup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      cancelSheetAnimation();
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const persisted = threads.filter((thread) => thread.id !== MAP_CHAT_SSR_THREAD_ID);
    if (!persisted.length) return;
    const saveId = persisted.some((thread) => thread.id === activeId) ? activeId : persisted[0].id;
    saveMapChatThreads(persisted, saveId);
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
    const el = logRef.current;
    if (!el) return;
    let hideTimer = 0;
    const sync = (reveal = false) => {
      setLogThumb(readSoftScrollThumb(el));
      if (!reveal) return;
      setLogRailActive(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setLogRailActive(false), 900);
    };
    sync();
    const onScroll = () => sync(true);
    el.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(() => sync());
    observer.observe(el);
    return () => {
      window.clearTimeout(hideTimer);
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [busy, dockSize?.height, frame?.height, lines]);

  useEffect(() => {
    if (!hydrated) return;
    setThreads((current) =>
      current.map((thread) => {
        if (thread.focus) return thread;
        const focus = resolveThreadFocusFromLines(thread.lines, projects);
        return focus ? { ...thread, focus } : thread;
      }),
    );
  }, [hydrated, projects]);

  useEffect(() => {
    const focus = active?.focus;
    const key = `${activeId}:${focus?.nodeId ?? ""}:${focus?.projectId ?? ""}`;
    if (!hydrated || !focus || key === snapKeyRef.current) return;
    snapKeyRef.current = key;
    if (
      focus.nodeId === "run" ||
      focus.nodeId === "review" ||
      focus.nodeId === "pr" ||
      focus.nodeId === "release" ||
      focus.nodeId === "audit"
    ) {
      return;
    }
    onSnapMap?.(focus);
  }, [active?.focus, activeId, hydrated, onSnapMap]);

  function beginFreshThread(focus: MapChatThreadFocus | null = null) {
    const next = createMapChatThread(focus);
    setThreads((current) => {
      const kept = current.filter((thread) => thread.id !== MAP_CHAT_SSR_THREAD_ID);
      return [next, ...kept];
    });
    setActiveId(next.id);
    setDraft("");
    setError(null);
    setEscalateReason(undefined);
    setRecoveryRunId(null);
    onClearWorkbenchDismissals?.();
    recoveryKickRef.current = null;
    if (historyRef.current) historyRef.current.open = false;
  }

  useEffect(() => {
    if (!hydrated) return;
    const nextId = workingRepo?.id ?? null;
    if (lastRepoIdRef.current === undefined) {
      lastRepoIdRef.current = nextId;
      return;
    }
    const prevId = lastRepoIdRef.current;
    lastRepoIdRef.current = nextId;
    if (prevId === nextId) return;
    // Repo first appearing after load should not wipe restored thread history.
    if (prevId === null) return;
    beginFreshThread(
      workingRepo
        ? {
            nodeId: "repository",
            projectId: `repo:${workingRepo.id}`,
            projectLabel: workingRepo.name,
          }
        : null,
    );
  }, [hydrated, workingRepo]);

  function patchActive(patch: Partial<MapChatThread>) {
    setThreads((current) => updateActiveThread(current, activeId, patch));
  }

  function updateLineJob(lineIndex: number, job: FleetJobRef) {
    const nextLines = lines.map((line, index) => {
      if (index !== lineIndex) return line;
      const existing =
        line.jobs ?? (line.proposal?.type === "multitask_fleet" ? jobsFromFleet(line.proposal) : []);
      const jobs = existing.some((entry) => entry.itemIndex === job.itemIndex)
        ? existing.map((entry) => (entry.itemIndex === job.itemIndex ? { ...entry, ...job } : entry))
        : [...existing, job];
      return { ...line, jobs };
    });
    patchActive({ lines: nextLines });
  }

  function renderProposalCard(index: number) {
    const line = lines[index];
    if (!line?.proposal) return null;
    if (line.proposal.type === "alignment_questionnaire") {
      return (
        <ChatHumanConfirmShell title="A few choices before this can start" throughModel>
          <AlignmentQuestionnaireForm proposal={line.proposal} onContinue={(message) => void send(message)} />
        </ChatHumanConfirmShell>
      );
    }
    if (line.proposal.type === "start_repo") {
      return (
        <ChatHumanConfirmShell title="Confirm starting this repo" throughModel={false}>
          <StartRepoForm
            initialName={line.proposal.name ?? ""}
            initialDescription={line.proposal.description ?? ""}
            embedded
            onStarted={(started) => {
              patchActive({
                focus: {
                  nodeId: "repository",
                  projectId: `repo:${started.id}`,
                  projectLabel: started.name,
                },
              });
              onWorkingRepoChange?.(started.id);
            }}
          />
        </ChatHumanConfirmShell>
      );
    }
    if (line.proposal.type === "commission_task") {
      return (
        <ChatHumanConfirmShell title="Confirm this task" throughModel={false}>
          <CommissionTaskForm
            initialTitle={line.proposal.title ?? ""}
            initialObjective={line.proposal.objective ?? ""}
            initialSuccess={line.proposal.success ?? ""}
            initialConstraints={line.proposal.constraints ?? ""}
            initialStartRun={line.proposal.startRunAfterCreate}
            workingRepo={workingRepo}
            compact={!useStage}
            onCommissioned={(result) => {
              patchActive({
                lines: [
                  ...lines,
                  {
                    role: "assistant",
                    content: result.runId
                      ? `Task created on ${workingRepo?.name ?? "the working repo"} and autonomous run started. Opening the run view.`
                      : `Task created on ${workingRepo?.name ?? "the working repo"}. Opening the task.`,
                    workingLabel: "Vera",
                  },
                ],
              });
              window.location.assign(result.redirect);
            }}
          />
        </ChatHumanConfirmShell>
      );
    }
    return (
      <ChatHumanConfirmShell title="Confirm these jobs" throughModel={false}>
        <MultitaskFleetBoard
          proposal={line.proposal}
          jobs={line.jobs}
          workingRepo={workingRepo}
          onRepoStarted={(started) => onWorkingRepoChange?.(started.id)}
          onJobUpdate={(job) => updateLineJob(index, job)}
          onStartNewThread={startThread}
        />
      </ChatHumanConfirmShell>
    );
  }

  const approvalBar = pendingApproval ? (
    <ChatApprovalBar
      pending={pendingApproval}
      onAskVera={() => {
        void send(MAP_CHAT_JOB_RECOVERY_PROMPT);
      }}
      onHumanDecision={(action, rationale) => {
        setRecoveryRunId(pendingApproval.runId);
        if (action === "approve") {
          void send(
            `The operator accepted delivery for this job.${rationale ? ` Reason: ${rationale}` : ""} Summarize what was accepted and what to verify in the worktree sandbox next. Do not approve or send back for them.`,
          );
          return;
        }
        if (action !== "request_fix") return;
        void send(
          `The operator chose Continue engineering.${rationale ? ` Feedback: ${rationale}` : ""} Autonomous Engineer should resume on this run. Summarize the feedback and what to watch for. Do not approve.`,
        );
      }}
    />
  ) : null;

  function startThread() {
    beginFreshThread(
      workingRepo
        ? {
            nodeId: "repository",
            projectId: `repo:${workingRepo.id}`,
            projectLabel: workingRepo.name,
          }
        : null,
    );
  }

  function selectThread(id: string) {
    setActiveId(id);
    if (historyRef.current) historyRef.current.open = false;
    setError(null);
    setEscalateReason(undefined);
  }

  function openStartRepoForm(proposal: StartRepoProposal = { type: "start_repo", name: null, description: null }) {
    if (!active) return;
    patchActive({
      lines: [
        ...lines,
        {
          role: "assistant",
          content: startRepoReply(proposal),
          workingLabel: "Vera",
          proposal,
        },
      ],
    });
    onStartRepo?.();
  }

  function openCommissionTaskForm(
    proposal: CommissionTaskProposal = {
      type: "commission_task",
      title: null,
      objective: null,
      success: null,
      constraints: null,
      repoId: workingRepo?.id ?? null,
    },
  ) {
    if (!active) return;
    patchActive({
      lines: [
        ...lines,
        {
          role: "assistant",
          content: commissionTaskReply({
            ...proposal,
            repoId: proposal.repoId ?? workingRepo?.id ?? null,
          }),
          workingLabel: "Vera",
          proposal: {
            ...proposal,
            repoId: proposal.repoId ?? workingRepo?.id ?? null,
          },
        },
      ],
    });
  }

  async function send(text: string, options?: { hideUser?: boolean; runId?: string }) {
    const next = text.trim();
    if (!next || busy || !active) return;
    setDraft("");
    setError(null);
    if (fieldRef.current) fieldRef.current.style.height = "auto";
    const userLine = { role: "user" as const, content: next };
    const nextLines = options?.hideUser ? lines : [...lines, userLine];
    const historyLines = options?.hideUser ? [...lines, userLine] : nextLines;
    const repoFocus = workingRepo
      ? {
          nodeId: active.focus?.nodeId ?? ("repository" as const),
          projectId: `repo:${workingRepo.id}`,
          projectLabel: workingRepo.name,
        }
      : null;
    const nextFocus = mergeThreadFocus(
      mergeThreadFocus(active.focus, repoFocus),
      resolveThreadFocusFromLines(nextLines, projects),
    );
    patchActive({
      lines: nextLines,
      title: titleFromThreadLines(nextLines, active.focus?.projectLabel ?? active.title),
      focus: nextFocus,
    });
    setBusy(true);
    try {
      const history = historyLines
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
          workingRepoId: workingRepo?.id,
          pendingRunId: options?.runId ?? pendingApproval?.runId ?? recoveryRunId,
        }),
      });
      const payload = (await response.json()) as {
        reply?: string;
        error?: string;
        workingModel?: MapChatBackendId;
        workingLabel?: string;
        escalated?: boolean;
        reason?: string;
        proposal?: unknown;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Chat failed");
      }
      const proposal = parseMapChatProposal(payload.proposal);
      const replyLines = [
        ...nextLines,
        {
          role: "assistant" as const,
          content: payload.reply || "",
          workingLabel: payload.workingLabel,
          escalated: payload.escalated,
          proposal,
          jobs: proposal?.type === "multitask_fleet" ? jobsFromFleet(proposal) : undefined,
        },
      ];
      const replyFocus = mergeThreadFocus(nextFocus, resolveThreadFocusFromLines(replyLines, projects));
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
  sendRef.current = send;

  const docked = layout === "docked";
  const reportedWidth = docked ? dockSize?.width ?? dockSizeRef.current.width : frame?.width;
  const reportedHeight = docked ? dockSize?.height ?? dockSizeRef.current.height : frame?.height;

  return (
    <aside
      ref={rootRef}
      data-canvas-map-chat="true"
      data-map-chat-layout={layout}
      data-map-chat-drag={dragRef.current ? "true" : "false"}
      data-map-chat-sheet-dragging={sheetDragging ? "true" : "false"}
      data-map-chat-x={docked ? "0" : frame ? String(frame.x) : undefined}
      data-map-chat-y={docked ? "0" : frame ? String(frame.y) : undefined}
      data-map-chat-width={reportedWidth ? String(reportedWidth) : undefined}
      data-map-chat-height={reportedHeight ? String(reportedHeight) : undefined}
      aria-label="Map chat"
      className={
        docked
          ? "pointer-events-auto relative flex h-full min-h-0 w-full flex-col overflow-hidden border-white/8 bg-[#05070d]/92 @container max-md:border-t md:border-r"
          : `pointer-events-auto absolute z-30 flex min-h-0 max-h-[calc(100svh-1rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-[1.6rem] border border-white/8 bg-[#05070d]/72 shadow-[0_16px_34px_rgba(2,6,23,0.28)] backdrop-blur-xl @container ${
              frame ? "" : "bottom-24 left-3 right-3 top-auto h-[min(28rem,calc(100svh-8rem))] w-auto max-w-none sm:right-auto sm:max-w-[20.5rem] sm:w-[20.5rem]"
            }`
      }
      style={
        docked || !frame
          ? undefined
          : {
              left: frame.x,
              top: frame.y,
              width: frame.width,
              height: frame.height,
            }
      }
    >
      {RESIZE_HANDLES.map((handle) => {
        const splitter = docked && handle.edge === "e";
        return (
          <button
            key={handle.edge}
            type="button"
            aria-label={handle.label}
            data-map-chat-resize={handle.edge}
            data-map-chat-splitter={splitter ? "true" : undefined}
            className={`absolute z-20 touch-none border-0 p-0 ${handle.className} ${
              splitter
                ? "right-0 top-0 h-full w-2 cursor-ew-resize bg-transparent hover:bg-white/[0.06]"
                : "bg-transparent"
            }`}
          />
        );
      })}
      <header
        data-map-chat-drag-handle="true"
        data-map-chat-sheet-snap={docked ? "true" : undefined}
        className={`select-none px-3 pt-2 ${
          docked
            ? "max-md:touch-none max-md:cursor-ns-resize"
            : "cursor-grab active:cursor-grabbing"
        }`}
      >
        <div
          data-map-chat-move="true"
          className={`mb-2 flex items-center justify-center py-1 ${
            docked
              ? "max-md:cursor-ns-resize"
              : "cursor-grab active:cursor-grabbing"
          }`}
        >
          <span className="h-1 w-10 rounded-full bg-white/22" aria-hidden="true" />
          <span className="sr-only">
            {docked ? "Drag to resize and snap chat" : "Drag to move chat"}
          </span>
        </div>
        <div className="mb-2 flex items-center gap-1">
          <button
            type="button"
            data-map-chat-new-thread="true"
            aria-label="New chat"
            onClick={startThread}
            className={`${focusRing} inline-flex h-8 items-center justify-center rounded-full px-2 text-[12px] text-white/60 transition hover:bg-white/[0.05] hover:text-white`}
          >
            New chat
          </button>
          <details ref={historyRef} className="min-w-0 flex-1" data-map-chat-threads="true">
            <summary
              aria-label="Thread history"
              className={`${focusRing} cursor-pointer list-none rounded-full px-2 py-1 text-left text-[12px] tracking-tight text-white/55 transition hover:bg-white/[0.04] hover:text-white [&::-webkit-details-marker]:hidden`}
            >
              <span className="block truncate">{active?.title ?? "New"}</span>
            </summary>
            <div
              data-map-chat-thread-list="true"
              className="mt-1 max-h-40 overflow-y-auto rounded-[1.1rem] border border-white/8 bg-black/25 p-1"
            >
              {listedThreads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  data-map-chat-thread={thread.id}
                  onClick={() => selectThread(thread.id)}
                  className={`${focusRing} flex w-full items-center justify-between gap-2 rounded-[0.9rem] px-2.5 py-1.5 text-left text-[12px] tracking-tight ${
                    thread.id === activeId ? "bg-white/[0.07] text-white" : "text-white/60 hover:bg-white/[0.04] hover:text-white"
                  }`}
                >
                  <span className="truncate">{thread.title}</span>
                  {thread.focus?.projectLabel ? (
                    <span className="shrink-0 text-white/28">{thread.focus.projectLabel}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </details>
        </div>

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
                    : "text-white/60 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                {item.id === "multitask" ? (
                  <>
                    <span className="@[17rem]:hidden">Multi</span>
                    <span className="hidden @[17rem]:inline">Multitask</span>
                  </>
                ) : (
                  item.label
                )}
              </button>
            );
          })}
        </div>
        <p className="sr-only">Chat</p>
        <p
          className={`mt-2 px-1 text-[12px] tracking-tight ${escalated ? "text-amber-100/70" : "text-white/60"}`}
          role="status"
          data-map-chat-working={working}
          data-map-chat-project={active?.focus?.projectId ?? ""}
        >
          <span>
            Working on {workingLabel}
            {repoLabel ? ` · ${repoLabel}` : ""}
            {escalated ? " · escalated from Nano 30B" : ""}
          </span>
          <span className="sr-only">. {modeHint}</span>
        </p>
        {escalateReason ? (
          <p className="mt-1 px-1 text-[13px] tracking-tight text-white/60">{escalateReason}</p>
        ) : null}
      </header>

      <div className="group/log relative min-h-0 flex-1">
        <div
          ref={logRef}
          className="h-full space-y-4 overflow-y-auto px-4 py-4"
          data-map-chat-log="true"
        >
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
                <p className="mb-1.5 text-[13px] text-white/60">
                  {line.workingLabel}
                  {line.escalated ? " · escalated" : ""}
                </p>
              ) : null}
              <p className="whitespace-pre-wrap">{line.content}</p>
              {useStage && line.proposal && planWorkbenchId && !dismissedIds.has(planWorkbenchId) ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="text-[12px] text-white/60 hover:text-white"
                    data-map-chat-workbench-chip="true"
                    onClick={() => openWorkbenchTab(planWorkbenchId)}
                  >
                    Opened in the workspace · {bulkyProposalLabel(line.proposal)}
                  </button>
                  <button
                    type="button"
                    className="text-[12px] text-white/60 hover:text-white"
                    data-map-chat-workbench-dismiss="true"
                    onClick={() => dismissWorkbenchTab(planWorkbenchId)}
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
              {!useStage && line.proposal ? <div className="mt-3">{renderProposalCard(index)}</div> : null}
            </div>
          ))}
          {pendingApproval && useStage && decisionWorkbenchId && !dismissedIds.has(decisionWorkbenchId) ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="text-[12px] text-white/60 hover:text-white"
                data-map-chat-workbench-chip="true"
                onClick={() => openWorkbenchTab(decisionWorkbenchId)}
              >
                Decision is in the workspace
              </button>
              <button
                type="button"
                className="text-[12px] text-white/60 hover:text-white"
                data-map-chat-workbench-dismiss="true"
                onClick={() => dismissWorkbenchTab(decisionWorkbenchId)}
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {!useStage ? approvalBar : null}
          {busy ? <p className="text-[12px] text-white/60">{workingLabel} is working…</p> : null}
          {error ? <p className="text-[12px] text-rose-300/70">{error}</p> : null}
          <div ref={endRef} />
        </div>
        {logThumb ? (
          <div
            aria-hidden
            data-map-chat-scrollbar="true"
            data-map-chat-scrollbar-active={logRailActive ? "true" : "false"}
            className={`pointer-events-none absolute inset-y-3 right-1.5 w-0.5 transition-opacity duration-300 ${
              logRailActive ? "opacity-100" : "opacity-0 group-hover/log:opacity-100"
            }`}
          >
            <div
              className="absolute w-full rounded-full bg-white/12"
              style={{ top: logThumb.top, height: logThumb.height }}
            />
          </div>
        ) : null}
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
          <div className="mb-1 flex items-center gap-2 px-0.5" data-map-chat-selectors="true">
            {repos.length ? (
              <QuietSelect
                id="map-chat-repo"
                label="Repository"
                value={repoId}
                disabled={busy || repos.length === 0}
                options={repos.map((repo) => ({ id: repo.id, label: repo.name }))}
                onChange={(next) => {
                  const selected = repos.find((repo) => repo.id === next);
                  if (!selected || selected.id === workingRepo?.id) return;
                  onWorkingRepoChange?.(selected.id);
                }}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate px-1 text-[12px] text-white/60">
                <span className="sm:hidden">No repo</span>
                <span className="hidden sm:inline">No repo selected</span>
              </span>
            )}
            <button
              type="button"
              data-map-chat-start-repo="true"
              className="shrink-0 rounded-full px-2 py-1 text-[12px] text-white/60 hover:text-white"
              onClick={() => openStartRepoForm()}
            >
              <span className="sm:hidden">New repo</span>
              <span className="hidden sm:inline">Start a repo</span>
            </button>
            <button
              type="button"
              data-map-chat-commission-task="true"
              className="shrink-0 rounded-full px-2 py-1 text-[12px] text-white/60 hover:text-white"
              onClick={() => openCommissionTaskForm()}
            >
              <span className="sm:hidden">New task</span>
              <span className="hidden sm:inline">Commission a task</span>
            </button>
            <QuietSelect
              id="map-chat-model"
              label="Model"
              value={model}
              disabled={busy}
              options={listedModels.map((item) => ({
                id: item.id,
                label: item.label,
                hint: item.reachable === false ? "offline" : undefined,
              }))}
              onChange={(nextValue) => {
                const next = nextValue as MapChatModelId;
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
            />
          </div>
          <div className="flex items-end gap-2">
            <textarea
              id="map-chat-draft"
              ref={fieldRef}
              value={draft}
              rows={1}
              placeholder={pendingApproval ? "Ask about this job…" : "Ask Vera…"}
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
              className="max-h-32 min-h-8 flex-1 resize-none bg-transparent text-[16px] leading-6 tracking-tight text-white outline-none placeholder:text-white/28 sm:text-[15px]"
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
      <ChatStageWorkbench
        host={useStage && workbenchTabId ? workbenchHost : null}
        onClose={workbenchTabId ? () => dismissWorkbenchTab(workbenchTabId) : undefined}
      >
        {decisionWorkbenchId && workbenchTabId === decisionWorkbenchId ? approvalBar : null}
        {isPlanWorkbenchId(workbenchTabId) && workbenchLineIndex >= 0
          ? renderProposalCard(workbenchLineIndex)
          : null}
      </ChatStageWorkbench>
    </aside>
  );
}
