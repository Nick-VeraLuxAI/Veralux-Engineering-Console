"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StartRunButton({
  taskId,
  compact = false,
}: {
  taskId: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startRun() {
    setLoading(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/tasks/${taskId}/runs`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to start run");
      }
      router.push(`/engineer/runs/${data.run.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={startRun}
        disabled={loading}
        className={`rounded bg-[var(--accent)] text-sm font-medium text-white disabled:opacity-50 ${
          compact ? "px-3 py-1.5" : "px-4 py-2"
        }`}
      >
        {loading ? "Starting…" : "Start run"}
      </button>
      {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
}
