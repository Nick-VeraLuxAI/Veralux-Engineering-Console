"use client";

import React from "react";
import { createPortal } from "react-dom";
import type { MapChatProposal } from "@/lib/engineer-console/dashboard/map-chat-proposal";

export type ChatWorkbenchTab = {
  id: string;
  label: string;
};

export function bulkyProposalLabel(proposal: MapChatProposal): string {
  switch (proposal.type) {
    case "alignment_questionnaire":
      return "Alignment";
    case "start_repo":
      return proposal.name?.trim() || "Start repo";
    case "commission_task":
      return proposal.title?.trim() || "Task";
    case "multitask_fleet":
      return "Job list";
  }
}

export function ChatStageWorkbench({
  host,
  onClose,
  children,
}: {
  host: Element | null;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  if (!host) return null;
  const content = React.Children.toArray(children).filter(Boolean);
  if (content.length === 0) return null;
  return createPortal(
    <div data-canvas-workbench-panel="true" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-2">
        <p className="text-[12px] text-white/60">Workspace</p>
        <button
          type="button"
          data-canvas-workbench-close="true"
          className="rounded-full border border-white/12 px-3 py-1 text-[12px] text-white/70 hover:bg-white/10 hover:text-white"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">{content}</div>
    </div>,
    host,
  );
}
