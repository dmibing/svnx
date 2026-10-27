import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-cat-test-"));
let app;
const launch = () =>
  electron.launch({
    args: ["."],
    env: { ...process.env, SVNX_TEST_DATA: temp, SVNX_DEV_URL: "" },
  });
try {
  await fs.writeFile(
    path.join(temp, "settings.json"),
    JSON.stringify({
      version: 1,
      settings: { theme: "light", svnPath: "svn", autoCheckUpdates: false },
      workspaces: [],
    }),
  );
  app = await launch();
  let page = await app.firstWindow();
  await expect(page.locator(".welcome")).toBeVisible({ timeout: 30000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.install();
  await page.reload();
  await page.evaluate(() => {
    Math.random = () => 0;
  });
  await expect(
    page.getByRole("button", { name: "摸摸小猫", exact: true }),
  ).toBeVisible();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].focus(),
  );
  const widget = page.locator(".status-cat");
  const sprite = page.locator(".status-cat-sprite");
  expect(
    await sprite.evaluate(
      (element) =>
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () =>
            resolve(image.naturalWidth > 1000 && image.naturalHeight > 500);
          image.onerror = () => resolve(false);
          image.src = getComputedStyle(element).backgroundImage.slice(5, -2);
        }),
    ),
  ).toBe(true);
  await expect(widget).toHaveAttribute("data-pose", "sleep");
  await page.clock.fastForward(8000);
  await expect(widget).toHaveAttribute("data-pose", "walk");
  const runner = page.locator(".status-cat-runner");
  await expect(runner).toBeVisible();
  const poses = await runner.evaluate((element) => {
    const animation = element.getAnimations()[0];
    return [0, 310, 610, 910].map((time) => {
      animation.pause();
      animation.currentTime = time;
      return getComputedStyle(element).backgroundPositionX;
    });
  });
  expect(new Set(poses).size).toBe(4);
  const positions = await page
    .locator(".status-cat-button")
    .evaluate((element) => {
      const animation = element.getAnimations()[0];
      return [0, 3000].map((time) => {
        animation.pause();
        animation.currentTime = time;
        return element.getBoundingClientRect().x;
      });
    });
  expect(Math.abs(positions[1] - positions[0])).toBeGreaterThan(30);
  await page.clock.fastForward(24000);
  await expect(widget).toHaveAttribute("data-pose", "sleep");
  await page.clock.fastForward(25000);
  await expect(widget).toHaveAttribute("data-pose", "chase");
  await expect(page.locator(".status-cat-mouse")).toBeVisible();
  await fs.mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/status-cat-chase.png" });
  await page.clock.fastForward(3600);
  await expect(widget).toHaveAttribute("data-pose", "catch");
  await expect(page.locator(".status-cat-mouse")).toHaveCount(0);
  await page.clock.fastForward(900);
  await expect(widget).toHaveAttribute("data-pose", "sleep");
  await page.getByRole("button", { name: "摸摸小猫", exact: true }).click();
  await expect(widget).toHaveAttribute("data-pose", "pet");
  await expect(page.locator(".status-cat-message")).toHaveText(
    "喵～摸摸收到啦",
  );
  await page.clock.runFor(600);
  await expect(sprite).toHaveCSS("background-position", "-96px -32px");
  await fs.mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/status-cat-light.png" });
  await page.clock.runFor(2600);
  await expect(widget).toHaveAttribute("data-pose", "sleep");
  await expect(page.locator(".status-cat-message")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.fastForward(100000);
  await expect(widget).toHaveAttribute("data-pose", "sleep");
  await page.getByRole("button", { name: "摸摸小猫", exact: true }).click();
  await page.clock.runFor(1000);
  await expect(sprite).toHaveCSS("background-position", "-64px -32px");
  await page.clock.runFor(2200);
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "artifacts/status-cat-dark.png" });
  await page.getByRole("button", { name: /偏好设置/ }).click();
  await page
    .getByRole("checkbox", { name: "显示猫咪摆件", exact: true })
    .uncheck();
  await expect(widget).toHaveCount(0);
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(path.join(temp, "settings.json"), "utf8"))
          .settings.statusCat,
    )
    .toBe(false);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await expect(page.locator(".welcome")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".status-cat")).toHaveCount(0);
  const invalid = await page.evaluate(() =>
    window.svnx.settings({ statusCat: "yes" }),
  );
  expect(invalid.ok).toBe(false);
  await page.getByRole("button", { name: /偏好设置/ }).click();
  await page
    .getByRole("checkbox", { name: "显示猫咪摆件", exact: true })
    .check();
  await expect(
    page.getByRole("button", { name: "摸摸小猫", exact: true }),
  ).toBeVisible();
  expect(await page.locator("audio, video").count()).toBe(0);
  // A renderer fixture verifies that code reading suppresses idle animations.
  const bootstrap = await page.evaluate(() => window.svnx.bootstrap());
  await app.evaluate(({ ipcMain }, response) => {
    response.data.workspaces = [
      { id: "cat-code", name: "代码预览", path: "fixture", revision: 1 },
    ];
    ipcMain.removeHandler("svnx:bootstrap");
    ipcMain.handle("svnx:bootstrap", () => response);
    ipcMain.removeHandler("svnx:run");
    ipcMain.handle("svnx:run", (_, request) => ({
      ok: true,
      data:
        request.method === "status"
          ? [{ path: "main.cs", status: "modified", kind: "file" }]
          : request.method === "diff"
            ? {
                path: "main.cs",
                before: "class Before {}",
                after: "class After {}",
              }
            : request.method === "info"
              ? {}
              : [],
    }));
  }, bootstrap);
  await page.clock.install();
  await page.reload();
  await expect(page.locator(".monaco-diff-editor")).toBeVisible();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].focus(),
  );
  await page.clock.fastForward(180000);
  await expect(page.locator(".status-cat")).toHaveAttribute(
    "data-pose",
    "sleep",
  );
  await page.getByRole("button", { name: "摸摸小猫", exact: true }).click();
  await expect(page.locator(".status-cat")).toHaveAttribute("data-pose", "pet");
  console.log(
    "PASS: local cat atlas, walking, four-pose strides, mouse chase and catch, click reactions, reduced motion, light/dark, persisted switch, invalid settings rejection and quiet code reading",
  );
} finally {
  if (app) await app.close();
  await fs.rm(temp, { recursive: true, force: true });
}
