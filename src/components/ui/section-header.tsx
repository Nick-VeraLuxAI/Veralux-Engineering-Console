import React from "react";
import { cn } from "./cn";

type SectionHeaderHeading = "h1" | "h2" | "h3" | "h4";

export interface SectionHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  titleAs?: SectionHeaderHeading;
  titleId?: string;
  titleClassName?: string;
  descriptionClassName?: string;
}

export function SectionHeader({
  actions,
  className,
  description,
  descriptionClassName,
  meta,
  title,
  titleAs = "h2",
  titleId,
  titleClassName,
  ...props
}: SectionHeaderProps) {
  const Heading = titleAs;

  return (
    <div
      {...props}
      data-ui-section-header="true"
      className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Heading id={titleId} className={cn("font-semibold text-white", titleClassName)}>
            {title}
          </Heading>
          {meta}
        </div>
        {description ? (
          <p className={cn("mt-1 text-sm text-[var(--muted)]", descriptionClassName)}>
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
