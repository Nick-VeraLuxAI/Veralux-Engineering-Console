"use client";

import React, { useEffect } from "react";
import { usePathname } from "next/navigation";
import { CanvasBottomDock } from "./canvas-bottom-dock";
import { CanvasFloatingMenu } from "./canvas-floating-menu";
import { EngineerBackLink } from "./engineer-back-link";

const SHEET_DOCK = [
  { id: "workflow", label: "Map", href: "/engineer" },
  { id: "repos", label: "Repos", href: "/engineer/repos" },
  { id: "tasks", label: "Tasks", href: "/engineer?details=tasks" },
  { id: "runs", label: "Runs", href: "/engineer?details=queue" },
  { id: "reviews", label: "Review", href: "/engineer?details=queue" },
];

function dockActiveId(pathname: string) {
  if (pathname.startsWith("/engineer/repos")) return "repos";
  if (pathname.startsWith("/engineer/compatibility")) return "repos";
  if (pathname.startsWith("/engineer/runs")) return "runs";
  if (pathname.startsWith("/engineer/tasks")) return "tasks";
  return "workflow";
}

function contextLabel(pathname: string) {
  if (pathname.startsWith("/engineer/repos")) return "Repositories";
  if (pathname.startsWith("/engineer/compatibility")) return "Compatibility";
  if (pathname.startsWith("/engineer/runs")) return "Run";
  if (pathname.startsWith("/engineer/tasks")) return "Task";
  return "Map";
}

export function EngineerRouteShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const immersiveHome = pathname === "/engineer";
  const loginRoute = pathname === "/engineer/login";

  useEffect(() => {
    if (loginRoute) return;

    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = immersiveHome ? "hidden" : "";
    document.body.style.overscrollBehavior = "none";

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, [immersiveHome, loginRoute]);

  if (loginRoute) {
    return <div className="min-h-dvh">{children}</div>;
  }

  if (immersiveHome) {
    return (
      <div
        data-engineer-route-shell="immersive"
        data-engineer-surface="map"
        className="fixed inset-0 z-0 overflow-hidden bg-[#05060a]"
      >
        <div key={pathname} data-engineer-route-content="true" className="h-full">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      data-engineer-route-shell="immersive"
      data-engineer-surface="sheet"
      className="fixed inset-0 z-0 flex flex-col overflow-hidden bg-[#05060a] text-white"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.03),transparent_42%)]" />
      <header className="relative z-40 flex min-h-12 shrink-0 items-center gap-2 border-b border-white/8 bg-[#070a12] px-3 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] sm:px-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <CanvasFloatingMenu placement="inline" />
          <EngineerBackLink />
        </div>
        <div className="ml-auto min-w-0 text-right">
          <p className="truncate text-[13px] font-medium tracking-tight text-white sm:hidden">
            {contextLabel(pathname)}
          </p>
          <p className="hidden min-w-0 items-baseline gap-2 sm:flex">
            <span className="truncate text-[14px] font-medium tracking-tight text-white">
              Engineering Console
            </span>
            <span className="truncate text-[12px] text-white/60">{contextLabel(pathname)}</span>
          </p>
        </div>
      </header>
      <main className="relative min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
        <div
          key={pathname}
          data-engineer-route-content="true"
          className="mx-auto w-full max-w-4xl"
        >
          {children}
        </div>
      </main>
      <footer
        data-engineer-bottom-dock-slot="true"
        className="relative z-30 flex shrink-0 justify-center border-t border-white/8 bg-[#070a12] px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4"
      >
        <CanvasBottomDock links={SHEET_DOCK} activeId={dockActiveId(pathname)} />
      </footer>
    </div>
  );
}
