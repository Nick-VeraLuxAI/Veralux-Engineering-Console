import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalActions } from "@/components/engineer-console/approval-actions";
import { EngineerRouteShell } from "@/components/engineer-console/engineer-route-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";

const navigationState = vi.hoisted(() => ({
  pathname: "/engineer/repos",
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({
    push: navigationState.push,
    refresh: navigationState.refresh,
  }),
}));

vi.mock("next/link", () => ({
  default: ({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) =>
    React.createElement("a", { href, className }, children),
}));

vi.mock("@/components/engineer-console/engineer-session-bar", () => ({
  EngineerSessionBar: () => React.createElement("div", { "data-session-bar": "true" }, "Session"),
}));

vi.mock("@/lib/engineer-console-client/fetch", () => ({
  engineerConsoleFetch: vi.fn(),
}));

afterEach(() => {
  navigationState.pathname = "/engineer/repos";
  navigationState.push.mockReset();
  navigationState.refresh.mockReset();
});

describe("DS-1 shared UI primitives", () => {
  it("button primitive renders each supported variant", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Button, { variant: "primary" }, "Primary"),
        React.createElement(Button, { variant: "secondary" }, "Secondary"),
        React.createElement(Button, { variant: "ghost" }, "Ghost"),
        React.createElement(Button, { variant: "danger" }, "Danger"),
        React.createElement(Button, { variant: "subtle" }, "Subtle"),
      ),
    );

    expect(html).toContain('data-ui-button="primary"');
    expect(html).toContain('data-ui-button="secondary"');
    expect(html).toContain('data-ui-button="ghost"');
    expect(html).toContain('data-ui-button="danger"');
    expect(html).toContain('data-ui-button="subtle"');
  });

  it("surface primitive renders each supported variant", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Surface, { variant: "default" }, "Default"),
        React.createElement(Surface, { variant: "elevated" }, "Elevated"),
        React.createElement(Surface, { variant: "glass" }, "Glass"),
        React.createElement(Surface, { variant: "inset" }, "Inset"),
        React.createElement(Surface, { variant: "warning" }, "Warning"),
        React.createElement(Surface, { variant: "danger" }, "Danger"),
      ),
    );

    expect(html).toContain('data-ui-surface="default"');
    expect(html).toContain('data-ui-surface="elevated"');
    expect(html).toContain('data-ui-surface="glass"');
    expect(html).toContain('data-ui-surface="inset"');
    expect(html).toContain('data-ui-surface="warning"');
    expect(html).toContain('data-ui-surface="danger"');
  });

  it("badge primitive renders each supported variant", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Badge, { variant: "ready" }, "Ready"),
        React.createElement(Badge, { variant: "warning" }, "Warning"),
        React.createElement(Badge, { variant: "blocked" }, "Blocked"),
        React.createElement(Badge, { variant: "info" }, "Info"),
        React.createElement(Badge, { variant: "muted" }, "Muted"),
        React.createElement(Badge, { variant: "active" }, "Active"),
        React.createElement(Badge, { variant: "completed" }, "Completed"),
      ),
    );

    expect(html).toContain('data-ui-badge="ready"');
    expect(html).toContain('data-ui-badge="warning"');
    expect(html).toContain('data-ui-badge="blocked"');
    expect(html).toContain('data-ui-badge="info"');
    expect(html).toContain('data-ui-badge="muted"');
    expect(html).toContain('data-ui-badge="active"');
    expect(html).toContain('data-ui-badge="completed"');
  });

  it("approval actions still render controls without dark-theme text-black drift", () => {
    const html = renderToStaticMarkup(
      React.createElement(ApprovalActions, {
        runId: "run-1",
        canApprove: true,
        showApprove: true,
        showRequestFix: true,
        showStop: true,
      }),
    );

    expect(html).toContain("Approve run");
    expect(html).toContain("Request Fix");
    expect(html).toContain("Stop Run");
    expect(html).not.toContain("text-black");
  });

  it("engineer route shell still renders route content", () => {
    navigationState.pathname = "/engineer/repos";
    const html = renderToStaticMarkup(
      React.createElement(
        EngineerRouteShell,
        null,
        React.createElement("div", null, "Route content"),
      ),
    );

    expect(html).toContain('data-engineer-route-shell="default"');
    expect(html).toContain("Engineering Console");
    expect(html).toContain("Route content");
  });
});
