import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">VeraLux Engineering Console</h1>
      <p className="text-center text-[var(--muted)]">
        Internal control plane for AI-assisted engineering tasks.
      </p>
      <Link
        href="/engineer"
        className="rounded-lg bg-[var(--accent)] px-6 py-3 font-medium text-white hover:opacity-90"
      >
        Open Engineer Console
      </Link>
    </main>
  );
}
