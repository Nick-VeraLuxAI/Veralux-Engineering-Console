"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Surface } from "@/components/ui/surface";
import { EngineerSessionBar } from "./engineer-session-bar";

export function EngineerRouteShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const immersiveHome = pathname === "/engineer";
  const loginRoute = pathname === "/engineer/login";
  const navLinkClassName =
    "rounded-full px-3 py-1.5 text-sm text-[var(--muted)] transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]";
  const activeNavLinkClassName =
    "rounded-full bg-white/[0.08] px-3 py-1.5 text-sm font-medium text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]";
  const linkClassName = (active: boolean) =>
    active ? activeNavLinkClassName : navLinkClassName;

  useEffect(() => {
    if (!immersiveHome) return;

    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, [immersiveHome]);

  if (immersiveHome) {
    return (
      <div
        data-engineer-route-shell="immersive"
        className="fixed inset-0 z-0 h-[100dvh] w-screen overflow-hidden bg-[#03060b]"
      >
        {children}
      </div>
    );
  }

  if (loginRoute) {
    return <div className="min-h-screen">{children}</div>;
  }

  return (
    <div
      data-engineer-route-shell="default"
      className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_28%),var(--background)]"
    >
      <header className="border-b border-white/6 bg-black/10 backdrop-blur-xl">
        <div className="flex flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
                VeraLux
              </p>
              <h1 className="mt-1 text-lg font-semibold text-white">Engineering Console</h1>
            </div>
            <EngineerSessionBar />
          </div>
          <Surface
            as="nav"
            aria-label="Engineering routes"
            className="flex flex-wrap items-center gap-2"
            padding="sm"
            variant="glass"
          >
            <Link
              href="/"
              className={linkClassName(pathname === "/")}
            >
              Home
            </Link>
            <Link
              href="/engineer"
              className={linkClassName(pathname === "/engineer")}
            >
              Engineering Console
            </Link>
            <Link
              href="/engineer/repos"
              className={linkClassName(pathname.startsWith("/engineer/repos"))}
            >
              Repositories
            </Link>
            <Link
              href="/engineer/compatibility"
              className={linkClassName(pathname.startsWith("/engineer/compatibility"))}
            >
              Compatibility
            </Link>
          </Surface>
        </div>
      </header>
      <main className="px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
