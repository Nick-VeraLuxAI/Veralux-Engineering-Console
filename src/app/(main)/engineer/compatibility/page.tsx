import Link from "next/link";
import { CompatibilityPanel } from "@/components/engineer-console/compatibility-panel";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const dynamic = "force-dynamic";

export default function EngineerCompatibilityPage() {
  ensureEngineerConsoleReady();

  return (
    <div>
      <Link href="/engineer" className="text-sm text-[var(--muted)] hover:text-white">
        ← Engineering tasks
      </Link>
      <h1 className="mt-4 mb-2 text-2xl font-semibold">Compatibility analysis</h1>
      <p className="mb-6 text-sm text-[var(--muted)]">
        Read-only cross-repo compatibility intelligence: package dependencies, API surfaces, HTTP
        client calls, and shared symbols. Findings feed governance policy results — no auto-fixes
        or file mutations.
      </p>
      <CompatibilityPanel />
    </div>
  );
}
