import React from "react";

export type CanvasStageTab = {
  id: string;
  label: string;
  closable?: boolean;
};

export function CanvasStageTabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  trailing,
}: {
  tabs: CanvasStageTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      data-canvas-surface-toggle="true"
      data-canvas-stage-tabs="true"
      className="flex h-10 min-w-0 shrink-0 items-stretch border-b border-white/8 bg-[#070a12]"
      role="tablist"
      aria-label="Workspace tabs"
    >
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const selected = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={`flex min-w-0 max-w-[14rem] items-stretch border-r border-white/6 ${
                selected ? "bg-[#0c1018]" : "bg-transparent"
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                data-canvas-surface-tab={tab.id}
                title={tab.label}
                className={`min-w-0 flex-1 truncate px-3 text-left text-[12px] ${
                  selected ? "text-white" : "text-white/60 hover:text-white/85"
                }`}
                onClick={() => onSelect(tab.id)}
              >
                {tab.label}
              </button>
              {tab.closable && onClose ? (
                <button
                  type="button"
                  aria-label={`Close ${tab.label}`}
                  data-canvas-stage-tab-close={tab.id}
                  className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-white/55 hover:bg-white/10 hover:text-white"
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.id);
                  }}
                >
                  <span aria-hidden="true" className="text-[14px] leading-none">
                    ×
                  </span>
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {trailing ? <div className="flex shrink-0 items-center px-1">{trailing}</div> : null}
    </div>
  );
}
