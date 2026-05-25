#!/usr/bin/env npx tsx
import path from "path";
import { initializeEngineerConsoleDatabase, getEngineerConsoleDbPath } from "../../src/lib/engineer-console";

process.env.ENGINEER_CONSOLE_DB_PATH =
  process.env.ENGINEER_CONSOLE_DB_PATH ??
  path.join(process.cwd(), "data", "engineer-console.db");

initializeEngineerConsoleDatabase();
console.log(`Engineer Console database initialized at ${getEngineerConsoleDbPath()}`);
