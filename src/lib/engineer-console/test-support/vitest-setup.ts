import { afterEach, beforeEach } from "vitest";
import {
  restoreEngineerConsoleTestEnv,
  resetEngineerConsoleTestEnvDefaults,
  snapshotEngineerConsoleTestEnv,
  type EngineerConsoleTestEnvSnapshot,
} from "./engineer-console-test-env";

let envSnapshot: EngineerConsoleTestEnvSnapshot = {};

beforeEach(() => {
  envSnapshot = snapshotEngineerConsoleTestEnv();
  resetEngineerConsoleTestEnvDefaults();
});

afterEach(() => {
  restoreEngineerConsoleTestEnv(envSnapshot);
});
