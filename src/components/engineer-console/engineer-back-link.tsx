"use client";

import Link from "next/link";
import React from "react";
import { usePathname } from "next/navigation";
import { engineerBackTarget } from "@/lib/engineer-console/dashboard/engineer-back-nav";

export function EngineerBackLink({
  href,
  label,
}: {
  href?: string;
  label?: string;
}) {
  const pathname = usePathname();
  const target = engineerBackTarget(pathname);
  const resolvedHref = href ?? target.href;
  const resolvedLabel = label ?? target.label;

  return (
    <Link
      href={resolvedHref}
      data-engineer-back="true"
      data-motion-press="true"
      aria-label={resolvedLabel}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-black/40 px-3 py-1.5 text-[13px] text-white/70 backdrop-blur-xl transition hover:border-white/16 hover:text-white"
    >
      <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3">
        <path
          d="M8 2.5 3.5 6 8 9.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
      Back
    </Link>
  );
}
