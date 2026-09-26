"use client";

import React, { useEffect, useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { formatRepoRegistrationErrorMessage } from "@/lib/engineer-console/setup/setup-ux";

type GithubStatus = {
  connected: boolean;
  login: string | null;
  message: string;
};

type GithubRemoteRepo = {
  name: string;
  nameWithOwner: string;
  description: string;
  url: string;
  isPrivate: boolean;
  language: string | null;
};

const FIELD_CLASS_NAME =
  "mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]";

export function GithubRepoAccessPanel() {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [repos, setRepos] = useState<GithubRemoteRepo[]>([]);
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function loadStatus() {
    const response = await engineerConsoleFetch("/api/engineer-console/github/status");
    if (!response.ok) return;
    setStatus((await response.json()) as GithubStatus);
  }

  async function loadRepos(nextQuery = query) {
    const response = await engineerConsoleFetch(
      `/api/engineer-console/github/repos${nextQuery.trim() ? `?q=${encodeURIComponent(nextQuery.trim())}` : ""}`,
    );
    const data = (await response.json()) as { repos?: GithubRemoteRepo[]; error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Could not list GitHub repositories");
    }
    setRepos(data.repos ?? []);
  }

  useEffect(() => {
    void loadStatus()
      .then(() => loadRepos(""))
      .catch((err) => {
        setError(formatRepoRegistrationErrorMessage(err instanceof Error ? err.message : String(err)));
      });
  }, []);

  async function importRepo(input: { url?: string; owner?: string; repo?: string }) {
    setBusy(input.url ?? `${input.owner}/${input.repo}` ?? "import");
    setError(null);
    try {
      const response = await engineerConsoleFetch("/api/engineer-console/github/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await response.json()) as { error?: string; redirect?: string };
      if (!response.ok) throw new Error(data.error ?? "Import failed");
      window.location.assign(data.redirect || "/engineer?focus=repository");
    } catch (err) {
      setError(formatRepoRegistrationErrorMessage(err instanceof Error ? err.message : String(err)));
      setBusy(null);
    }
  }

  return (
    <Surface as="section">
      <div data-github-access="true">
      <h2 className="mb-1 font-semibold">GitHub</h2>
      <p className="mb-3 text-sm text-[var(--muted)]">
        {status?.message ?? "Checking GitHub access…"} Use this to map any codebase onto the console map.
      </p>
      {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}

      <form
        className="mb-4"
        onSubmit={(event) => {
          event.preventDefault();
          void importRepo({ url });
        }}
      >
        <label className="block text-sm">
          GitHub URL or owner/repo
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className={`${FIELD_CLASS_NAME} font-mono text-[13px]`}
            placeholder="https://github.com/owner/repo"
          />
        </label>
        <Button className="mt-3" disabled={busy !== null || !url.trim()} type="submit" variant="primary">
          {busy && url ? "Mapping…" : "Map on console"}
        </Button>
      </form>

      {status?.connected ? (
        <>
          <form
            className="mb-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void loadRepos(query).catch((err) => {
                setError(formatRepoRegistrationErrorMessage(err instanceof Error ? err.message : String(err)));
              });
            }}
          >
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={`${FIELD_CLASS_NAME} mt-0 flex-1`}
              placeholder="Search GitHub"
              aria-label="Search GitHub repositories"
            />
            <Button disabled={busy !== null} type="submit" variant="secondary">
              Search
            </Button>
          </form>
          <ul className="space-y-2" data-github-repo-list="true">
            {repos.map((repo) => (
              <li
                key={repo.nameWithOwner}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{repo.nameWithOwner}</p>
                  <p className="truncate text-[13px] text-[var(--muted)]">
                    {[repo.language, repo.isPrivate ? "private" : "public", repo.description].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => {
                    const [owner, name] = repo.nameWithOwner.split("/");
                    void importRepo({ owner, repo: name, url: repo.url });
                  }}
                >
                  {busy === repo.url || busy === repo.nameWithOwner ? "Mapping…" : "Map"}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      </div>
    </Surface>
  );
}
