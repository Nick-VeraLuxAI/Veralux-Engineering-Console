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

export function EngineerSessionBar() {
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
      <p className="text-xs text-amber-300">
        Trusted local dev — authentication disabled
      </p>
    );
  }

  if (!me.operator) return null;

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
