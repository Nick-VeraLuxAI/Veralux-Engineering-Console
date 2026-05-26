import { EngineerRouteShell } from "@/components/engineer-console/engineer-route-shell";
import { requireEngineerPageAuth } from "@/lib/engineer-console/security/require-page-auth";

export default async function EngineerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireEngineerPageAuth();

  return <EngineerRouteShell>{children}</EngineerRouteShell>;
}
