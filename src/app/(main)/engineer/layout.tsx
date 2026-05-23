import Link from "next/link";

export default function EngineerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--border)] bg-[var(--card)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-[var(--muted)] hover:text-white">
              Home
            </Link>
            <Link href="/engineer" className="font-semibold">
              Engineer Console
            </Link>
            <Link href="/engineer/repos" className="text-sm text-[var(--muted)] hover:text-white">
              Repositories
            </Link>
            <Link href="/engineer/compatibility" className="text-sm text-[var(--muted)] hover:text-white">
              Compatibility
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
