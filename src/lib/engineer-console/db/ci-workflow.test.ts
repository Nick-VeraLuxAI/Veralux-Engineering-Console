import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = path.join(process.cwd(), ".github/workflows/ci.yml");

describe("GitHub Actions CI workflow", () => {
  it("exists and runs verify:ci", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
    expect(content).toContain("npm run verify:ci");
    expect(content).toContain("actions/checkout@v4");
    expect(content).toContain("playwright install chromium");
  });

  it("does not contain deploy, rollback, or cloud provider commands", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8").toLowerCase();
    const forbidden = [
      "npm run deploy",
      "rollback",
      "aws s3",
      "terraform apply",
      "kubectl apply",
      "vercel deploy",
      "render deploy",
      "heroku deploy",
      "github.com/actions/deploy",
    ];
    for (const term of forbidden) {
      expect(content).not.toContain(term);
    }
  });

  it("uses test E2E env without production secrets", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
    expect(content).toContain("ENGINEER_CONSOLE_AUTH_ENABLED: \"false\"");
    expect(content).not.toContain("ENGINEER_CONSOLE_SESSION_SECRET");
    expect(content).not.toContain("KIMI_API_KEY");
  });

  it("uploads artifacts only on failure", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
    expect(content).toContain("if: failure()");
    expect(content).toContain("playwright-report");
  });
});
