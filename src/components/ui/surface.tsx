import React from "react";
import { cn } from "./cn";

export type SurfaceVariant = "default" | "elevated" | "glass" | "inset" | "warning" | "danger";
export type SurfacePadding = "none" | "sm" | "md" | "lg";

const SURFACE_VARIANT_CLASSES = {
  default:
    "border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-soft)]",
  elevated:
    "border border-[var(--border-strong)] bg-[var(--surface-elevated)] shadow-[var(--shadow-elevated)]",
  glass: "border border-white/10 bg-[var(--surface-glass)] shadow-[var(--shadow-glass)] backdrop-blur-xl",
  inset:
    "border border-[var(--border)] bg-[var(--surface-inset)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
  warning: "border border-amber-500/30 bg-amber-500/10 shadow-[0_18px_45px_rgba(217,119,6,0.12)]",
  danger: "border border-red-500/30 bg-red-500/10 shadow-[0_18px_45px_rgba(185,28,28,0.12)]",
} satisfies Record<SurfaceVariant, string>;

const SURFACE_PADDING_CLASSES = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
} satisfies Record<SurfacePadding, string>;

type SurfaceOwnProps<T extends React.ElementType> = {
  as?: T;
  variant?: SurfaceVariant;
  padding?: SurfacePadding;
  className?: string;
};

export type SurfaceProps<T extends React.ElementType = "div"> = SurfaceOwnProps<T> &
  Omit<React.ComponentPropsWithoutRef<T>, keyof SurfaceOwnProps<T>>;

export function surfaceClassName({
  className,
  padding = "md",
  variant = "default",
}: Pick<SurfaceOwnProps<React.ElementType>, "className" | "padding" | "variant">) {
  return cn(
    "rounded-[var(--radius-lg)]",
    SURFACE_VARIANT_CLASSES[variant],
    SURFACE_PADDING_CLASSES[padding],
    className,
  );
}

export function Surface<T extends React.ElementType = "div">({
  as,
  className,
  padding = "md",
  variant = "default",
  ...props
}: SurfaceProps<T>) {
  const Component = as ?? "div";
  return (
    <Component
      {...props}
      data-ui-surface={variant}
      className={surfaceClassName({ variant, padding, className })}
    />
  );
}
