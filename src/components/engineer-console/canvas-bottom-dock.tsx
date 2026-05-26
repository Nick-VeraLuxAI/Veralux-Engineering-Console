import Link from "next/link";
import React from "react";
import type { WorkflowDockLink } from "@/lib/engineer-console/dashboard/workflow-map";

export function CanvasBottomDock({
  links,
  activeId,
  onActivateLink,
}: {
  links: WorkflowDockLink[];
  activeId: string;
  onActivateLink?: (id: string) => void;
}) {
  return (
    <nav
      aria-label="Bottom dock"
      data-canvas-bottom-dock="true"
      className="flex max-w-full items-center gap-1.5 overflow-x-auto rounded-full border border-white/8 bg-[#05070d]/78 px-2.5 py-2 shadow-[0_16px_34px_rgba(2,6,23,0.28)] backdrop-blur-xl"
    >
      {links.map((link) => {
        const active = link.id === activeId;
        const className = `shrink-0 rounded-full px-3 py-2 text-sm transition ${
          active
            ? "bg-white/[0.08] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
            : "text-[var(--muted)] hover:bg-white/[0.04] hover:text-white"
        }`;

        if (onActivateLink) {
          return (
            <button
              key={link.id}
              type="button"
              data-canvas-dock-link={link.id}
              data-canvas-dock-active={active ? "true" : "false"}
              className={className}
              onClick={() => onActivateLink(link.id)}
            >
              {link.label}
            </button>
          );
        }

        return (
          <Link key={link.id} href={link.href} data-canvas-dock-active={active ? "true" : "false"} className={className}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
