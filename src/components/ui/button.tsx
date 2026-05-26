import React from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
export type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANT_CLASSES = {
  primary:
    "border border-transparent bg-[var(--accent)] text-white shadow-[0_18px_40px_rgba(37,99,235,0.22)] hover:brightness-110",
  secondary:
    "border border-[var(--border-strong)] bg-[var(--surface-elevated)] text-white shadow-[0_18px_40px_rgba(0,0,0,0.2)] hover:border-white/20 hover:bg-white/[0.08]",
  ghost: "border border-transparent bg-transparent text-white hover:bg-white/[0.06]",
  danger:
    "border border-red-500/30 bg-red-500/14 text-[var(--danger-foreground)] shadow-[0_18px_40px_rgba(185,28,28,0.14)] hover:bg-red-500/22",
  subtle:
    "border border-white/8 bg-[var(--surface-glass)] text-[var(--muted-foreground)] shadow-[0_18px_40px_rgba(0,0,0,0.18)] hover:bg-white/[0.08] hover:text-white",
} satisfies Record<ButtonVariant, string>;

const BUTTON_SIZE_CLASSES = {
  sm: "min-h-8 px-3 py-1.5 text-xs",
  md: "min-h-10 px-4 py-2 text-sm",
  lg: "min-h-11 px-5 py-2.5 text-sm",
} satisfies Record<ButtonSize, string>;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export function buttonClassName({
  variant = "secondary",
  size = "md",
  fullWidth = false,
  className,
}: Pick<ButtonProps, "variant" | "size" | "fullWidth" | "className">) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-medium transition",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
    "disabled:cursor-not-allowed disabled:opacity-50",
    fullWidth && "w-full",
    BUTTON_VARIANT_CLASSES[variant],
    BUTTON_SIZE_CLASSES[size],
    className,
  );
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, fullWidth = false, size = "md", type, variant = "secondary", ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type ?? "button"}
      data-ui-button={variant}
      data-ui-button-size={size}
      className={buttonClassName({ variant, size, fullWidth, className })}
    />
  );
});
