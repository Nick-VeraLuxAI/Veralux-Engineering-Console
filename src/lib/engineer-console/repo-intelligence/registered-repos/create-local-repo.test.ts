import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeEngineerConsoleDb,
  resetEngineerConsoleDbForTests,
} from "../../db/client";
import { initializeEngineerConsoleDatabase } from "../../db/init";
import { createLocalRegisteredRepo, validateCreateDestination } from "./create-local-repo";

let tmpDb: string;
let tmpRoot: string;
let allowRoot: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-create-repo-${Date.now()}.db`);
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-create-root-"));
  allowRoot = path.join(tmpRoot, "allowed");
  fs.mkdirSync(allowRoot, { recursive: true });
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_REPO_ROOTS = allowRoot;
  delete process.env.ENGINEER_CONSOLE_GITHUB_CLONE_ROOT;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_REPO_ROOTS;
});

describe("create local registered repo", () => {
  it("inits a git repo with a README and registers it", async () => {
    const repo = await createLocalRegisteredRepo({
      name: "Orchard",
      description: "Field operations for crews",
    });
    const dest = validateCreateDestination("Orchard");
    expect(dest.startsWith(`${allowRoot}${path.sep}`)).toBe(true);
    expect(repo.name).toBe("Orchard");
    expect(repo.verificationStatus).toBe("ok");
    expect(fs.existsSync(path.join(dest, ".git"))).toBe(true);
    expect(fs.readFileSync(path.join(dest, "README.md"), "utf8")).toContain("Field operations for crews");
    expect(fs.readFileSync(path.join(dest, "README.md"), "utf8")).not.toMatch(/\/home\/|localhost/);
  });

  it("rejects a name that would escape the approved root", () => {
    expect(() => validateCreateDestination("../outside")).toThrow(/letter/i);
    expect(() => validateCreateDestination("node_modules")).toThrow(/letter|approved|name/i);
  });

  it("refuses a non-empty folder that is not git", async () => {
    const dest = path.join(allowRoot, "Occupied");
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, "notes.txt"), "no");
    await expect(createLocalRegisteredRepo({ name: "Occupied" })).rejects.toThrow(/already exists/i);
  });
});
