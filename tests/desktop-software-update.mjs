import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createHash } from "node:crypto";

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-software-update-"));
const payload = Buffer.from("MZ-SVNX-test-payload-never-executed");
let corrupt = false,
  app;
const server = http.createServer((request, response) => {
  if (request.url.startsWith("/latest.yml")) {
    const digest = createHash("sha512")
      .update(corrupt ? "wrong" : payload)
      .digest("base64");
    response.end(
      `version: 0.1.99\nfiles:\n  - url: test.exe\n    sha512: ${digest}\n    size: ${payload.length}\npath: test.exe\nsha512: ${digest}\nreleaseDate: '2026-10-26T00:00:00Z'\n`,
    );
  } else {
    response.end(payload);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const feed = `http://127.0.0.1:${server.address().port}/`;
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
    env: { ...process.env, SVNX_TEST_DATA: temp, SVNX_DEV_URL: "" },
  });
  const page = await app.firstWindow();
  await expect(page.locator(".welcome")).toBeVisible({ timeout: 30000 });
  // Real electron-updater HTTP download and checksum, isolated cache, no install.
  for (const bad of [false, true]) {
    corrupt = bad;
    const directory = path.join(temp, bad ? "bad" : "good");
    await fs.mkdir(directory);
    await fs.writeFile(
      path.join(directory, "app-update.yml"),
      `provider: generic\nurl: ${feed}\nupdaterCacheDirName: cache\n`,
    );
    await app.evaluate(
      async (_, { directory, feed }) => {
        const require = process
          .getBuiltinModule("module")
          .createRequire(process.cwd() + "/package.json");
        const { NsisUpdater } = require("electron-updater");
        const { SoftwareUpdate } = require(
          require("node:path").resolve("electron/software-update.cjs"),
        );
        const updater = new NsisUpdater();
        updater.logger = null;
        updater.app = {
          version: "0.1.21",
          name: "SVNX Test",
          isPackaged: true,
          userDataPath: directory,
          baseCachePath: directory,
          appUpdateConfigPath: require("node:path").join(
            directory,
            "app-update.yml",
          ),
          whenReady: () => Promise.resolve(),
          onQuit: () => {},
          quit: () => {
            throw new Error("test must not install");
          },
        };
        updater.updateConfigPath = updater.app.appUpdateConfigPath;
        updater.disableDifferentialDownload = true;
        globalThis.testSoftwareUpdate = new SoftwareUpdate({
          currentVersion: "0.1.21",
          mode: "installed",
          updater,
        });
        await globalThis.testSoftwareUpdate.check();
        globalThis.testSoftwareUpdate.download();
      },
      { directory, feed },
    );
    await expect
      .poll(
        () =>
          app.evaluate(() => globalThis.testSoftwareUpdate.snapshot().phase),
        { timeout: 15000 },
      )
      .toBe(bad ? "error" : "downloaded");
    if (bad)
      expect(
        await app.evaluate(
          () => globalThis.testSoftwareUpdate.snapshot().error,
        ),
      ).toContain("校验");
    await app.evaluate(() => globalThis.testSoftwareUpdate.dispose());
  }
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    globalThis.updateUiCalls = [];
    globalThis.updateUiBusy = true;
    let state = {
      currentVersion: "0.1.21",
      mode: "installed",
      phase: "idle",
      releaseUrl: "https://github.com/dmibing/svnx/releases/latest",
    };
    ipcMain.removeHandler("svnx:software-update");
    ipcMain.handle("svnx:software-update", (_, action) => {
      globalThis.updateUiCalls.push(action);
      if (action === "check")
        state = {
          ...state,
          phase: "available",
          version: "0.1.99",
          notes:
            '## 更新亮点\n\n- **慢悠悠散步**：猫咪走走停停\n\n<ul><li>偶尔追逐小老鼠</li></ul>\n<p>安装版支持<code>自定义目录</code>。<br>设置继续沿用。</p><script>window.releaseNoteExecuted=true</script><img src="https://example.invalid/remote.png" onerror="window.releaseNoteExecuted=true"><a href="javascript:alert(1)" onclick="alert(1)">普通文字</a>',
        };
      if (action === "download")
        state = { ...state, phase: "downloaded", progress: 100 };
      if (action === "install") {
        if (globalThis.updateUiBusy)
          return {
            ok: false,
            error: { message: "仍有 SVN 任务正在运行，请完成后再重启升级。" },
          };
        state = { ...state, phase: "installing" };
      }
      BrowserWindow.getAllWindows()[0].webContents.send("svnx:event", {
        type: "software-update",
        state,
      });
      return { ok: true, data: state };
    });
  });
  await page.getByRole("button", { name: /偏好设置/ }).click();
  await expect(
    page.getByText("界面语言：简体中文", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "查看发布页", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "检查软件更新", exact: true }).click();
  await page.getByText("版本更新说明", { exact: true }).click();
  const notes = page.locator(".software-update-notes");
  await expect(notes.getByRole("heading", { name: "更新亮点" })).toBeVisible();
  await expect(notes.locator("li")).toHaveCount(2);
  await expect(notes.locator("strong")).toHaveText("慢悠悠散步");
  await expect(notes.locator("code")).toHaveText("自定义目录");
  await expect(notes).not.toContainText("<ul>");
  await expect(
    notes.locator("script,img,iframe,style,[onclick],[href]"),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.releaseNoteExecuted)).toBeUndefined();
  await fs.mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/software-update-notes.png" });
  await page.getByRole("button", { name: "下载更新", exact: true }).click();
  await page
    .getByRole("button", { name: "重启并安装更新", exact: true })
    .click();
  expect(
    (await app.evaluate(() => globalThis.updateUiCalls)).includes("install"),
  ).toBe(false);
  await page.getByRole("button", { name: "确认重启安装", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("SVN 任务");
  await expect(
    page.getByRole("button", { name: "查看发布页", exact: true }),
  ).toBeVisible();
  await app.evaluate(() => (globalThis.updateUiBusy = false));
  await page.getByRole("button", { name: "确认重启安装", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("正在重启升级");
  console.log(
    "PASS: real updater downloads and verifies SHA512, rejects corrupt payload, explicit install confirmation, busy SVN guard and software update UI",
  );
} finally {
  if (app) await app.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(temp, { recursive: true, force: true });
}
