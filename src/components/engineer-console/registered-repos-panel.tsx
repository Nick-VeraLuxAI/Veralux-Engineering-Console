"use client";

import React from "react";
import Link from "next/link";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useState } from "react";
import {
  deriveRepoPathGuidance,
  deriveRepoStatusSummary,
  formatRepoRegistrationErrorMessage,
} from "@/lib/engineer-console/setup/setup-ux";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { OperatorHelp } from "./operator-help";
import { StatusBadge } from "./status-badge";
import { RepoFileIndexPanel } from "./repo-file-index-panel";
import { RepoCodeIndexPanel } from "./repo-code-index-panel";

const FIELD_CLASS_NAME =
  "mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]";

export interface PublicRegisteredRepo {
  id: string;
  name: string;
  path: string;
  description: string;
  language: string;
  verificationStatus: string;
  verificationMessage: string;
  verifiedAt?: string | null;
  fileCount: number;
  indexedAt: string | null;
  codeIndex?: {
    status: string;
    symbolCount: number;
    chunkCount: number;
    completedAt: string | null;
  } | null;
  packageScripts: Array<{ scriptName: string; sourceFile: string }>;
  testProfile: { runner: string; confidence: string } | null;
}

export function RegisteredReposPanel({
  initialRepos,
  allowedRoots,
  compatibilityAvailable,
  smokeRepoExamplePath,
}: {
  initialRepos: PublicRegisteredRepo[];
  allowedRoots: string[];
  compatibilityAvailable: boolean;
  smokeRepoExamplePath: string;
}) {
  const [repos, setRepos] = useState(initialRepos);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pathGuidance = deriveRepoPathGuidance({ inputPath: path, allowedRoots });

  async function refreshList() {
    const res = await engineerConsoleFetch("/api/engineer-console/repos");
    if (res.ok) {
      const data = (await res.json()) as { repos: PublicRegisteredRepo[] };
      setRepos(data.repos);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setBusy("register");
    setError(null);
    try {
      const res = await engineerConsoleFetch("/api/engineer-console/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || undefined, path }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Registration failed");
      setName("");
      setPath("");
      await refreshList();
    } catch (err) {
      setError(formatRepoRegistrationErrorMessage(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(null);
    }
  }

  async function runAction(repoId: string, action: "verify" | "detect") {
    setBusy(`${action}-${repoId}`);
    setError(null);
    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/repos/${repoId}/${action}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `${action} failed`);
      await refreshList();
    } catch (err) {
      setError(formatRepoRegistrationErrorMessage(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <Surface as="section">
        <h2 className="mb-3 font-semibold">Repo setup order</h2>
        <ol className="list-inside list-decimal space-y-1 text-sm text-[var(--muted)]">
          <li>Register a repo inside approved roots.</li>
          <li>Verify the repo path before indexing.</li>
          <li>Run file index before code index.</li>
          <li>Run compatibility analysis after code index.</li>
          <li>Create a task after repo verification.</li>
        </ol>
      </Surface>

      <Surface as="section">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Approved repo roots</h2>
          <OperatorHelp term="approved_repo_roots" label="What are approved repo roots?" />
        </div>
        {allowedRoots.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            Approved repo roots are not configured here. Any local path may be registered in this
            environment, but staging and production should set approved roots first.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {allowedRoots.map((root) => (
              <li
                key={root}
                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2 font-mono text-xs"
              >
                {root}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-[var(--muted)]">
          Path must be inside approved repo roots.
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Example staging repo path: <code>{smokeRepoExamplePath}</code>
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Setup references: <code>docs/env-reference.md</code> and <code>docs/operator-runbook.md</code>
        </p>
      </Surface>

      <Surface
        as="form"
        onSubmit={handleRegister}
        className=""
      >
        <h2 className="mb-3 font-semibold">Register repository</h2>
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <label className="mb-3 block text-sm">
          Name (optional)
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={FIELD_CLASS_NAME}
            placeholder="my-service"
          />
        </label>
        <label className="mb-3 block text-sm">
          Absolute path
          <input
            required
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className={`${FIELD_CLASS_NAME} font-mono text-xs`}
            placeholder="/path/to/git/repo"
          />
        </label>
        <p
          className={`mb-3 text-xs ${
            pathGuidance.status === "ready"
              ? "text-emerald-300"
              : pathGuidance.status === "warning"
                ? "text-amber-300"
                : "text-[var(--muted)]"
          }`}
        >
          {pathGuidance.message}
        </p>
        <Button
          disabled={busy === "register"}
          type="submit"
          variant="primary"
        >
          {busy === "register" ? "Registering…" : "Register"}
        </Button>
      </Surface>

      <Surface as="section">
        <h2 className="mb-3 font-semibold">Registered ({repos.length})</h2>
        {repos.length === 0 ? (
          <Surface className="text-sm text-[var(--muted)]" padding="md" variant="inset">
            <p className="font-medium text-white">Register a repo inside approved roots.</p>
            <p className="mt-2">
              What is missing: no repos are registered yet. Why it matters: repo verification,
              indexing, compatibility analysis, and the safest task targeting all begin here. What
              next: register a repo, verify it, then index files.
            </p>
          </Surface>
        ) : (
          <ul className="space-y-4">
            {repos.map((repo) => {
              const codeIndexReady =
                repo.codeIndex?.status === "completed" &&
                ((repo.codeIndex?.symbolCount ?? 0) > 0 || (repo.codeIndex?.chunkCount ?? 0) > 0);
              const statusSummary = deriveRepoStatusSummary({
                verificationStatus: repo.verificationStatus,
                fileCount: repo.fileCount,
                codeIndexReady,
                compatibilityAvailable,
              });

              return (
                <li key={repo.id}>
                  <Surface padding="sm" variant="inset">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{repo.name}</p>
                        <p className="font-mono text-xs text-[var(--muted)]">{repo.path}</p>
                      </div>
                      <StatusBadge status={repo.verificationStatus} />
                    </div>
                    <p className="mt-2 text-xs text-[var(--muted)]">{repo.verificationMessage}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {statusSummary.labels.map((label) => (
                        <Badge key={label} size="sm" variant="muted">
                          {label}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Next action: {statusSummary.nextAction}
                    </p>
                    <p className="mt-2 text-xs">
                      Scripts:{" "}
                      {repo.packageScripts.length > 0
                        ? repo.packageScripts.map((s) => s.scriptName).join(", ")
                        : "—"}
                    </p>
                    <p className="text-xs">
                      Test runner: {repo.testProfile?.runner ?? "unknown"}
                      {repo.testProfile ? ` (${repo.testProfile.confidence})` : ""}
                    </p>
                    {repo.codeIndex && (
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Code index: {repo.codeIndex.status} · {repo.codeIndex.symbolCount} symbols ·{" "}
                        {repo.codeIndex.chunkCount} chunks
                        {repo.codeIndex.completedAt
                          ? ` · ${new Date(repo.codeIndex.completedAt).toLocaleString()}`
                          : ""}
                      </p>
                    )}
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() => runAction(repo.id, "verify")}
                      >
                        Verify
                      </Button>
                      <Button
                        size="sm"
                        variant="subtle"
                        disabled={busy !== null}
                        onClick={() => runAction(repo.id, "detect")}
                      >
                        Detect scripts/profile
                      </Button>
                    </div>
                    <RepoFileIndexPanel
                      repoId={repo.id}
                      verificationStatus={repo.verificationStatus}
                      initialFileCount={repo.fileCount}
                      initialIndexedAt={repo.indexedAt}
                    />
                    <RepoCodeIndexPanel
                      repoId={repo.id}
                      verificationStatus={repo.verificationStatus}
                      fileCount={repo.fileCount}
                    />
                  </Surface>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 text-xs text-[var(--muted)]">
          Next step after repo setup:{" "}
          <Link href="/engineer/compatibility" className="underline underline-offset-2">
            run compatibility analysis
          </Link>{" "}
          or{" "}
          <Link href="/engineer" className="underline underline-offset-2">
            create a task
          </Link>
          .
        </div>
      </Surface>
    </div>
  );
}
