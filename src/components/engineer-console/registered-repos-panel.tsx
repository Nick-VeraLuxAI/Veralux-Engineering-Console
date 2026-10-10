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
import { GithubRepoAccessPanel } from "./github-repo-access-panel";
import { StartRepoForm } from "./start-repo-form";
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
      window.location.assign(`/engineer?focus=repository&repo=${encodeURIComponent(data.repo.id)}`);
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
      <div data-repo-primary-actions="true">
        <p className="mb-3 text-[13px] text-[var(--muted)]">
          Choose one starting point. You can create a clean local repository or map code that
          already exists.
        </p>
        <div className="grid gap-6 lg:grid-cols-2">
          <Surface as="section">
            <StartRepoForm variant="sheet" />
          </Surface>

          <Surface as="form" onSubmit={handleRegister}>
            <h2 className="mb-1 font-semibold">Register repository</h2>
            <p className="mb-3 text-[13px] text-[var(--muted)]">
              Map an existing local checkout without moving its files.
            </p>
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
                className={`${FIELD_CLASS_NAME} font-mono text-[13px]`}
                placeholder={smokeRepoExamplePath || "/path/to/git/repo"}
              />
            </label>
            <p
              className={`mb-3 text-[13px] ${
                pathGuidance.status === "ready"
                  ? "text-emerald-300"
                  : pathGuidance.status === "warning"
                    ? "text-amber-300"
                    : "text-[var(--muted)]"
              }`}
            >
              {pathGuidance.message}
            </p>
            <Button disabled={busy === "register"} type="submit" variant="primary">
              {busy === "register" ? "Registering…" : "Register"}
            </Button>
          </Surface>
        </div>
      </div>

      <GithubRepoAccessPanel />

      <details
        data-repo-setup-details="true"
        className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
      >
        <summary className="cursor-pointer text-sm font-semibold text-white">
          Repository setup details
        </summary>
        <div className="mt-4 space-y-5 border-t border-[var(--border)] pt-4">
          <section>
            <h2 className="font-semibold text-white">Repo setup order</h2>
            <ol className="mt-2 list-inside list-decimal space-y-1.5 text-[13px] text-[var(--muted)]">
              <li>Register a repo inside approved roots.</li>
              <li>Verify the repo path before indexing.</li>
              <li>Run file index before code index.</li>
              <li>Run compatibility analysis after code index.</li>
              <li>Create a task after repo verification.</li>
            </ol>
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-white">Approved repo roots</h2>
              <OperatorHelp term="approved_repo_roots" label="What are approved repo roots?" />
            </div>
            {allowedRoots.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                Approved repo roots are not configured here. Any local path may be registered in
                this environment, but staging and production should set approved roots first.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {allowedRoots.map((root) => (
                  <li
                    key={root}
                    className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2 font-mono text-[13px]"
                  >
                    {root}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[13px] text-[var(--muted)]">
              New and existing local repositories must live inside one of these roots.
            </p>
          </section>
        </div>
      </details>

      <Surface as="section">
        <h2 className="mb-3 font-semibold">Registered ({repos.length})</h2>
        {repos.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No repositories yet.</p>
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
                        <p className="font-mono text-[13px] text-[var(--muted)]">{repo.path}</p>
                      </div>
                      <StatusBadge status={repo.verificationStatus} />
                    </div>
                    <p className="mt-2 text-[13px] text-[var(--muted)]">{repo.verificationMessage}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[13px]">
                      {statusSummary.labels.map((label) => (
                        <Badge key={label} size="sm" variant="muted">
                          {label}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-2 text-[13px] text-[var(--muted)]">
                      Next action: {statusSummary.nextAction}
                    </p>
                    <p className="mt-2 text-[13px]">
                      Scripts:{" "}
                      {repo.packageScripts.length > 0
                        ? repo.packageScripts.map((s) => s.scriptName).join(", ")
                        : "—"}
                    </p>
                    <p className="text-[13px]">
                      Test runner: {repo.testProfile?.runner ?? "unknown"}
                      {repo.testProfile ? ` (${repo.testProfile.confidence})` : ""}
                    </p>
                    {repo.codeIndex && (
                      <p className="mt-1 text-[13px] text-[var(--muted)]">
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
        <div className="mt-4 text-[13px] text-[var(--muted)]">
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
