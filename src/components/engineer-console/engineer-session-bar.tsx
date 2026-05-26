"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  engineerConsoleFetch,
  refreshEngineerConsoleCsrf,
} from "@/lib/engineer-console-client/fetch";

interface MeResponse {
  authenticated: boolean;
  authEnabled: boolean;
  trustedLocalDev?: boolean;
  operator?: {
    email: string;
    displayName: string;
    role: string;
  };
}

export function EngineerSessionBar({
  variant = "inline",
}: {
  variant?: "inline" | "menu";
}) {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);

  const load = useCallback(async () => {
    await refreshEngineerConsoleCsrf();
    const res = await fetch("/api/engineer-console/auth/me", { credentials: "same-origin" });
    if (res.ok) {
      setMe(await res.json());
    } else {
      setMe({ authenticated: false, authEnabled: true });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function logout() {
    await engineerConsoleFetch("/api/engineer-console/auth/logout", {
      method: "POST",
    });
    router.push("/engineer/login");
    router.refresh();
  }

  if (!me) return null;

  if (!me.authEnabled && me.trustedLocalDev) {
    return (
      <p className={variant === "menu" ? "text-xs text-amber-300" : "text-xs text-amber-300"}>
        Trusted local dev — authentication disabled
      </p>
    );
  }

  if (!me.operator) return null;

  if (variant === "menu") {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm">
        <p className="font-medium text-white">{me.operator.displayName || me.operator.email}</p>
        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{me.operator.role}</p>
        <button
          type="button"
          onClick={() => void logout()}
          className="mt-3 rounded-full border border-white/10 px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-white/20 hover:text-white"
        >
          Logout
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-[var(--muted)]">
        {me.operator.displayName || me.operator.email} · {me.operator.role}
      </span>
      <button
        type="button"
        onClick={() => void logout()}
        className="rounded border border-[var(--border)] px-2 py-1 text-xs"
      >
        Logout
      </button>
    </div>
  );
}
