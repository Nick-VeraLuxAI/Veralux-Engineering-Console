import Link from "next/link";
import { EngineerSessionBar } from "@/components/engineer-console/engineer-session-bar";
import { requireEngineerPageAuth } from "@/lib/engineer-console/security/require-page-auth";

export default async function EngineerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireEngineerPageAuth();

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--border)] bg-[var(--card)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/" className="text-sm text-[var(--muted)] hover:text-white">
              Home
            </Link>
            <Link href="/engineer" className="font-semibold">
              Engineering Console
            </Link>
            <Link href="/engineer/repos" className="text-sm text-[var(--muted)] hover:text-white">
              Repositories
            </Link>
            <Link
              href="/engineer/compatibility"
              className="text-sm text-[var(--muted)] hover:text-white"
            >
              Compatibility
            </Link>
          </div>
          <EngineerSessionBar />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
