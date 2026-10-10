import { listCodeIndexRuns, searchSymbols } from "../repo-intelligence/code-index/code-index-manager";
import { searchCodeChunks } from "../repo-intelligence/code-index/search-symbols";
import { listApiSurfaces, listCrossRepoLinks } from "../repo-intelligence/compatibility/compatibility-manager";
import { listIndexedFiles } from "../repo-intelligence/file-index/list-indexed-files";
import type { RegisteredRepoSummary } from "../repo-intelligence/registered-repos/registered-repo-types";
import type { EngineeringTask } from "../types";
import type { OperatorQueueItem } from "../run-ux/operator-queue";
import {
  getLatestWorkerPlanForRun,
  getWorkerPlanChangedFilesScope,
  listWorkerOperations,
} from "../worker-plan/worker-plan-manager";
import { normalizeRelativePath } from "../worker-plan/path-safety";
import { emptyRepoControlFacts, type RepoControlFacts } from "./repo-control-plane";

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => normalizeRelativePath(path)).filter(Boolean))].slice(0, 80);
}

function safeLoad<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

export function loadRepoControlFacts(repoId: string): Pick<
  RepoControlFacts,
  "files" | "symbols" | "surfaces" | "links" | "chunks" | "codeIndexedAt"
> {
  const files = safeLoad(
    () =>
      listIndexedFiles({ repoId, limit: 2500 }).map((file) => ({
        relativePath: file.relativePath,
        language: file.language,
      })),
    [],
  );
  const symbols = safeLoad(
    () =>
      searchSymbols({ repoId, limit: 400 }).map((symbol) => ({
        name: symbol.name,
        kind: symbol.kind,
        relativePath: symbol.relativePath,
        exported: symbol.exported,
      })),
    [],
  );
  const surfaces = safeLoad(
    () =>
      listApiSurfaces({ repoId, limit: 200 }).map((surface) => ({
        surfaceType: surface.surfaceType,
        method: surface.method,
        routePath: surface.routePath,
        name: surface.name,
        relativePath: surface.relativePath,
      })),
    [],
  );
  const links = safeLoad(
    () =>
      [
        ...listCrossRepoLinks({ sourceRepoId: repoId, limit: 40 }),
        ...listCrossRepoLinks({ targetRepoId: repoId, limit: 40 }),
      ]
        .filter((link, index, all) => all.findIndex((item) => item.id === link.id) === index)
        .slice(0, 80)
        .map((link) => ({
          status: link.status,
          linkType: link.linkType,
          summary: link.summary,
          sourceRelativePath: link.sourceRelativePath,
          targetRelativePath: link.targetRelativePath,
          sourceRepoId: link.sourceRepoId,
          targetRepoId: link.targetRepoId,
        })),
    [],
  );
  const chunks = safeLoad(
    () =>
      searchCodeChunks({ repoId, limit: 200 }).map((chunk) => ({
        relativePath: chunk.relativePath,
        contentPreview: chunk.contentPreview,
      })),
    [],
  );
  const latestCode = safeLoad(() => listCodeIndexRuns(repoId, 1)[0] ?? null, null);

  return {
    files,
    symbols,
    surfaces,
    links,
    chunks,
    codeIndexedAt: latestCode?.completedAt ?? latestCode?.startedAt ?? null,
  };
}

export function loadRepoRunTouch(input: {
  repoId: string;
  tasks: EngineeringTask[];
  queueItems: OperatorQueueItem[];
}): Pick<RepoControlFacts, "changedPaths" | "runId" | "runLabel"> {
  const taskIds = new Set(
    input.tasks.filter((task) => task.registeredRepoId === input.repoId).map((task) => task.id),
  );
  const runItem = input.queueItems.find(
    (item) => item.kind === "run" && item.taskId !== null && taskIds.has(item.taskId) && item.runId,
  );
  if (!runItem?.runId) {
    return { changedPaths: [], runId: null, runLabel: null };
  }

  const executed = getWorkerPlanChangedFilesScope(runItem.runId)?.workerPlanPaths ?? [];
  const plan = getLatestWorkerPlanForRun(runItem.runId);
  const operationPaths = plan ? listWorkerOperations(plan.id).map((operation) => operation.path) : [];
  let allowed: string[] = [];
  if (plan) {
    try {
      const parsed = JSON.parse(plan.planJson) as { allowedFiles?: unknown };
      if (Array.isArray(parsed.allowedFiles)) {
        allowed = parsed.allowedFiles.filter((entry): entry is string => typeof entry === "string");
      }
    } catch {
      allowed = [];
    }
  }

  const changedPaths = uniquePaths(executed.length > 0 ? executed : operationPaths.length > 0 ? operationPaths : allowed);
  return {
    changedPaths,
    runId: runItem.runId,
    runLabel: changedPaths.length > 0 ? `Latest run · ${changedPaths.length} files` : "Latest run",
  };
}

export function assembleRepoControlFacts(input: {
  repo: RegisteredRepoSummary;
  tasks: EngineeringTask[];
  queueItems: OperatorQueueItem[];
}): RepoControlFacts {
  try {
    const loaded = loadRepoControlFacts(input.repo.id);
    const touch = safeLoad(
      () =>
        loadRepoRunTouch({
          repoId: input.repo.id,
          tasks: input.tasks,
          queueItems: input.queueItems,
        }),
      { changedPaths: [], runId: null, runLabel: null },
    );
    return {
      ...emptyRepoControlFacts(),
      ...loaded,
      scripts: (input.repo.packageScripts ?? []).map((script) => script.scriptName),
      testRunner: input.repo.testProfile?.runner ?? null,
      fileIndexedAt: input.repo.indexedAt,
      changedPaths: touch.changedPaths,
      runId: touch.runId,
      runLabel: touch.runLabel,
    };
  } catch {
    return {
      ...emptyRepoControlFacts(),
      scripts: (input.repo.packageScripts ?? []).map((script) => script.scriptName),
      testRunner: input.repo.testProfile?.runner ?? null,
      fileIndexedAt: input.repo.indexedAt,
    };
  }
}

export function assembleRepoControlFactsByRepo(input: {
  repos: RegisteredRepoSummary[];
  tasks: EngineeringTask[];
  queueItems: OperatorQueueItem[];
}): Record<string, RepoControlFacts> {
  return Object.fromEntries(
    input.repos.map((repo) => [
      repo.id,
      assembleRepoControlFacts({ repo, tasks: input.tasks, queueItems: input.queueItems }),
    ]),
  );
}
