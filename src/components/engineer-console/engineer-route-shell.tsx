"use client";

import React, { useEffect } from "react";
import { usePathname } from "next/navigation";
import { CanvasBottomDock } from "./canvas-bottom-dock";
import { CanvasFloatingMenu } from "./canvas-floating-menu";

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

    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = immersiveHome ? "hidden" : "";
    document.body.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, [immersiveHome, loginRoute]);

  if (loginRoute) {
    return <div className="min-h-screen">{children}</div>;
  }

  if (immersiveHome) {
    return (
      <div
        data-engineer-route-shell="immersive"
        data-engineer-surface="map"
        className="fixed inset-0 z-0 h-[100dvh] w-screen overflow-hidden bg-[#05060a]"
      >
        {children}
      </div>
    );
  }

  return (
    <div
      data-engineer-route-shell="immersive"
      data-engineer-surface="sheet"
      className="fixed inset-0 z-0 h-[100dvh] w-screen overflow-hidden bg-[#05060a] text-white"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.03),transparent_42%)]" />
      <CanvasFloatingMenu />
      <div className="pointer-events-none absolute left-1/2 top-5 z-40 -translate-x-1/2">
        <div className="pointer-events-auto flex items-baseline gap-2 rounded-full border border-white/8 bg-black/40 px-4 py-1.5 backdrop-blur-xl">
          <p className="text-[15px] font-medium tracking-tight">Engineering Console</p>
          <p className="text-[13px] text-white/40">{contextLabel(pathname)}</p>
        </div>
      </div>
      <main className="absolute inset-0 overflow-y-auto px-5 pb-28 pt-24 sm:px-8">
        <div className="mx-auto w-full max-w-4xl">{children}</div>
      </main>
      <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
        <CanvasBottomDock links={SHEET_DOCK} activeId={dockActiveId(pathname)} />
      </div>
    </div>
  );
}
