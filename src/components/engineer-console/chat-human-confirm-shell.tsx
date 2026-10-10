import React from "react";

export function ChatHumanConfirmShell({
  title,
  throughModel,
  children,
}: {
  title: string;
  throughModel: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      data-chat-human-confirm="true"
      data-chat-confirm-through-model={throughModel ? "true" : "false"}
      className="rounded-[1.15rem] border border-white/10 bg-black/30 p-3"
    >
      <p className="text-[12px] uppercase tracking-wide text-white/60">
        {throughModel ? "Vera is asking" : "Your decision"}
      </p>
      <p className="mt-1 text-[13px] font-medium text-white">{title}</p>
      <p className="mt-1 text-[13px] text-white/60">
        {throughModel
          ? "Your answers go back into this chat so Vera can continue. This still does not start a run by itself."
          : "These buttons are yours. They are not sent through Vera."}
      </p>
      <div className="mt-3">{children}</div>
    </div>
  );
}
