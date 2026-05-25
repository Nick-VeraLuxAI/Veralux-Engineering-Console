import { describe, expect, it } from "vitest";
import { resolveQualityGateCommands } from "./quality-gate-runner";
import fs from "fs";
import os from "os";
import path from "path";

describe("resolveQualityGateCommands", () => {
  it("includes scripts present in package.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-repo-"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        scripts: {
          test: "vitest run",
          build: "next build",
          lint: "eslint .",
        },
      }),
    );
    const commands = resolveQualityGateCommands(dir);
    expect(commands).toContain("npm test");
    expect(commands).toContain("npm run build");
    expect(commands).toContain("npm run lint");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
