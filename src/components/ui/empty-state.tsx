import React from "react";
import { cn } from "./cn";
import { surfaceClassName } from "./surface";

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  description: React.ReactNode;
  action?: React.ReactNode;
  centered?: boolean;
  compact?: boolean;
}

export function EmptyState({
  action,
  centered = false,
  className,
  compact = false,
  description,
  title,
  ...props
}: EmptyStateProps) {
  return (
    <div
      {...props}
      data-ui-empty-state="true"
      className={surfaceClassName({
        variant: "inset",
        padding: compact ? "md" : "lg",
        className: cn("border-dashed text-sm text-[var(--muted)]", centered && "text-center", className),
      })}
    >
      <p className="font-medium text-white">{title}</p>
      <p className="mt-2">{description}</p>
      {action ? (
        <div className={cn("mt-4", centered ? "flex justify-center" : "flex flex-wrap items-center gap-2")}>
          {action}
        </div>
      ) : null}
    </div>
  );
}
