import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const { SvnService } = createRequire(import.meta.url)("../electron/svn.cjs");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-layout-"));
const root = path.join(temp, "wc"),
  data = path.join(temp, "data"),
  repo = path.join(temp, "repo");
let app;
try {
  await fs.mkdir(root);
  await fs.mkdir(data);
  for (const [command, args] of [
    ["svnadmin", ["create", repo]],
    ["svn", ["checkout", pathToFileURL(repo).href, "."]],
  ]) {
    const result = spawnSync(command, args, {
      cwd: root,
      windowsHide: true,
      detached: process.platform === "win32",
    });
    expect(result.status).toBe(0);
  }
  const service = new SvnService({
    backupDirectory: path.join(temp, "backup"),
  });
  const workspace = {
    ...(await service.inspect(root)),
    id: "layout",
    name: "Example.Desktop.Client",
  };
  await fs.writeFile(
    path.join(data, "settings.json"),
    JSON.stringify({
      version: 1,
      settings: {
        theme: "light",
        svnPath: "svn",
        listWidth: 370,
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
  await expect(page.locator(".diff-empty strong")).toHaveText(
    "暂无待提交的变更",
    { timeout: 30000 },
  );
  await expect(page.locator(".file-list .empty strong")).toHaveText("空空如也");
  await expect(
    page.locator(".sidebar-label").filter({ hasText: "当前项目" }),
  ).toHaveCount(0);
  await expect(page.locator(".list-summary")).toHaveCount(0);
  expect(
    await page
      .locator(".empty-state-art")
      .evaluate((image) => image.complete && image.naturalWidth === 44),
  ).toBe(true);
  await expect(page.locator(".change-panel")).toHaveCSS("width", "370px");
  await page.getByRole("separator", { name: "调整文件面板宽度" }).dblclick();
  await expect(page.locator(".change-panel")).toHaveCSS("width", "330px");
  const separator = page.getByRole("separator", { name: "调整文件面板宽度" });
  await separator.focus();
  for (let index = 0; index < 3; index++)
    await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".change-panel")).toHaveCSS("width", "280px");
  expect(
    (await page.locator(".file-toolbar .search-input").boundingBox()).width,
  ).toBeGreaterThanOrEqual(210);
  const narrowSearch = await page
    .locator(".file-toolbar .search-input")
    .boundingBox();
  const narrowFilter = await page
    .getByRole("combobox", { name: "状态筛选" })
    .boundingBox();
  expect(narrowFilter.y).toBeGreaterThan(narrowSearch.y);
  for (let index = 0; index < 12; index++)
    await page.keyboard.press("ArrowRight");
  await expect(page.locator(".change-panel")).toHaveCSS("width", "520px");
  const wideSearch = await page
    .locator(".file-toolbar .search-input")
    .boundingBox();
  const wideFilter = await page
    .getByRole("combobox", { name: "状态筛选" })
    .boundingBox();
  expect(Math.abs(wideSearch.y - wideFilter.y)).toBeLessThan(1);
  expect(wideSearch.width).toBeGreaterThan(300);
  await page.keyboard.press("Home");
  await expect(page.locator(".change-panel")).toHaveCSS("width", "330px");
  await page
    .getByRole("button", { name: "复制工作副本路径", exact: true })
    .click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe(root);
  await fs.mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/layout-empty-light.png" });
  await page.getByTitle("切换主题", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".changes-empty-art")).toHaveCSS(
    "filter",
    "invert(1)",
  );
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim(),
    ),
  ).toBe("#242424");
  await expect(page.locator(".empty-actions .button").first()).toHaveCSS(
    "background-color",
    "rgb(36, 36, 36)",
  );
  await page.screenshot({ path: "artifacts/layout-empty-dark.png" });
  await page
    .locator(".diff-empty")
    .getByRole("button", { name: "浏览文件", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .locator(".diff-empty")
    .getByRole("button", { name: "查看历史", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: /版本历史/ })).toBeVisible();
  await page.getByRole("button", { name: "本地变更", exact: true }).click();
  await fs.writeFile(path.join(root, "pending.txt"), "keep");
  await page
    .getByRole("button", { name: "刷新状态 (F5)", exact: true })
    .click();
  await expect(page.locator(".diff-empty")).toContainText("另有 1 个未跟踪项");
  await page
    .getByRole("button", { name: "查看未跟踪（1）", exact: true })
    .click();
  await expect(page.locator(".file-row")).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "搜索文件", exact: true })
    .fill("no-match");
  await expect(page.locator(".file-list .empty strong")).toHaveText(
    "当前筛选无结果",
  );
  await page
    .locator(".diff-empty")
    .getByRole("button", { name: "查看全部状态", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "搜索文件", exact: true }),
  ).toHaveValue("");
  await expect(page.locator(".diff-empty strong")).toHaveText(
    "暂无待提交的变更",
  );
  console.log(
    "PASS: clean and filtered states, contextual actions, path copy, saved width/reset, dark palette and simplified navigation",
  );
} finally {
  if (app) await app.close();
  await fs.rm(temp, { recursive: true, force: true });
}
