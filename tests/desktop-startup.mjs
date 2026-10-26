import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-startup-"));
let app;
try {
  await fs.writeFile(
    path.join(temp, "settings.json"),
    JSON.stringify({
      version: 1,
      settings: { theme: "dark", svnPath: "svn", autoCheckUpdates: false },
      workspaces: [],
    }),
  );
  app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      SVNX_TEST_DATA: temp,
      SVNX_DEV_URL: "",
      SVNX_STARTUP_SIGNAL: path.join(temp, "startup.ready"),
    },
  });
  const main = await app.firstWindow();
  await expect(main.locator(".welcome")).toBeVisible({ timeout: 30000 });
  await expect(main.locator(".startup-screen")).toHaveCount(0);
  await expect
    .poll(() =>
      fs.readFile(path.join(temp, "startup.ready"), "utf8").catch(() => ""),
    )
    .toBe("ready");
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
  ).toBe(true);
  const history = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.navigationHistory.getAllEntries(),
  );
  expect(history.some((entry) => entry.url.includes("startup.html"))).toBe(
    true,
  );
  const previewEvent = app.waitForEvent("window");
  await app.evaluate(async ({ BrowserWindow }, file) => {
    globalThis.startupPreview = new BrowserWindow({
      width: 560,
      height: 340,
      show: false,
      webPreferences: {
        backgroundThrottling: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await globalThis.startupPreview.loadFile(file);
  }, path.resolve("public/startup.html"));
  const preview = await previewEvent;
  await preview.emulateMedia({
    colorScheme: "dark",
    reducedMotion: "no-preference",
  });
  await expect(preview.getByRole("status")).toContainText("正在启动，请稍候");
  expect(
    await preview
      .locator(".startup-brand img")
      .evaluate((image) => image.complete && image.naturalWidth > 0),
  ).toBe(true);
  await expect(preview.locator(".startup-screen")).toHaveCSS(
    "background-color",
    "rgb(36, 36, 36)",
  );
  expect(
    await preview
      .locator(".startup-indicator")
      .evaluate(
        (element) => getComputedStyle(element, "::after").animationName,
      ),
  ).toContain("startup-mouse");
  await fs.mkdir("artifacts", { recursive: true });
  // Sample the actual rendered pseudo-elements, not just animation names.
  const poses = [];
  for (let time = 0; time < 3800; time += 100) {
    const pose = await preview.evaluate((time) => {
      document.getAnimations().forEach((animation) => {
        animation.pause();
        animation.currentTime = time;
      });
      const element = document.querySelector(".startup-indicator");
      const cat = getComputedStyle(element, "::before");
      const mouse = getComputedStyle(element, "::after");
      return {
        cat: cat.backgroundPosition,
        mouse: mouse.backgroundPosition,
        position: cat.transform,
      };
    }, time);
    poses.push(pose);
  }
  expect(new Set(poses.map((pose) => pose.cat)).size).toBe(4);
  expect(new Set(poses.map((pose) => pose.mouse)).size).toBe(4);
  expect(new Set(poses.map((pose) => pose.position)).size).toBeGreaterThan(30);
  await app.evaluate(() => globalThis.startupPreview.showInactive());
  await preview.screenshot({ path: "artifacts/startup-dark.png" });
  await preview.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await preview
      .locator(".startup-indicator")
      .evaluate(
        (element) => getComputedStyle(element, "::after").animationName,
      ),
  ).toBe("startup-mouse-frames");
  const reducedPoses = [];
  for (const time of [0, 170, 330, 490]) {
    reducedPoses.push(
      await preview.evaluate((time) => {
        document.getAnimations().forEach((animation) => {
          animation.pause();
          animation.currentTime = time;
        });
        const element = document.querySelector(".startup-indicator");
        return {
          cat: getComputedStyle(element, "::before").backgroundPosition,
          mouse: getComputedStyle(element, "::after").backgroundPosition,
          position: getComputedStyle(element, "::before").transform,
        };
      }, time),
    );
  }
  expect(new Set(reducedPoses.map((pose) => pose.cat)).size).toBe(4);
  expect(new Set(reducedPoses.map((pose) => pose.mouse)).size).toBe(4);
  expect(new Set(reducedPoses.map((pose) => pose.position)).size).toBe(1);
  await app.evaluate(() => globalThis.startupPreview.close());
  const bootstrap = await main.evaluate(() => window.svnx.bootstrap());
  await app.evaluate(({ ipcMain }, response) => {
    let calls = 0;
    ipcMain.removeHandler("svnx:bootstrap");
    ipcMain.handle("svnx:bootstrap", () =>
      ++calls <= 1
        ? { ok: false, error: { code: "SERVICE", message: "启动检查暂时失败" } }
        : response,
    );
  }, bootstrap);
  await main.reload();
  await expect(
    main.getByRole("button", { name: "重试启动", exact: true }),
  ).toBeVisible();
  await main.getByRole("button", { name: "重试启动", exact: true }).click();
  await expect(main.locator(".welcome")).toBeVisible();
  const native = await fs.readFile("build/startup/SVNX.Startup.exe");
  expect(native.toString("ascii", 0, 2)).toBe("MZ");
  console.log(
    "PASS: startup before main window, animated loader, reduced motion, startup error retry, native launcher handoff",
  );
} finally {
  if (app) await app.close();
  await fs.rm(temp, { recursive: true, force: true });
}
