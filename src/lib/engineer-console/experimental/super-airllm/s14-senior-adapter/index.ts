/** Public S14 gated senior adapter entrypoints. */

export * from "./types";
export * from "./s13-client";
export * from "./approval-gate";
export * from "./route-gate";
export * from "./correlation-store";
export * from "./state-map";
export * from "./fallback-policy";
export * from "./senior-runner";
export * from "./registry-view";

import { S13LocalClient } from "./s13-client";
import { SeniorCorrelationStore } from "./correlation-store";
import { SeniorRequestRunner, type SeniorRunnerOptions } from "./senior-runner";
import { S14_DEFAULT_S13_BASE_URL } from "./types";

export type CreateSeniorAdapterInput = {
  stateRoot: string;
  s13BaseUrl?: string;
  expectedSourceCommit?: string | null;
  expectedManifestSha?: string | null;
  fetchImpl?: typeof fetch;
  routeEnabled?: boolean;
  runtimeAvailable?: boolean;
  deadlines?: SeniorRunnerOptions["deadlines"];
  sleep?: SeniorRunnerOptions["sleep"];
};

export function createSeniorAdapter(input: CreateSeniorAdapterInput): {
  client: S13LocalClient;
  store: SeniorCorrelationStore;
  runner: SeniorRequestRunner;
} {
  const client = new S13LocalClient({
    baseUrl: input.s13BaseUrl ?? S14_DEFAULT_S13_BASE_URL,
    fetchImpl: input.fetchImpl,
  });
  const store = new SeniorCorrelationStore(input.stateRoot);
  const runner = new SeniorRequestRunner({
    client,
    store,
    expectedSourceCommit: input.expectedSourceCommit,
    expectedManifestSha: input.expectedManifestSha,
    routeEnabled: input.routeEnabled,
    runtimeAvailable: input.runtimeAvailable,
    deadlines: input.deadlines,
    sleep: input.sleep,
  });
  return { client, store, runner };
}

/** Ordinary/default requests must never invent a senior correlation. */
export function assertOrdinaryRequestDoesNotInvokeSenior(input: {
  seniorRequested?: boolean;
  s13Submitted: boolean;
}): void {
  if (!input.seniorRequested && input.s13Submitted) {
    throw new Error("ordinary_request_must_not_invoke_s13");
  }
}
