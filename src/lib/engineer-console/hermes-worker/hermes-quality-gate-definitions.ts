import { HERMES_ALLOWED_QUALITY_GATE_COMMANDS } from "./hermes-policy";

export const HERMES_QUALITY_GATE_IDS = ["test", "build", "lint", "typecheck"] as const;

export type HermesQualityGateId = (typeof HERMES_QUALITY_GATE_IDS)[number];

export interface HermesQualityGateExecSpec {
  gateId: HermesQualityGateId;
  command: string;
  executable: string;
  args: string[];
}

const GATE_SPECS: Record<HermesQualityGateId, Omit<HermesQualityGateExecSpec, "gateId">> = {
  test: { command: "npm test", executable: "npm", args: ["test"] },
  build: { command: "npm run build", executable: "npm", args: ["run", "build"] },
  lint: { command: "npm run lint", executable: "npm", args: ["run", "lint"] },
  typecheck: { command: "npm run typecheck", executable: "npm", args: ["run", "typecheck"] },
};

export function isHermesQualityGateId(value: string): value is HermesQualityGateId {
  return (HERMES_QUALITY_GATE_IDS as readonly string[]).includes(value);
}

export function commandForHermesQualityGateId(gateId: HermesQualityGateId): string {
  return GATE_SPECS[gateId].command;
}

export function execSpecForHermesQualityGateId(gateId: HermesQualityGateId): HermesQualityGateExecSpec {
  return { gateId, ...GATE_SPECS[gateId] };
}

export function hermesQualityGateIdsFromAllowedCommands(commands: string[]): HermesQualityGateId[] {
  const allowed = new Set(commands.map((c) => c.trim()));
  return HERMES_QUALITY_GATE_IDS.filter((gateId) => allowed.has(commandForHermesQualityGateId(gateId)));
}

export function assertHermesQualityGateCommandsAllowlisted(): void {
  for (const gateId of HERMES_QUALITY_GATE_IDS) {
    const command = commandForHermesQualityGateId(gateId);
    if (!(HERMES_ALLOWED_QUALITY_GATE_COMMANDS as readonly string[]).includes(command)) {
      throw new Error(`Hermes gate command not globally allowlisted: ${command}`);
    }
  }
}
