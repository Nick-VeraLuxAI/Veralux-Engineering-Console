import { chromium } from "@playwright/test";
import fs from "fs";

const port = process.env.E2E_PORT || "3030";
const base = `http://127.0.0.1:${port}`;
const runs = {
  diagnosing_or_exhausted: process.env.AE_V1_EXHAUSTED_RUN_ID || "3df5f413-1c25-4709-8ab9-0d46fbc00017",
  governance: process.env.AE_V1_GOVERNANCE_RUN_ID || "9f690ada-dfcc-4e34-929a-cd2061e16dd6",
  delivery: process.env.AE_V1_DELIVERY_RUN_ID || "75367bc0-a3e8-49cd-aeec-4eeff07bf9d4",
  waiting: process.env.AE_V1_WAITING_RUN_ID || "409b1c97-ef24-4b28-bd4f-be8c262651ef",
};
const outDir = "test-results/ae-v1-qualification-20260819";
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const results = [];
for (const [label, runId] of Object.entries(runs)) {
  await page.goto(`${base}/engineer/runs/${runId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#autonomous-engineer-panel", { timeout: 30000 });
  const panelText = await page.locator("#autonomous-engineer-panel").innerText();
  const shot = `${outDir}/ux-${label}.png`;
  await page.screenshot({ path: shot, fullPage: true });
  results.push({
    label,
    runId,
    hasSevenQuestions: ["What is it doing?", "Does it need me?", "Did it finish?", "QC vs baseline?", "What changed?", "Risks?", "What decision?"].every((q) => panelText.includes(q)),
    snippet: panelText.slice(0, 500),
    shot,
  });
}
fs.writeFileSync(`${outDir}/failure-ux.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map((r) => ({ label: r.label, runId: r.runId, hasSevenQuestions: r.hasSevenQuestions })), null, 2));
await browser.close();
