import { CompatibilityPanel } from "@/components/engineer-console/compatibility-panel";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const dynamic = "force-dynamic";

export default function EngineerCompatibilityPage() {
  ensureEngineerConsoleReady();

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Compatibility</h1>
      <p className="mb-6 text-sm text-[var(--muted)]">
        Read-only cross-repo compatibility intelligence: package dependencies, API surfaces, HTTP
        client calls, and shared symbols. Findings feed governance policy results — no auto-fixes
        or file mutations.
      </p>
      <CompatibilityPanel />
    </div>
  );
}
