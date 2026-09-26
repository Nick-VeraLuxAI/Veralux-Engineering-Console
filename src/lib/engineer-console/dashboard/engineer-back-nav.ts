export type EngineerBackTarget = {
  href: string;
  label: string;
};

export function engineerBackTarget(pathname: string): EngineerBackTarget {
  if (pathname.startsWith("/engineer/compatibility")) {
    return { href: "/engineer/repos", label: "Back to repositories" };
  }
  if (/^\/engineer\/runs\/[^/]+/.test(pathname)) {
    return { href: "/engineer?details=queue", label: "Back to queue" };
  }
  if (/^\/engineer\/tasks\/[^/]+/.test(pathname)) {
    return { href: "/engineer?details=tasks", label: "Back to tasks" };
  }
  if (pathname.startsWith("/engineer/repos")) {
    return { href: "/engineer", label: "Back to map" };
  }
  return { href: "/engineer", label: "Back to map" };
}
