"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useState } from "react";
import { StatusBadge } from "./status-badge";
import { RepoFileIndexPanel } from "./repo-file-index-panel";
import { RepoCodeIndexPanel } from "./repo-code-index-panel";

export interface PublicRegisteredRepo {
  id: string;
  name: string;
  path: string;
  description: string;
  language: string;
  verificationStatus: string;
  verificationMessage: string;
  fileCount: number;
  indexedAt: string | null;
  packageScripts: Array<{ scriptName: string; sourceFile: string }>;
  testProfile: { runner: string; confidence: string } | null;
}

export function RegisteredReposPanel({
  initialRepos,
}: {
  initialRepos: PublicRegisteredRepo[];
}) {
  const [repos, setRepos] = useState(initialRepos);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleRegister}
        className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
        <h2 className="mb-3 font-semibold">Register repository</h2>
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <label className="mb-3 block text-sm">
          Name (optional)
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2"
            placeholder="my-service"
          />
        </label>
        <label className="mb-3 block text-sm">
          Absolute path
          <input
            required
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs"
            placeholder="/path/to/git/repo"
          />
        </label>
        <button
          type="submit"
          disabled={busy === "register"}
          className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === "register" ? "Registering…" : "Register"}
        </button>
      </form>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-3 font-semibold">Registered ({repos.length})</h2>
        {repos.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No repositories registered yet.</p>
        ) : (
          <ul className="space-y-4">
            {repos.map((repo) => (
              <li
                key={repo.id}
                className="rounded border border-[var(--border)] bg-[var(--background)] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{repo.name}</p>
                    <p className="font-mono text-xs text-[var(--muted)]">{repo.path}</p>
                  </div>
                  <StatusBadge status={repo.verificationStatus} />
                </div>
                <p className="mt-2 text-xs text-[var(--muted)]">{repo.verificationMessage}</p>
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
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => runAction(repo.id, "verify")}
                    className="rounded border border-[var(--border)] px-3 py-1 text-xs"
                  >
                    Verify
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => runAction(repo.id, "detect")}
                    className="rounded border border-[var(--border)] px-3 py-1 text-xs"
                  >
                    Detect scripts/profile
                  </button>
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
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
