"use client";

import React from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { Surface } from "@/components/ui/surface";

import { useCallback, useEffect, useState } from "react";
import { RUN_NAV_TARGET_IDS } from "@/lib/engineer-console/run-ux/run-navigation";
import { OperatorHelp } from "./operator-help";
import { StatusBadge } from "./status-badge";

interface ReplayCheck {
  code: string;
  status: string;
  message: string;
}

interface ReplayVerification {
  ok: boolean;
  runId: string;
  checkedAt: string;
  status: string;
  checks: ReplayCheck[];
  summary: { passed: number; warnings: number; failed: number };
}

export function ReplayVerificationPanel({ runId }: { runId: string }) {
  const [verification, setVerification] = useState<ReplayVerification | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [packageJson, setPackageJson] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/replay-verification`);
    if (res.status === 404) {
      setVerification(null);
      return;
    }
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { verification: ReplayVerification; source?: string };
    setVerification(data.verification);
    setSource(data.source ?? null);
    setError(null);
  }, [runId]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/replay-verification`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      setVerification(data.verification as ReplayVerification);
      setSource(data.source ?? "stored");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadPackage() {
    setBusy(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/replay-package`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load replay package");
      setPackageJson(JSON.stringify(data.replayPackage, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Surface as="section">
      <SectionHeader
        title="Replay verification"
        description="Keep replay status and stored package details visible before approval or release work continues."
        meta={
          <>
            <OperatorHelp term="replay_verification" label="What is replay verification?" />
            <a
              href={`#${RUN_NAV_TARGET_IDS.replayTechnicalDetails}`}
              className="text-xs text-[var(--accent)] underline underline-offset-2"
            >
              View technical details
            </a>
          </>
        }
        actions={
          <>
            <Button disabled={busy} onClick={() => void verify()} size="sm" variant="secondary">
              {busy ? "Verifying…" : "Check replay"}
            </Button>
            <Button disabled={busy} onClick={() => void loadPackage()} size="sm" variant="secondary">
              View replay package
            </Button>
          </>
        }
      />

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      {loading && <p className="mt-4 text-sm text-[var(--muted)]">Loading verification…</p>}

      {!loading && !verification && !error && (
        <div className="mt-4">
          <EmptyState
            compact
            title="No replay check yet"
            description="Run replay verification before approval or release work continues."
          />
        </div>
      )}

      {verification && (
        <>
          <Surface className="mt-4 text-sm" padding="sm" variant="inset">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={verification.status} />
              <span className="text-[var(--muted)]">
                {new Date(verification.checkedAt).toLocaleString()}
                {source ? ` · ${source}` : ""}
              </span>
              <span>
                passed {verification.summary.passed} · warnings {verification.summary.warnings} · failed{" "}
                {verification.summary.failed}
              </span>
            </div>
          </Surface>
          {verification.status === "warning" && (
            <Surface className="mt-4 text-sm text-amber-100" padding="sm" variant="warning">
              <p>Replay passed, but warnings should be reviewed before continuing.</p>
            </Surface>
          )}
          <ul className="mt-4 max-h-48 space-y-2 overflow-auto text-xs">
            {verification.checks.map((check, index) => (
              <Surface
                key={`${check.code}-${index}`}
                as="li"
                padding="sm"
                variant="inset"
              >
                <div className="flex items-center justify-between gap-2">
                  <code>{check.code}</code>
                  <StatusBadge status={check.status} />
                </div>
                <p className="mt-2">{check.message}</p>
              </Surface>
            ))}
          </ul>
        </>
      )}

      <details id={RUN_NAV_TARGET_IDS.replayTechnicalDetails} className="mt-4 text-xs text-[var(--muted)]">
        <summary className="cursor-pointer">Technical replay details</summary>
        <Surface className="mt-3" padding="sm" variant="inset">
          <div className="space-y-2">
            <p>
              raw replay status: <strong>{verification?.status ?? "not recorded"}</strong>
            </p>
            <p>source: {source ?? "not recorded"}</p>
            <p>
              passed {verification?.summary.passed ?? 0} · warnings {verification?.summary.warnings ?? 0} · failed{" "}
              {verification?.summary.failed ?? 0}
            </p>
            <p>Use the replay package button above to load the stored package JSON for deeper inspection.</p>
          </div>
        </Surface>
      </details>

      {packageJson && (
        <pre className="mt-4 max-h-64 overflow-auto rounded bg-[var(--background)] p-3 text-xs">
          {packageJson}
        </pre>
      )}
    </Surface>
  );
}
