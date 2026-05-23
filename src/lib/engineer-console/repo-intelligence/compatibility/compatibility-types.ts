export const SURFACE_TYPES = [
  "rest_route",
  "exported_symbol",
  "package_dependency",
  "http_client",
  "event",
  "unknown",
] as const;

export type SurfaceType = (typeof SURFACE_TYPES)[number];

export const LINK_TYPES = [
  "package_dependency",
  "rest_client_to_route",
  "import_export",
  "shared_symbol",
  "event_reference",
] as const;

export type LinkType = (typeof LINK_TYPES)[number];

export const LINK_STATUSES = ["compatible", "warning", "breaking", "unknown"] as const;

export type LinkStatus = (typeof LINK_STATUSES)[number];

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export interface DetectedApiSurface {
  repoId: string;
  relativePath: string;
  surfaceType: SurfaceType;
  method: string | null;
  routePath: string | null;
  name: string | null;
  language: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  sourceHash: string;
  confidence: ConfidenceLevel;
}

export interface DetectedCrossRepoLink {
  sourceRepoId: string;
  targetRepoId: string;
  sourceRelativePath: string | null;
  targetRelativePath: string | null;
  linkType: LinkType;
  status: LinkStatus;
  confidence: ConfidenceLevel;
  summary: string;
  evidence: Record<string, unknown>;
}

export interface ApiSurfaceRecord extends DetectedApiSurface {
  id: string;
  detectedAt: string;
}

export interface CrossRepoLinkRecord extends DetectedCrossRepoLink {
  id: string;
  detectedAt: string;
}

export interface CompatibilityAnalysisRunRecord {
  id: string;
  status: "running" | "completed" | "failed";
  repoCount: number;
  surfaceCount: number;
  linkCount: number;
  warningCount: number;
  breakingCount: number;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface CompatibilityAnalysisSummary {
  run: CompatibilityAnalysisRunRecord;
  surfaceCount: number;
  linkCount: number;
  warningCount: number;
  breakingCount: number;
}

export interface CompatibilityRepoContext {
  repoId: string;
  repoName: string;
  packageName: string | null;
  repoPath: string;
  verificationStatus: string;
}

export interface ScanContentSlice {
  repoId: string;
  relativePath: string;
  language: string | null;
  content: string;
  startLine: number;
  endLine: number;
}

export class CompatibilityAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompatibilityAnalysisError";
  }
}
