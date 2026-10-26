import { chromium, expect } from "@playwright/test";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const execute = promisify(execFile);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-portable-test-"));
const version = JSON.parse(await fs.readFile("package.json", "utf8")).version;
const server = net.createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
let child, browser;
try {
  await fs.writeFile(
    path.join(temp, "settings.json"),
    JSON.stringify({
      version: 1,
      settings: { theme: "dark", svnPath: "svn", autoCheckUpdates: false },
      workspaces: [],
    }),
  );
  child = spawn(
    path.resolve(`release/SVNX-${version}-win-x64-portable.exe`),
    [`--remote-debugging-port=${port}`],
    {
      env: { ...process.env, SVNX_TEST_DATA: temp, SVNX_DEV_URL: "" },
      stdio: "ignore",
    },
  );
  const exit = new Promise((resolve) => child.once("exit", resolve));
  const processes = async () => {
    const { stdout } = await execute(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `@(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${child.pid}' | Select-Object Name,ProcessId,ExecutablePath) | ConvertTo-Json -Compress`,
      ],
      { windowsHide: true },
    );
    const value = stdout.trim() ? JSON.parse(stdout) : [];
    return Array.isArray(value) ? value : [value];
  };
  let helper;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    helper =
      (await processes()).find(
        (process) => process.Name === "SVNX.Startup.exe",
      ) || helper;
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
        timeout: 1000,
      });
      break;
    } catch {
      await delay(100);
    }
  }
  expect(
    helper,
    "Portable launcher must start the animated window",
  ).toBeTruthy();
  expect(browser, "Portable application must reach Chromium").toBeTruthy();
  const page = browser.contexts()[0].pages()[0];
  await expect(page.locator(".welcome")).toBeVisible({ timeout: 30000 });
  const pluginDirectory = path.dirname(helper.ExecutablePath);
  await expect
    .poll(() =>
      fs
        .readFile(path.join(pluginDirectory, "startup.ready"), "utf8")
        .catch(() => ""),
    )
    .toBe("ready");
  await expect
    .poll(async () =>
      (await processes()).some(
        (process) => process.Name === "SVNX.Startup.exe",
      ),
    )
    .toBe(false);
  // Closing the actual main window also lets NSIS remove its temporary payload.
  await page.evaluate(() => window.close()).catch(() => {});
  await browser.close();
  browser = null;
  await expect.poll(() => child.exitCode, { timeout: 15000 }).not.toBeNull();
  expect(await exit).toBe(0);
  await expect
    .poll(
      () =>
        fs
          .stat(pluginDirectory)
          .then(() => true)
          .catch(() => false),
      { timeout: 30000 },
    )
    .toBe(false);
  console.log(
    "PASS: actual single EXE extracts, starts native animation, hands off to ready UI, closes helper and removes temporary payload",
  );
} finally {
  if (browser) {
    for (const context of browser.contexts())
      for (const page of context.pages()) await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  if (child && child.exitCode === null) child.kill();
  await fs.rm(temp, { recursive: true, force: true });
}
