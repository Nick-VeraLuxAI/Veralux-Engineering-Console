import "server-only";
import { initializeEngineerConsoleDatabase } from "./db/init";

let initialized = false;

export function ensureEngineerConsoleReady(): void {
  if (!initialized) {
    initializeEngineerConsoleDatabase();
    initialized = true;
  }
}
