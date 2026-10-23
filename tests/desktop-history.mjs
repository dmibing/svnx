import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const { SvnService } = createRequire(import.meta.url)("../electron/svn.cjs");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-tree-ui-"));
const root = path.join(temp, "wc"),
  repo = path.join(temp, "repo"),
  data = path.join(temp, "data");
const cli = (cmd, args) => {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    detached: process.platform === "win32",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
};
let app;
try {
  await fs.mkdir(root);
  await fs.mkdir(data);
  cli("svnadmin", ["create", repo]);
  cli("svn", ["checkout", pathToFileURL(repo).href, "."]);
  await fs.mkdir(path.join(root, "src/nested"), { recursive: true });
  for (const name of ["src/a.cs", "src/nested/b.vue", "README.md"])
    await fs.writeFile(path.join(root, name), "original\n");
  cli("svn", ["add", "src", "README.md"]);
  cli("svn", ["commit", "-m", "fixture"]);
  for (const name of ["src/a.cs", "src/nested/b.vue", "README.md"])
    await fs.appendFile(path.join(root, name), "modified\n");
  const service = new SvnService({
    backupDirectory: path.join(temp, "backups"),
  });
  const workspace = {
    ...(await service.inspect(root)),
    id: "fixture",
    name: "测试项目",
  };
  await fs.writeFile(
    path.join(data, "settings.json"),
    JSON.stringify({
      version: 1,
      settings: {
        theme: "light",
        svnPath: "svn",
        listWidth: 370,
        locale: "zh-CN",
        autoCheckUpdates: false,
      },
      workspaces: [workspace],
    }),
  );
  app = await electron.launch({
    args: ["."],
    env: { ...process.env, SVNX_TEST_DATA: data, SVNX_DEV_URL: "" },
  });
  const page = await app.firstWindow();
  await expect(
    page.getByRole("heading", { name: /本地变更/ }),
  ).toBeVisible({ timeout: 30000 });
  // A deterministic large remote history tests rendering and page requests;
  // real SVN pagination is covered separately by the integration suite.
  await app.evaluate(({ ipcMain }) => {
    globalThis.historyRequests = [];
    ipcMain.removeHandler("svnx:run");
    ipcMain.handle("svnx:run", async (_, request) => {
      if (request.method !== "log") return { ok: true, data: [] };
      globalThis.historyRequests.push(request.params);
      await new Promise((resolve) => setTimeout(resolve, 80));
      const start = request.params.start ?? 1200;
      return {
        ok: true,
        data: Array.from(
          { length: Math.min(request.params.limit, start) },
          (_, index) => ({
            revision: start - index,
            author: "tester",
            date: "2023-03-24T10:18:00Z",
            message: `历史提交 ${start - index}`,
            paths: [{ path: "/README.md", action: "M", kind: "file" }],
          }),
        ),
      };
    });
  });
  await page.getByRole("button", { name: "版本历史", exact: true }).click();
  await expect(page.locator(".history-row").first()).toContainText(
    "2023/03/24",
  );
  await expect(page.locator(".change-panel .filter-row")).toContainText(
    "50 条记录",
  );
  expect(await page.locator(".history-row").count()).toBeLessThan(35);
  expect((await app.evaluate(() => globalThis.historyRequests)).length).toBe(1);
  await page.locator(".history-list").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator(".change-panel .filter-row")).toContainText(
    "100 条记录",
  );
  await expect(page.locator(".revision-detail h2")).toHaveText("历史提交 1200");
  for (let index = 0; index < 18; index++) {
    await page
      .getByRole("button", { name: "加载更多（50 条）", exact: true })
      .click();
    await expect(page.locator(".change-panel .filter-row")).toContainText(
      `${150 + index * 50} 条记录`,
    );
  }
  expect(await page.locator(".history-row").count()).toBeLessThan(35);
  const requests = await app.evaluate(() => globalThis.historyRequests);
  expect(requests).toHaveLength(20);
  expect(requests.every((request) => request.limit === 50)).toBe(true);
  expect(new Set(requests.map((request) => request.start)).size).toBe(20);
  await page
    .getByRole("textbox", { name: "搜索已加载历史" })
    .fill("历史提交 1200");
  await expect(page.locator(".history-row")).toHaveCount(1);
  await expect(page.locator(".history-row")).toContainText("历史提交 1200");
  await fs.mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/history-virtual.png" });
  console.log(
    "PASS: 1000 loaded revisions, bounded DOM, 50-item lazy pages, year, preserved selection and search",
  );
} finally {
  if (app) await app.close();
  await fs.rm(temp, { recursive: true, force: true });
}
