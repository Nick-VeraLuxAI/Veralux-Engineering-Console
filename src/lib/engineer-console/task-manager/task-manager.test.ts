import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeEngineerConsoleDb,
  resetEngineerConsoleDbForTests,
} from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createTask, getTaskById, listTasks, updateTask } from "./task-manager";

let tmpDb: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-console-test-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
});

describe("task-manager", () => {
  it("creates and updates tasks", () => {
    const task = createTask({
      title: "Test task",
      description: "desc",
      targetRepoPath: "/tmp/repo",
      priority: "high",
    });
    expect(task.id).toBeTruthy();
    expect(task.status).toBe("draft");

    const fetched = getTaskById(task.id);
    expect(fetched?.title).toBe("Test task");

    updateTask(task.id, { status: "queued" });
    expect(getTaskById(task.id)?.status).toBe("queued");
    expect(listTasks().length).toBe(1);
  });
});
