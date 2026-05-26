import React from "react";
import { cn } from "./cn";

export type BadgeVariant =
  | "ready"
  | "warning"
  | "blocked"
  | "info"
  | "muted"
  | "active"
  | "completed";
export type BadgeSize = "sm" | "md";

const BADGE_VARIANT_CLASSES = {
  ready: "border border-emerald-500/30 bg-emerald-500/14 text-emerald-100",
  warning: "border border-amber-500/30 bg-amber-500/14 text-amber-100",
  blocked: "border border-red-500/30 bg-red-500/14 text-red-100",
  info: "border border-sky-500/30 bg-sky-500/14 text-sky-100",
  muted: "border border-[var(--border)] bg-[var(--surface-inset)] text-[var(--muted-foreground)]",
  active: "border border-blue-500/30 bg-blue-500/14 text-blue-100",
  completed: "border border-emerald-500/30 bg-emerald-500/18 text-emerald-50",
} satisfies Record<BadgeVariant, string>;

const BADGE_SIZE_CLASSES = {
  sm: "px-2 py-0.5 text-[11px]",
  md: "px-2.5 py-1 text-xs",
} satisfies Record<BadgeSize, string>;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
}

export function badgeClassName({
  className,
  size = "md",
  variant = "muted",
}: Pick<BadgeProps, "className" | "size" | "variant">) {
  return cn(
    "inline-flex items-center rounded-full font-medium",
    BADGE_VARIANT_CLASSES[variant],
    BADGE_SIZE_CLASSES[size],
    className,
  );
}

export function Badge({ className, size = "md", variant = "muted", ...props }: BadgeProps) {
  return (
    <span
      {...props}
      data-ui-badge={variant}
      data-ui-badge-size={size}
      className={badgeClassName({ variant, size, className })}
    />
  );
}
