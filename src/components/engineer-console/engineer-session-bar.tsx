"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  engineerConsoleFetch,
  refreshEngineerConsoleCsrf,
} from "@/lib/engineer-console-client/fetch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";

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
      <Surface className="text-sm" padding="sm" variant="glass">
        <p className="font-medium text-white">{me.operator.displayName || me.operator.email}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge size="sm" variant="muted">
            {me.operator.role}
          </Badge>
        </div>
        <Button
          size="sm"
          variant="subtle"
          onClick={() => void logout()}
          className="mt-3 rounded-full"
        >
          Logout
        </Button>
      </Surface>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-[var(--muted)]">
        {me.operator.displayName || me.operator.email} · {me.operator.role}
      </span>
      <Button size="sm" variant="secondary" onClick={() => void logout()}>
        Logout
      </Button>
    </div>
  );
}
