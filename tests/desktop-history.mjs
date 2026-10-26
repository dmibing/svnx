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
  await expect(page.getByRole("heading", { name: /本地变更/ })).toBeVisible({
    timeout: 30000,
  });
  // A deterministic large remote history tests rendering and page requests;
  // real SVN pagination is covered separately by the integration suite.
  await app.evaluate(({ ipcMain }) => {
    globalThis.historyRequests = [];
    globalThis.historyDiffRequests = [];
    ipcMain.removeHandler("svnx:run");
    ipcMain.handle("svnx:run", async (_, request) => {
      if (request.method === "diff") {
        globalThis.historyDiffRequests.push(request.params);
        return {
          ok: true,
          data: {
            path: request.params.path,
            before: `original ${request.params.path}`,
            after: `modified ${request.params.path}`,
          },
        };
      }
      if (request.method === "info") return { ok: true, data: {} };
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
            paths:
              start - index === 1199
                ? Array.from({ length: 1000 }, (_, i) => ({
                    path: `/src/generated/file${i}.cs`,
                    action: "M",
                    kind: "file",
                  }))
                : [
                    { path: "/src/a.cs", action: "M", kind: "file" },
                    {
                      path: "/src/nested/b.vue",
                      action: "A",
                      kind: "file",
                      copyFrom: "/old/b.vue",
                      copyRevision: 1190,
                    },
                    { path: "/README.md", action: "D", kind: "file" },
                  ],
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
  const historySearch = page.getByRole("textbox", { name: "搜索已加载历史" });
  await historySearch.fill("历史提交 1198");
  await page.locator(".history-row").click();
  await page.getByRole("combobox", { name: "原始版本", exact: true }).click();
  await page.getByRole("option", { name: "r1196", exact: true }).click();
  await page
    .locator(".historical-path")
    .filter({ hasText: "/src/a.cs" })
    .click();
  const files = page.getByRole("listbox", { name: "本次提交文件" });
  await expect(files.getByRole("option")).toHaveCount(3);
  await expect(files.getByRole("option", { selected: true })).toContainText(
    "a.cs",
  );
  await expect(page.locator(".history-files-range")).toHaveText(
    "比较 r1196 → r1198",
  );
  await files.getByRole("option").filter({ hasText: "b.vue" }).click();
  await expect(page.locator(".diff-heading")).toContainText("b.vue");
  await expect(files.getByRole("option", { selected: true })).toContainText(
    "b.vue",
  );
  await files.getByRole("option").filter({ hasText: "README.md" }).click();
  await expect
    .poll(
      async () =>
        (await app.evaluate(() => globalThis.historyDiffRequests)).at(-1)
          ?.repositoryPath,
    )
    .toBe("/README.md");
  const lastDiff = (
    await app.evaluate(() => globalThis.historyDiffRequests)
  ).at(-1);
  expect(lastDiff.oldRevision).toBe("1196");
  expect(lastDiff.newRevision).toBe("1198");
  expect(lastDiff.peg).toBe(1197);
  expect(lastDiff.commit).toBeUndefined();
  await page.getByRole("textbox", { name: "搜索本次提交文件" }).fill("nested");
  await expect(files.getByRole("option")).toHaveCount(1);
  await files.focus();
  await page.keyboard.press("Home");
  await expect(page.locator(".diff-heading")).toContainText("b.vue");
  await page.getByRole("textbox", { name: "搜索本次提交文件" }).fill("");
  await page.screenshot({ path: "artifacts/history-commit-files-light.png" });
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "artifacts/history-commit-files-dark.png" });
  await page.getByRole("button", { name: "返回历史记录", exact: true }).click();
  await expect(historySearch).toHaveValue("历史提交 1198");
  await expect(
    page.locator(".history-row.selected .history-revision"),
  ).toHaveText("r1198");
  expect((await app.evaluate(() => globalThis.historyRequests)).length).toBe(
    20,
  );
  await historySearch.fill("历史提交 1199");
  await page.locator(".history-row").click();
  await page.locator(".historical-path").first().click();
  await expect(
    page.locator(".history-files-list [role=option]").first(),
  ).toBeVisible();
  expect(
    await page.locator(".history-files-list [role=option]").count(),
  ).toBeLessThan(40);
  await page.getByRole("listbox", { name: "本次提交文件" }).focus();
  await page.keyboard.press("End");
  await expect(
    page.locator(".history-files-list [role=option][aria-selected=true]"),
  ).toContainText("file999.cs");
  await expect(page.locator(".diff-heading")).toContainText("file999.cs");
  await page.getByRole("button", { name: "返回历史记录", exact: true }).click();
  await page.locator(".history-row").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "与上一版本比较", exact: true })
    .click();
  await page.getByRole("dialog").locator(".historical-path").first().click();
  await expect(page.locator(".history-files-title")).toContainText("r1199");
  await expect(page.locator(".history-files-range")).toHaveText(
    "比较 r1198 → r1199",
  );
  console.log(
    "PASS: 1000 revisions, lazy paging, commit files navigation, custom range, deleted peg, search, keyboard, 1000-path virtualization, preserved history and context-menu entry",
  );
} finally {
  if (app) await app.close();
  await fs.rm(temp, { recursive: true, force: true });
}
