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
  let page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".file-row")).toHaveCount(3, { timeout: 30000 });
  await page.getByRole("button", { name: "文件树显示", exact: true }).click();
  await expect(page.locator(".tree-folder")).toHaveCount(2);
  await page
    .getByRole("checkbox", { name: "选择目录 src", exact: true })
    .check();
  await expect(page.locator(".list-summary")).toContainText("已选择 2 个文件");
  await page.locator('.tree-folder-label[title="src"]').click();
  await expect(page.locator(".file-row")).toHaveCount(2);
  await expect(page.locator(".list-summary")).toContainText("已选择 2 个文件");
  await page
    .getByRole("textbox", { name: "搜索文件", exact: true })
    .fill("b.vue");
  await expect(page.locator(".tree-folder")).toHaveCount(2);
  await expect(page.locator(".file-row:not(.tree-folder)")).toHaveCount(1);
  await page.getByRole("textbox", { name: "搜索文件", exact: true }).fill("");
  await page
    .getByRole("checkbox", { name: "选择目录 src", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "选择 src/a.cs", exact: true })
    .check();
  await page
    .locator(".file-row:not(.tree-folder)")
    .filter({ hasText: "a.cs" })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "停止跟踪（保留本地文件）", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("不会自动提交");
  await page
    .getByRole("button", { name: "停止跟踪并保留本地文件", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await fs.readFile(path.join(root, "src/a.cs"), "utf8")).toBe(
    "original\nmodified\n",
  );
  expect(cli("svn", ["status", "--xml", "src/a.cs"])).toContain(
    'item="deleted"',
  );
  await fs.mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/file-tree-light.png" });
  await page.evaluate(() => localStorage.setItem("svnx.fileLayout", "tree"));
  await page.reload();
  await expect(
    page.getByRole("button", { name: "文件树显示", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "平铺显示", exact: true }).click();
  await expect(page.locator(".tree-folder")).toHaveCount(0);
  await fs.mkdir(path.join(root, "ThirdParty", ".mimosa"), { recursive: true });
  await fs.writeFile(
    path.join(root, "ThirdParty", "library.cs"),
    "class Library {}\n",
  );
  await fs.writeFile(
    path.join(root, "ThirdParty", ".mimosa", "notes.md"),
    "notes\n",
  );
  await page.keyboard.press("F5");
  await page.getByRole("combobox", { name: "状态筛选" }).click();
  await page.getByRole("option", { name: /^未跟踪/ }).click();
  const directory = page
    .locator(".file-row")
    .filter({ has: page.locator('.file-name[title="ThirdParty"]') });
  await expect(directory.locator("svg.lucide-folder")).toBeVisible();
  await expect(
    page.locator('.file-name[title="ThirdParty/library.cs"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "文件树显示", exact: true }).click();
  await expect(
    page.locator('.tree-folder-label[title="ThirdParty"]'),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.locator('.tree-folder-label[title="ThirdParty/.mimosa"]'),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "搜索文件", exact: true })
    .fill("notes.md");
  await page
    .locator(".file-row:not(.tree-folder)")
    .filter({ hasText: "notes.md" })
    .click();
  await expect(
    page.locator(".monaco-diff-editor .modified .view-lines"),
  ).toContainText("notes");
  await page.getByRole("textbox", { name: "搜索文件", exact: true }).fill("");
  await page.screenshot({ path: "artifacts/unversioned-directories.png" });
  expect(errors).toEqual([]);
  console.log(
    "PASS: tree grouping, group selection, collapse, search, layout persistence and real keep-local untrack",
  );
} finally {
  if (app) await app.close();
  await fs.rm(temp, { recursive: true, force: true });
}
