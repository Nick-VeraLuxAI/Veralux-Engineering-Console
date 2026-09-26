import { expect, test } from "@playwright/test";
import {
  createRunWithGovernanceFixture,
  createTaskAndRun,
  waitForRunDetailApiReady,
} from "./fixtures";
import {
  gotoRunDetailResilient,
  RUN_DETAIL_GROUP_HEADINGS,
} from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("Engineering Console trusted local smoke", () => {
  async function waitForCanvasReady(page: import("@playwright/test").Page) {
    await page.locator('[data-engineering-canvas-ready="true"]').waitFor({
      state: "visible",
      timeout: 45_000,
    });
  }

  async function openIssueCenter(page: import("@playwright/test").Page) {
    const launcher = page.locator('[data-canvas-open-issues="true"]').first();
    await launcher.evaluate((node) => {
      (node as HTMLButtonElement).click();
    });
    const issueCenter = page.locator('[data-overlay-window="issue-center"]');
    await expect(issueCenter).toBeVisible();
    return issueCenter;
  }

  test("dashboard loads as a canvas-first architecture view", async ({ page }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);
    const viewport = page.viewportSize();
    await expect(page).toHaveURL(/\/engineer\/?$/);
    await expect(page.locator('[data-engineering-immersive-shell="true"]')).toBeVisible();
    await expect(page.locator('[data-engineer-route-shell="immersive"]')).toBeVisible();
    await expect(page.locator('[data-canvas-menu-button="true"]')).toBeVisible();
    await expect(page.getByRole("link", { name: "Home", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Compatibility", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Engineering Console" })).toBeVisible();
    await expect(page.locator('[data-canvas-top-context="true"]')).toContainText("Map");
    await expect(page.locator('[data-workflow-canvas="true"]')).toBeVisible();
    await expect(page.locator('[data-canvas-surface="workflow"]')).toBeVisible();
    await expect(page.locator('[data-canvas-surface-toggle="true"]')).toBeVisible();
    await expect(page.locator('[data-canvas-bottom-dock="true"]')).toBeVisible();
    await expect(page.locator('[data-canvas-toolbar="true"]')).toBeVisible();
    await expect(page.locator('[data-canvas-toolbar="true"]')).toHaveAttribute("data-canvas-toolbar-collapsed", "true");
    await expect(page.locator('[data-canvas-workspace="split"]')).toBeVisible();
    await expect(page.locator('[data-canvas-map-chat="true"]')).toBeVisible();
    await expect(page.locator('[data-map-chat-layout="docked"]')).toBeVisible();
    await expect(page.locator('[data-canvas-chat-slot="true"]')).toBeVisible();
    await expect(page.locator('[data-canvas-stage="true"]')).toBeVisible();
    await expect(page.locator('[data-canvas-workbench="true"]')).toBeAttached();
    await expect(page.locator('[data-canvas-stage-tabs="true"]')).toBeVisible();
    await expect(page.getByText(/I'm Vera\. I can help with whatever you're trying to build/i)).toBeVisible();
    await expect(page.locator('[data-map-chat-threads="true"]')).toBeVisible();
    await expect(page.getByRole("tab", { name: "Agent" })).toBeVisible();
    await expect(page.getByLabel("Model")).toHaveValue("nano30b");
    await expect(page.getByRole("heading", { name: "Setup readiness" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Operator Queue" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Run staging smoke workflow" })).toHaveCount(0);
    await expect(page.getByText(/Focus mode|Enter focus/i)).toHaveCount(0);
    await expect(page.locator('[data-detail-drawer="true"]')).toHaveCount(0);
    await expect(page.locator('[data-floating-issue-card="true"]')).toHaveCount(0);
    await expect(page.locator('[data-workflow-node="run"]').first()).toBeVisible();
    await expect(page.locator('[data-canvas-world="true"] svg').first()).toBeVisible();
    await expect(page.locator('[data-canvas-edge="true"]')).toHaveCount(7);
    await expect(page).not.toHaveURL(/\/engineer\/login/);

    if (viewport) {
      const rootBox = await page.locator('[data-engineering-immersive-root="true"]').boundingBox();
      const canvasBox = await page.locator('[data-workflow-canvas="true"]').boundingBox();
      const chatBox = await page.locator('[data-canvas-chat-slot="true"]').boundingBox();
      const stageBox = await page.locator('[data-canvas-stage="true"]').boundingBox();
      expect(rootBox).not.toBeNull();
      expect(canvasBox).not.toBeNull();
      expect(chatBox).not.toBeNull();
      expect(stageBox).not.toBeNull();
      expect(rootBox!.x).toBeLessThanOrEqual(1);
      expect(rootBox!.width).toBeGreaterThanOrEqual(viewport.width - 2);
      if (viewport.width >= 768) {
        expect(chatBox!.x).toBeLessThanOrEqual(2);
        expect(stageBox!.x).toBeGreaterThanOrEqual(chatBox!.x + chatBox!.width - 2);
        expect(canvasBox!.x).toBeGreaterThanOrEqual(chatBox!.width - 8);
        expect(canvasBox!.width).toBeLessThan(viewport.width - 200);
        expect(Math.abs(canvasBox!.width - stageBox!.width)).toBeLessThan(4);
        expect(chatBox!.x + chatBox!.width + stageBox!.width).toBeGreaterThan(viewport.width - 8);
      } else {
        expect(canvasBox!.width).toBeGreaterThanOrEqual(viewport.width - 2);
      }
    }
  });

  test("mobile renders a readable workflow flow with a reserved dock row", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/engineer");
    await waitForCanvasReady(page);

    const mobileFlow = page.locator('[data-workflow-mobile-flow="true"]');
    const mobileNode = page.locator('[data-mobile-workflow-node="repository"]');
    const desktopNode = page.locator('[data-workflow-node="repository"]');
    const workflowPane = page.locator('[data-canvas-stage-pane="workflow"]');
    const dockSlot = page.locator('[data-canvas-bottom-dock-slot="true"]');

    await expect(mobileFlow).toBeVisible();
    await expect(mobileNode).toBeVisible();
    await expect(desktopNode).toBeHidden();
    await expect(page.getByText("New repo", { exact: true })).toBeVisible();
    await expect(page.getByText("New task", { exact: true })).toBeVisible();

    const nodeBox = await mobileNode.boundingBox();
    const paneBox = await workflowPane.boundingBox();
    const dockBox = await dockSlot.boundingBox();
    expect(nodeBox).not.toBeNull();
    expect(paneBox).not.toBeNull();
    expect(dockBox).not.toBeNull();
    expect(nodeBox!.width).toBeGreaterThanOrEqual(320);
    expect(nodeBox!.height).toBeGreaterThanOrEqual(56);
    expect(paneBox!.y + paneBox!.height).toBeLessThanOrEqual(dockBox!.y + 1);
  });

  test("mobile chat sheet uses velocity-aware snap physics", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/engineer");
    await waitForCanvasReady(page);

    const chat = page.locator('[data-canvas-map-chat="true"]');
    const slot = page.locator('[data-canvas-chat-slot="true"]');
    const handle = page.locator('[data-map-chat-move="true"]');
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();

    const centerX = handleBox!.x + handleBox!.width / 2;
    const centerY = handleBox!.y + handleBox!.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX, centerY - 130, { steps: 3 });
    await expect(chat).toHaveAttribute("data-map-chat-sheet-dragging", "true");
    await page.mouse.up();
    await expect(chat).toHaveAttribute("data-map-chat-sheet-dragging", "false");
    await expect
      .poll(async () => Math.round((await slot.boundingBox())?.height ?? 0))
      .toBe(473);
  });

  test("floating menu opens navigation and Escape closes it", async ({ page }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);
    const menuButton = page.locator('[data-canvas-menu-button="true"]');
    await menuButton.click();
    const menu = page.locator('[data-canvas-menu-overlay="true"]');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("link", { name: "Home", exact: true })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Engineering Console", exact: true })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Repositories", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-canvas-menu-overlay="true"]')).toHaveCount(0);
  });

  test("top-left menu stays separate from the top context chrome", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/engineer");
    await waitForCanvasReady(page);

    const menuButton = page.locator('[data-canvas-menu-button="true"]');
    const topContext = page.locator('[data-canvas-top-context="true"]');

    await expect(menuButton).toHaveCount(1);
    await expect(topContext).toContainText("Engineering Console");

    const menuBox = await menuButton.boundingBox();
    const contextBox = await topContext.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(contextBox).not.toBeNull();
    expect(menuBox!.x + menuBox!.width).toBeLessThan(contextBox!.x);
  });

  test("canvas zoom controls and fit view update transform state", async ({ page }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);
    const world = page.locator('[data-canvas-world="true"]');
    const canvas = page.locator('[data-workflow-canvas="true"]');
    const zoomLabel = page.locator('[data-canvas-zoom-label="true"]');
    const initialZoom = await world.getAttribute("data-canvas-zoom");

    await page.locator('[data-canvas-zoom-in="true"]').click();
    await expect(canvas).toHaveAttribute("data-camera-spring", "true");
    await expect(world).not.toHaveAttribute("data-canvas-zoom", initialZoom ?? "1.00");
    const zoomedIn = await world.getAttribute("data-canvas-zoom");

    await page.getByRole("button", { name: "Fit view" }).click();
    await expect(canvas).toHaveAttribute("data-camera-spring", "true");
    await expect(zoomLabel).not.toContainText(initialZoom ? `${Math.round(Number(initialZoom) * 100)}%` : "100%");
    await expect(world).not.toHaveAttribute("data-canvas-zoom", zoomedIn ?? "1.00");
  });

  test("top chrome stays centered without desktop overflow and keeps only status/context controls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/engineer");
    await waitForCanvasReady(page);

    const commandBar = page.locator('[data-canvas-command-bar="true"]');
    const stage = page.locator('[data-canvas-stage="true"]');
    const geometry = await commandBar.evaluate((node) => {
      const element = node as HTMLElement;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    });
    const stageBox = await stage.boundingBox();
    expect(stageBox).not.toBeNull();
    expect(Math.abs(geometry.left - stageBox!.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(geometry.right - (stageBox!.x + stageBox!.width))).toBeLessThanOrEqual(4);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    await expect(commandBar).toContainText("Engineering Console");
    await expect(commandBar.getByRole("button", { name: "Tasks", exact: true })).toHaveCount(0);
    await expect(commandBar.getByRole("button", { name: "Runs", exact: true })).toHaveCount(0);
    await expect(commandBar.getByRole("button", { name: "Repositories", exact: true })).toHaveCount(0);

    const tabs = page.locator('[data-canvas-stage-tabs="true"]');
    const commandBox = await commandBar.boundingBox();
    const tabsBox = await tabs.boundingBox();
    expect(commandBox).not.toBeNull();
    expect(tabsBox).not.toBeNull();
    expect(commandBox!.y + commandBox!.height).toBeLessThanOrEqual(tabsBox!.y + 1);
  });

  test("toolbar collapses to a premium edge tab and restores working zoom controls", async ({ page }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);

    const toolbar = page.locator('[data-canvas-toolbar="true"]');
    const world = page.locator('[data-canvas-world="true"]');
    const zoomBefore = await world.getAttribute("data-canvas-zoom");

    await expect(toolbar.locator('[data-canvas-toolbar-edge-tab="true"]')).toHaveAttribute(
      "aria-label",
      "Collapse canvas controls",
    );
    await toolbar.locator('[data-canvas-toolbar-toggle="true"]').click();
    await expect(toolbar).toHaveAttribute("data-canvas-toolbar-collapsed", "true");
    await expect(toolbar.locator('[data-canvas-toolbar-panel="true"]')).toHaveCount(0);

    await expect(toolbar.locator('[data-canvas-toolbar-edge-tab="true"]')).toHaveAttribute(
      "aria-label",
      "Expand canvas controls",
    );
    await toolbar.locator('[data-canvas-toolbar-toggle="true"]').click();
    await expect(toolbar).toHaveAttribute("data-canvas-toolbar-collapsed", "false");
    await expect(toolbar.locator('[data-canvas-toolbar-panel="true"]')).toBeVisible();

    await toolbar.locator('[data-canvas-zoom-in="true"]').click();
    await expect(world).not.toHaveAttribute("data-canvas-zoom", zoomBefore ?? "1.00");
  });

  test("bottom dock tasks and runs focus the corresponding workflow nodes", async ({ page }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);

    const world = page.locator('[data-canvas-world="true"]');
    const startPan = await world.getAttribute("data-canvas-pan-x");

    await page.locator('[data-canvas-dock-link="tasks"]').click();
    await expect(page.locator('[data-workflow-node="task"]')).toHaveAttribute("data-node-selected", "true");
    await expect(page.locator("#canvas-side-panel")).toContainText("Task");

    const taskPan = await world.getAttribute("data-canvas-pan-x");
    expect(taskPan).not.toBe(startPan);

    await page.locator('[data-canvas-dock-link="runs"]').click();
    await expect(page.locator('[data-workflow-node="run"]')).toHaveAttribute("data-node-selected", "true");
    await expect(page.locator("#canvas-side-panel")).toContainText("Run");
    await expect(world).not.toHaveAttribute("data-canvas-pan-x", taskPan ?? "");
  });

  test("bottom dock reviews focuses the review node and related edges", async ({ page }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);

    await page.locator('[data-canvas-dock-link="reviews"]').click();
    await expect(page.locator('[data-workflow-node="review"]')).toHaveAttribute("data-node-selected", "true");
    await expect(page.locator('[data-canvas-edge="true"][data-edge-connected="true"]')).toHaveCount(2);
    await expect(page.locator('[data-canvas-edge="true"][data-edge-dimmed="true"]')).toHaveCount(5);
  });

  test("bottom dock repos and release focus the corresponding workflow nodes", async ({ page }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);

    await page.locator('[data-canvas-dock-link="repos"]').click();
    await expect(page.locator('[data-canvas-surface="repo"]')).toBeVisible();
    await expect(page.locator('[data-repo-map-canvas="true"]')).toBeVisible();
    await expect(page.locator('[data-repo-contract-card="true"]')).toBeVisible();

    await page.locator('[data-canvas-dock-link="release"]').click();
    await expect(page.locator('[data-workflow-node="release"]')).toHaveAttribute("data-node-selected", "true");
    await expect(page.locator("#canvas-side-panel")).toContainText("Release");
  });

  test("selecting audit then run moves the focal glow and connected path emphasis", async ({ page }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);

    const canvas = page.locator('[data-workflow-canvas="true"]');

    await page.locator('[data-workflow-node="audit"]').click();
    await expect(page.locator('[data-workflow-node="audit"]')).toHaveAttribute("data-node-selected", "true");
    await expect(canvas).toHaveAttribute("data-canvas-focus-node", "audit");
    await expect(page.locator('[data-canvas-edge="true"][data-edge-connected="true"]')).toHaveCount(1);
    await expect(page.locator('[data-canvas-edge="true"][data-edge-emphasis="subdued"]')).toHaveCount(6);

    await page.locator('[data-workflow-node="run"]').evaluate((node) => {
      (node as HTMLButtonElement).click();
    });
    await expect(page.locator('[data-workflow-node="run"]')).toHaveAttribute("data-node-selected", "true");
    await expect(canvas).toHaveAttribute("data-canvas-focus-node", "run");
    await expect(page.locator('[data-canvas-edge="true"][data-edge-connected="true"]')).toHaveCount(3);
    await expect(page.locator('[data-canvas-bottom-dock="true"]')).toBeVisible();
    await expect(page.locator('[data-canvas-top-bar="true"]')).toBeVisible();
  });

  test("bottom dock includes docs and opens the docs drawer", async ({ page }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);

    const docsDockButton = page.locator('[data-canvas-dock-link="docs"]');
    await expect(docsDockButton).toBeVisible();
    await docsDockButton.click();
    await expect(page.locator('[data-detail-drawer="true"][data-detail-panel="docs"]')).toBeVisible();
    await expect(page.locator("#canvas-docs-panel")).toBeVisible();
  });

  test("menu and toolbar edge tab remain keyboard focusable", async ({ page }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);

    const menuButton = page.locator('[data-canvas-menu-button="true"]');
    await menuButton.focus();
    await expect(menuButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-canvas-menu-overlay="true"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-canvas-menu-overlay="true"]')).toHaveCount(0);

    const toolbarToggle = page.locator('[data-canvas-toolbar-toggle="true"]');
    await toolbarToggle.focus();
    await expect(toolbarToggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-canvas-toolbar="true"]')).toHaveAttribute(
      "data-canvas-toolbar-collapsed",
      "true",
    );
  });

  test("dragging the run node moves it without leaving the page", async ({ page }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);
    const runNode = page.locator('[data-workflow-node="run"]').first();
    const startX = await runNode.getAttribute("data-node-x");
    const startY = await runNode.getAttribute("data-node-y");
    await runNode.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;
      node.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: startX,
          clientY: startY,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: startX + 80,
          clientY: startY + 50,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: startX + 80,
          clientY: startY + 50,
        }),
      );
    });

    await expect(runNode).not.toHaveAttribute("data-node-x", startX ?? "");
    await expect(runNode).not.toHaveAttribute("data-node-y", startY ?? "");
    await expect(page).toHaveURL(/\/engineer\/?$/);
  });

  test("clicking the run node opens the inspector and floating issue card routes safely", async ({
    page,
  }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);
    await page.locator('[data-workflow-node="run"]').first().evaluate((node) => {
      (node as HTMLButtonElement).click();
    });
    await expect(page.locator("#canvas-side-panel")).toContainText("Run");
    await page
      .locator("#canvas-side-panel")
      .getByRole("link")
      .first()
      .evaluate((node) => {
        (node as HTMLAnchorElement).click();
      });
    await expect(page).not.toHaveURL(/\/engineer\/?$/);
  });

  test("repository node routes to repository management", async ({ page }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);
    await page.locator('[data-workflow-node="repository"]').first().evaluate((node) => {
      (node as HTMLButtonElement).click();
    });
    await expect(page.locator('[data-canvas-surface="repo"]')).toBeVisible();
    await expect(page.locator('[data-repo-map-canvas="true"]')).toBeVisible();
    await expect(page.locator('[data-repo-contract-card="true"]')).toBeVisible();
    await page.getByRole("link", { name: /Repo details|Open repositories/i }).click();
    await expect(page).toHaveURL(/\/engineer\/repos$/);
  });

  test("issue center still routes to the next problem", async ({ page }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);
    const issueCenter = await openIssueCenter(page);
    await issueCenter.locator("ul button").first().evaluate((node) => {
      (node as HTMLButtonElement).click();
    });
    await expect(page).not.toHaveURL(/\/engineer\/?$/);
  });

  test("Escape closes expanded issue center", async ({ page }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);
    await openIssueCenter(page);
    await expect(page.locator('[data-overlay-window="issue-center"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-overlay-window="issue-center"]')).toHaveCount(0);
  });

  test("detail routes open overlay drawers and Escape closes them", async ({ page }) => {
    await page.goto("/engineer?details=activity");
    await waitForCanvasReady(page);
    const drawer = page.locator('[data-detail-drawer="true"][data-detail-panel="activity"]');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator("#dashboard-activity-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-detail-drawer="true"]')).toHaveCount(0);
    await expect(page).toHaveURL(/\/engineer\/?$/);
  });

  test("issue center can minimize and restore from the minimized bar", async ({ page }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);
    const issueCenter = await openIssueCenter(page);
    await issueCenter.locator('[data-overlay-minimize="issue-center"]').click();
    await expect(page.locator('[data-overlay-window="issue-center"]')).toHaveCount(0);
    const minimizedItem = page.locator('[data-minimized-overlay="issue-center"]');
    await expect(minimizedItem).toBeVisible();
    await minimizedItem.getByRole("button").first().click();
    await expect(page.locator('[data-overlay-window="issue-center"]')).toBeVisible();
  });

  test("inspector can minimize and restore, and dragged overlays can yield click focus", async ({
    page,
  }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);
    await page.locator('[data-workflow-node="run"]').first().evaluate((node) => {
      (node as HTMLButtonElement).click();
    });
    const inspector = page.locator("#canvas-side-panel");
    await expect(inspector).toContainText("Run");
    await inspector.locator('[data-overlay-minimize="node-inspector"]').click();
    await expect(inspector).toHaveCount(0);
    const minimizedInspector = page.locator('[data-minimized-overlay="node-inspector"]');
    await expect(minimizedInspector).toBeVisible();
    await minimizedInspector.getByRole("button").first().click();
    await expect(page.locator("#canvas-side-panel")).toContainText("Run");

    const issueCenter = await openIssueCenter(page);
    const issueCenterStart = await issueCenter.boundingBox();
    await issueCenter.locator('[data-overlay-drag-handle="true"]').evaluate((handle) => {
      const rect = handle.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;
      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: startX,
          clientY: startY,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: startX - 260,
          clientY: startY - 80,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: startX - 260,
          clientY: startY - 80,
        }),
      );
    });
    await expect(issueCenter).toHaveAttribute("data-overlay-top", "true");
    const issueCenterMoved = await issueCenter.boundingBox();
    expect(issueCenterStart?.x).not.toBeNull();
    expect(issueCenterMoved?.x).not.toBeNull();
    expect(issueCenterMoved!.x).toBeLessThan(issueCenterStart!.x);
    await page.locator('[data-overlay-window="priority-issue"]').evaluate((node) => {
      node.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 24,
          clientY: 24,
        }),
      );
    });
    await expect(page.locator('[data-overlay-window="priority-issue"]')).toHaveAttribute(
      "data-overlay-top",
      "true",
    );
    await expect(issueCenter).toHaveAttribute("data-overlay-top", "false");
  });

  test("detail drawer can minimize and restore from the minimized bar", async ({ page }) => {
    await page.goto("/engineer?details=activity");
    await waitForCanvasReady(page);
    const drawer = page.locator('[data-detail-drawer="true"][data-detail-panel="activity"]');
    await expect(drawer).toBeVisible();
    await drawer.locator('[data-overlay-minimize="detail-drawer"]').click();
    await expect(page.locator('[data-detail-drawer="true"]')).toHaveCount(0);
    const minimizedDrawer = page.locator('[data-minimized-overlay="detail-drawer"]');
    await expect(minimizedDrawer).toBeVisible();
    await minimizedDrawer.getByRole("button").first().click();
    await expect(page.locator('[data-detail-drawer="true"][data-detail-panel="activity"]')).toBeVisible();
  });

  test("reduced motion preference preserves the command bar and tool rail layout", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/engineer");
    await waitForCanvasReady(page);

    await expect(page.locator('[data-canvas-command-bar="true"]')).toBeVisible();
    await expect(page.locator('[data-canvas-toolbar="true"]')).toBeVisible();
    await expect(page.locator('[data-workflow-node="run"]')).toBeVisible();
    await page.locator('[data-canvas-menu-button="true"]').click();
    await expect(page.locator('[data-canvas-menu-overlay="true"]')).toHaveCSS("animation-name", "none");
    await page.keyboard.press("Escape");
    await page.locator('[data-workflow-node="review"]').evaluate((node) => {
      (node as HTMLButtonElement).click();
    });
    const transientEdge = page.locator('[data-edge-transient="true"]');
    if ((await transientEdge.count()) > 0) {
      await expect(transientEdge.first()).toHaveCSS("animation-name", "none");
    }
  });

  test("dense queue details stay hidden by default and open run navigation still works", async ({
    page,
    request,
    baseURL,
  }) => {
    const { runId } = await createTaskAndRun(request, baseURL!, {
      title: `E2E queue run ${Date.now()}`,
      description: "Operator queue run fixture",
    });
    await waitForRunDetailApiReady(request, baseURL!, runId);

    await page.goto("/engineer");
    await waitForCanvasReady(page);
    await expect(page.getByRole("heading", { name: "Operator Queue", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Run staging smoke workflow", exact: true })).toHaveCount(0);

    await page.goto("/engineer?details=queue");
    const detailDrawer = page.locator('[data-detail-drawer="true"][data-detail-panel="queue"]');
    await expect(detailDrawer).toBeVisible();
    const queue = detailDrawer.locator("#dashboard-details-queue").locator("section").filter({
      has: page.getByRole("heading", { name: "Operator Queue", exact: true }),
    });
    await expect(queue).toBeVisible();
    await expect(queue.getByRole("tab", { name: /My next actions/i })).toBeVisible();
    await expect(queue.getByRole("tab", { name: /Blocked \/ failed/i })).toBeVisible();
    await expect(queue.getByRole("tab", { name: /Approval queue/i })).toBeVisible();
    await expect(queue.getByRole("tab", { name: /Stale runs/i })).toBeVisible();

    const nextActionsTab = queue.getByRole("tab", { name: /My next actions/i });
    await nextActionsTab.click();
    await expect(nextActionsTab).toHaveAttribute("aria-selected", "true");

    const blockedTab = queue.getByRole("tab", { name: /Blocked \/ failed/i });
    await blockedTab.click();
    await expect(blockedTab).toHaveAttribute("aria-selected", "true");

    const staleTab = queue.getByRole("tab", { name: /Stale runs/i });
    await staleTab.click();
    await expect(staleTab).toHaveAttribute("aria-selected", "true");

    await queue.getByRole("tab", { name: /All/i }).click();
    await queue.getByRole("link", { name: "Open run", exact: true }).first().click();
    await expect(page).toHaveURL(/\/engineer\/runs\/[^/]+$/);
  });

  test("registered repos page loads", async ({ page }) => {
    await page.goto("/engineer/repos");
    await expect(page.locator('[data-engineer-route-shell="immersive"]')).toBeVisible();
    await expect(page.locator('[data-engineer-surface="sheet"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Engineering Console" })).toBeVisible();
    await expect(page.locator('[data-canvas-bottom-dock="true"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Open VeraLux menu" })).toBeVisible();
    await expect(page.locator('[data-engineer-back="true"]')).toHaveCount(1);
    await expect(page.locator('[data-engineer-back="true"]').first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Repositories" })).toBeVisible();
    const primaryActions = page.locator('[data-repo-primary-actions="true"]');
    await expect(primaryActions).toBeVisible();
    await expect(primaryActions.getByRole("heading", { name: "Start a new repository" })).toBeVisible();
    await expect(primaryActions.getByRole("heading", { name: "Register repository" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "GitHub" })).toBeVisible();
    await expect(page.locator('[data-github-access="true"]')).toBeVisible();
    const setupDetails = page.locator('[data-repo-setup-details="true"]');
    await expect(setupDetails).not.toHaveAttribute("open", "");
    await setupDetails.locator("summary").click();
    await expect(page.getByRole("heading", { name: "Approved repo roots" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Repo setup order" })).toBeVisible();
    const mainBox = await page.locator("main").boundingBox();
    const dockSlotBox = await page.locator('[data-engineer-bottom-dock-slot="true"]').boundingBox();
    expect(mainBox).not.toBeNull();
    expect(dockSlotBox).not.toBeNull();
    expect(mainBox!.y + mainBox!.height).toBeLessThanOrEqual(dockSlotBox!.y + 1);
    await page.locator('[data-engineer-back="true"]').first().click();
    await expect(page).toHaveURL(/\/engineer\/?$/);
  });

  test("compatibility page loads", async ({ page }) => {
    await page.goto("/engineer/compatibility");
    await expect(page.locator('[data-engineer-back="true"]')).toHaveCount(1);
    await expect(page.locator('[data-engineer-back="true"]').first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Compatibility" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Run compatibility analysis" })).toBeVisible();
    await expect(page.getByText(/Compatibility analysis/i).first()).toBeVisible();
  });

  test("task entry point remains hidden until requested and reachable from dashboard", async ({ page }) => {
    await page.goto("/engineer");
    await waitForCanvasReady(page);
    await expect(page.getByText("Task details", { exact: true })).toHaveCount(0);
    await page.goto("/engineer?details=tasks");
    const taskDetails = page.locator('[data-detail-drawer="true"][data-detail-panel="tasks"]').locator(
      "#dashboard-details-tasks",
    );
    await expect(taskDetails.getByRole("button", { name: "Create task" })).toBeVisible();
  });

  test.describe("run detail", () => {
    test.describe.configure({ retries: 2 });

    test("API fixture is readable before navigation", async ({ request, baseURL }) => {
      const { runId } = await createTaskAndRun(request, baseURL!);
      await waitForRunDetailApiReady(request, baseURL!, runId);
      const res = await request.get(`${baseURL}/api/engineer-console/runs/${runId}`);
      expect(res.ok()).toBe(true);
      const payload = (await res.json()) as { run: { id: string }; task: { id: string } };
      expect(payload.run.id).toBe(runId);
      expect(payload.task.id).toBeTruthy();
    });

    test("workspace tabs and issue center render for governance-ready fixture", async ({
      page,
      request,
      baseURL,
    }) => {
      const { runId } = await createRunWithGovernanceFixture(request, baseURL!);
      await gotoRunDetailResilient(page, runId, request, baseURL!);
      await expect(
        page.getByRole("heading", { name: "Run workspace", exact: true }),
      ).toBeVisible();
      for (const heading of RUN_DETAIL_GROUP_HEADINGS) {
        await expect(page.getByRole("tab", { name: heading, exact: true })).toBeVisible();
      }
      const issueCenter = page.locator("aside").filter({
        has: page.getByText("Issue Center", { exact: true }),
      });
      await expect(issueCenter).toBeVisible();
      await expect(page.getByRole("heading", { name: "What to do now", exact: true })).toBeVisible();
      await expect(page.getByText("More status (optional)")).toBeVisible();
      await expect(page.getByRole("button", { name: /Open issue:/i })).toBeVisible();
    });

    test("PR and audit workspace views are reachable from the run workspace", async ({
      page,
      request,
      baseURL,
    }) => {
      const { runId } = await createTaskAndRun(request, baseURL!, {
        title: `Deep link workspace test ${Date.now()}`,
        description: "Verify PR and audit deep links open the correct workspace views.",
      });
      await gotoRunDetailResilient(page, runId, request, baseURL!);

      await page.getByRole("tab", { name: "Later", exact: true }).click();
      await expect(page.getByRole("tab", { name: "Later", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
        { timeout: 15_000 },
      );
      await expect(page.getByRole("heading", { name: "PR creation", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Audit timeline", exact: true })).toBeVisible();
    });

    test("guided worker-plan builder supports README smoke helper", async ({
      page,
      request,
      baseURL,
    }) => {
      const { runId } = await createTaskAndRun(request, baseURL!, {
        title: "Create README smoke verification",
        description: "Create README.md for staging smoke verification.",
      });

      await gotoRunDetailResilient(page, runId, request, baseURL!);
      await page.getByRole("tab", { name: "This job", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Guided worker-plan builder" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Create README smoke plan" })).toBeVisible();

      await page.getByRole("button", { name: "Create README smoke plan" }).click();

      await expect(
        page.locator("pre").filter({ hasText: `"runId": "${runId}"` }).first(),
      ).toBeVisible();
      await expect(
        page.locator("pre").filter({ hasText: '"path": "README.md"' }).first(),
      ).toBeVisible();
      await expect(page.getByText("This plan will create file: README.md.")).toBeVisible();
    });
  });

});
