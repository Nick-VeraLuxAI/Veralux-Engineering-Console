"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import { EngineerSessionBar } from "./engineer-session-bar";

export function CanvasFloatingMenu({
  open,
  onOpenChange,
  initiallyOpen = false,
  showSessionBar = true,
  placement = "absolute",
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initiallyOpen?: boolean;
  showSessionBar?: boolean;
  placement?: "absolute" | "inline";
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(initiallyOpen);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const resolvedOpen = open ?? uncontrolledOpen;
  const setResolvedOpen = (nextOpen: boolean) => {
    if (onOpenChange) {
      onOpenChange(nextOpen);
      return;
    }
    setUncontrolledOpen(nextOpen);
  };

  useEffect(() => {
    if (resolvedOpen) {
      setClosing(false);
      panelRef.current?.focus();
    }
    return () => {
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    };
  }, [resolvedOpen]);

  const closeWithMotion = () => {
    if (!resolvedOpen || closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setResolvedOpen(false);
      return;
    }
    setClosing(true);
    exitTimerRef.current = window.setTimeout(() => {
      setClosing(false);
      setResolvedOpen(false);
      exitTimerRef.current = null;
    }, 120);
  };

  return (
    <div
      className={
        placement === "inline"
          ? "relative z-50"
          : "absolute left-3 top-3 z-50 pt-[env(safe-area-inset-top)] sm:left-4 sm:top-4"
      }
    >
      <button
        type="button"
        data-motion-press="true"
        data-canvas-menu-button="true"
        aria-expanded={resolvedOpen}
        aria-controls="canvas-floating-menu"
        aria-haspopup="dialog"
        aria-label={resolvedOpen ? "Close VeraLux menu" : "Open VeraLux menu"}
        onClick={() => (resolvedOpen ? closeWithMotion() : setResolvedOpen(true))}
        className={
          placement === "inline"
            ? "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] text-white/80 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070d]"
            : "inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#04070d]/88 px-3 py-2 text-sm text-white shadow-[0_18px_32px_rgba(2,6,23,0.35)] backdrop-blur-xl transition hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070d]"
        }
      >
        <span className="font-medium">VeraLux</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className={`h-3 w-3 text-[var(--muted)] motion-safe:transition-transform motion-safe:duration-180 ${
            resolvedOpen ? "rotate-180" : ""
          }`}
        >
          <path d="M2 4.5 6 8l4-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        </svg>
      </button>

      {resolvedOpen ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={closeWithMotion}
            className="fixed inset-0 z-50 bg-transparent"
          />
          <div
            ref={panelRef}
            id="canvas-floating-menu"
            data-canvas-menu-overlay="true"
            data-menu-closing={closing ? "true" : "false"}
            role="dialog"
            aria-modal="false"
            tabIndex={-1}
            onFocus={() => panelRef.current?.focus()}
            className="absolute left-0 top-full z-[60] mt-2 max-h-[min(80dvh,36rem)] w-[min(23rem,calc(100vw-1.5rem))] overflow-y-auto rounded-[1.6rem] border border-white/10 bg-[#07101c]/96 p-4 shadow-[0_30px_60px_rgba(2,6,23,0.42)] backdrop-blur-xl"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">VeraLux</p>
                <h2 className="mt-1 text-base font-semibold text-white">Engineering Console</h2>
              </div>
              <button
                type="button"
                data-motion-press="true"
                onClick={closeWithMotion}
                className="rounded-full border border-white/10 px-3 py-1 text-xs text-[var(--muted)] transition hover:border-white/20 hover:text-white"
              >
                Close
              </button>
            </div>

            <nav className="mt-4 grid gap-2" aria-label="Engineer floating navigation">
              <Link href="/" data-motion-press="true" className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white transition hover:border-white/20">
                Home
              </Link>
              <Link href="/engineer" data-motion-press="true" className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white transition hover:border-white/20">
                Engineering Console
              </Link>
              <Link href="/engineer?focus=repository&start=repo" className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white transition hover:border-white/20" data-canvas-start-repo="true" data-motion-press="true">
                Start a repo
              </Link>
              <Link href="/engineer/repos" data-motion-press="true" className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white transition hover:border-white/20">
                Repositories
              </Link>
              <Link href="/engineer/compatibility" data-motion-press="true" className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white transition hover:border-white/20">
                Compatibility
              </Link>
              <Link href="/engineer?details=queue#canvas-detail-drawer" data-motion-press="true" className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white transition hover:border-white/20">
                Queue
              </Link>
              <Link href="/engineer?details=activity#canvas-detail-drawer" data-motion-press="true" className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white transition hover:border-white/20">
                Activity
              </Link>
              <Link href="/engineer?details=docs#canvas-detail-drawer" data-motion-press="true" className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white transition hover:border-white/20">
                Docs
              </Link>
            </nav>

            {showSessionBar ? (
              <div className="mt-4">
                <EngineerSessionBar variant="menu" />
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
