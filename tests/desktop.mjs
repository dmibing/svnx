import { _electron as electron, expect } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { SvnService } = require("../electron/svn.cjs");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-desktop-"));
const repo = path.join(directory, "repo"),
  root = path.join(directory, "工作空间"),
  dataRoot = path.join(directory, "data");
function cli(command, args, cwd) {
  const r = spawnSync(command, args, {
    cwd,
    detached: process.platform === "win32",
    windowsHide: true,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}
let app;
const originalCsharp = [
  "namespace Sample;",
  "public class View",
  "{",
  ...Array.from({ length: 240 }, (_, i) =>
    i === 150
      ? '    public string Title => "Original title";'
      : `    // unchanged line ${i}`,
  ),
  "}",
].join("\n");
try {
  cli("svnadmin", ["create", repo]);
  await fs.mkdir(root);
  cli("svn", ["checkout", pathToFileURL(repo).href, "."], root);
  const service = new SvnService({
    backupDirectory: path.join(directory, "backups"),
  });
  service.register({ id: "integration", path: root });
  for (const [name, text] of Object.entries({
    "路由.ts": 'export const title = "工作空间";\n',
    "设置.ts": 'export const theme = "system";\n',
    "README.md": "# 工作空间\n",
    "theme.css": ":root { color: #333; }\n",
    "View.Designer.cs": originalCsharp,
  }))
    await fs.writeFile(path.join(root, name), text);
  await service.execute("add", {
    workspaceId: "integration",
    paths: ["路由.ts", "设置.ts", "README.md", "theme.css", "View.Designer.cs"],
  });
  const plan = await service.execute("commitPlan", {
    workspaceId: "integration",
    paths: ["路由.ts", "设置.ts", "README.md", "theme.css", "View.Designer.cs"],
  });
  await service.execute("commit", {
    workspaceId: "integration",
    paths: plan.paths,
    fingerprint: plan.fingerprint,
    message: "初始化工作空间",
  });
  await fs.writeFile(
    path.join(root, "路由.ts"),
    'export const title = "SVNX 工作空间";\nexport const history = true;\n',
  );
  await fs.appendFile(path.join(root, "README.md"), "\n支持真实 SVN 操作。\n");
  await fs.writeFile(path.join(root, "新增.txt"), "新文件\n");
  await fs.writeFile(
    path.join(root, "View.Designer.cs"),
    originalCsharp.replace("Original title", "Updated title"),
  );
  await fs.mkdir(dataRoot);
  const w = {
    ...(await service.inspect(root)),
    id: "integration",
    name: "工作空间",
  };
  await fs.writeFile(
    path.join(dataRoot, "settings.json"),
    JSON.stringify({
      version: 1,
      settings: {
        theme: "light",
        svnPath: "svn",
        listWidth: 330,
        externalTool: "",
        locale: "zh-CN",
      },
      workspaces: [w],
    }),
  );
  app = await electron.launch({
    args: ["."],
    env: { ...process.env, SVNX_TEST_DATA: dataRoot, SVNX_DEV_URL: "" },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.getByRole("heading", { name: /本地变更/ })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText("4 个变更文件", { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByRole("combobox", { name: "状态筛选" })).toHaveText(
    "修改",
  );
  await expect(page.locator(".file-row")).toHaveCount(3);
  await expect(page.locator(".nav-item .count")).toHaveText("3");
  await expect(page.locator(".workspace-tabs .tab span").first()).toHaveText(
    "3",
  );
  await page.getByRole("combobox", { name: "状态筛选" }).click();
  await page.getByRole("option", { name: "全部状态", exact: true }).click();
  await expect(page.locator(".file-row")).toHaveCount(4);
  await expect(page.locator(".nav-item .count")).toHaveText("4");
  await expect(page.locator(".monaco-diff-editor")).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator(".workspace-heading")).toHaveCSS("height", "74px");
  await expect(page.locator(".file-row").first()).toHaveCSS("height", "44px");
  await fs.mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/desktop-light.png" });
  const firstFile = page.locator(".file-row").first();
  const fileBounds = await firstFile.boundingBox();
  await firstFile.click({ button: "right", position: { x: 90, y: 15 } });
  const fileMenu = page.getByRole("menu", { name: "文件操作", exact: true });
  await expect(fileMenu).toBeVisible();
  const menuBounds = await fileMenu.boundingBox();
  expect(Math.abs(menuBounds.x - (fileBounds.x + 90))).toBeLessThan(3);
  expect(Math.abs(menuBounds.y - (fileBounds.y + 15))).toBeLessThan(3);
  await page.getByRole("heading", { name: /本地变更/ }).click();
  await expect(fileMenu).toHaveCount(0);
  await page.getByRole("button", { name: "更多文件操作", exact: true }).click();
  await expect(fileMenu).toBeVisible();
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  const moreBounds = await fileMenu.boundingBox();
  expect(moreBounds.y + moreBounds.height).toBeLessThanOrEqual(
    viewport.height - 7,
  );
  await page.keyboard.press("Escape");
  await expect(fileMenu).toHaveCount(0);
  for (const checkbox of await page.locator(".file-row input:checked").all())
    await checkbox.uncheck();
  await page
    .getByRole("textbox", { name: "搜索文件", exact: true })
    .fill("路由");
  await expect(page.locator(".file-row")).toHaveCount(1);
  await expect(page.locator(".nav-item .count")).toHaveText("1");
  await expect(page.locator(".workspace-tabs .tab span").first()).toHaveText(
    "1",
  );
  await page
    .getByRole("textbox", { name: "搜索文件", exact: true })
    .fill("不存在的文件");
  await expect(page.locator(".nav-item .count")).toHaveText("0");
  await page.getByRole("textbox", { name: "搜索文件", exact: true }).fill("");
  await page
    .locator(".file-row")
    .filter({ hasText: "View.Designer.cs" })
    .click();
  await expect(page.locator('[aria-label="文件差异编辑器"]')).toHaveAttribute(
    "data-language",
    "csharp",
  );
  await expect(
    page.locator(".monaco-diff-editor .modified .view-lines"),
  ).toContainText("Updated title", { timeout: 10000 });
  await expect
    .poll(() =>
      page
        .locator(".monaco-diff-editor .modified .view-lines")
        .evaluate((root) =>
          [...root.querySelectorAll("span")].some(
            (span) =>
              span.textContent === "public" &&
              getComputedStyle(span).color !== "rgb(0, 0, 0)",
          ),
        ),
    )
    .toBe(true);
  await page.screenshot({ path: "artifacts/csharp-first-change.png" });
  await page
    .getByRole("checkbox", { name: "选择 路由.ts", exact: true })
    .check();
  await page.getByRole("button", { name: "提交变更 1", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "提交 1 个路径", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("提交说明", { exact: true })
    .fill("完善路由\n补充历史入口");
  await page
    .getByRole("button", { name: "提交 1 个路径", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "提交成功", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog").locator(".plan-file")).toContainText(
    "路由.ts",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "完成", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByText("3 个变更文件", { exact: true })).toBeVisible();
  await page
    .locator(".workspace-actions")
    .getByRole("button", { name: /^更新/ })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "更新", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "更新结果", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "完成", exact: true })
    .click();
  await page.getByRole("button", { name: /偏好设置/ }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("combobox", { name: "更新检测间隔" }).click();
  await page.getByRole("option", { name: "每 10 分钟", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "更新检测间隔" })).toHaveText(
    "每 10 分钟",
  );
  await page.getByRole("checkbox", { name: "自动检测", exact: true }).uncheck();
  await expect(
    page.getByRole("combobox", { name: "更新检测间隔" }),
  ).toBeDisabled();
  const monitorSettings = await page.evaluate(
    async () => (await window.svnx.bootstrap()).data.settings,
  );
  expect(monitorSettings.autoCheckUpdates).toBe(false);
  expect(monitorSettings.updateCheckMinutes).toBe(10);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("combobox", { name: "状态筛选" }).click();
  await expect(page.locator(".select-content")).toHaveCSS(
    "background-color",
    "rgb(32, 32, 32)",
  );
  await expect(page.locator(".select-content")).toHaveCSS(
    "color",
    "rgb(232, 232, 232)",
  );
  await page.keyboard.press("Escape");
  const contrast = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const lum = (hex) => {
      const rgb = hex
        .trim()
        .replace("#", "")
        .match(/../g)
        .map((c) => parseInt(c, 16) / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const background = lum(style.getPropertyValue("--bg"));
    return ["--text", "--soft", "--muted"].map((name) => {
      const l = lum(style.getPropertyValue(name));
      return (
        (Math.max(l, background) + 0.05) / (Math.min(l, background) + 0.05)
      );
    });
  });
  expect(Math.min(...contrast)).toBeGreaterThanOrEqual(4.5);
  await expect(page.locator(".file-name>span").first()).toHaveCSS(
    "font-size",
    "14px",
  );
  await page.screenshot({ path: "artifacts/desktop-dark.png" });
  await page.getByRole("button", { name: "版本历史", exact: true }).click();
  await expect(page.locator(".history-row").first()).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator(".history-row").first()).toContainText("完善路由");
  await page.locator(".history-row").first().click({ button: "right" });
  await expect(page.getByRole("menu", { name: "历史记录操作" })).toBeVisible();
  await page.getByRole("menuitem", { name: /还原到此版本/ }).click();
  await expect(page.locator("#update-revision")).toHaveValue("2");
  await expect(page.getByRole("dialog")).toContainText("不修改服务器历史");
  await page.keyboard.press("Escape");
  await page.locator(".history-row").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "与上一版本比较" }).click();
  await expect(page.locator(".monaco-diff-editor")).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole("button", { name: /返回历史/ }).click();
  await expect(
    page.getByRole("combobox", { name: "原始版本", exact: true }),
  ).toHaveText("r1");
  await page.getByRole("combobox", { name: "目标版本", exact: true }).click();
  await page.getByRole("option", { name: "r1", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "目标版本", exact: true }),
  ).toHaveText("r1");
  await expect(page.locator(".history-row").first()).toHaveCSS(
    "height",
    "58px",
  );
  await page.screenshot({ path: "artifacts/desktop-history.png" });
  await page.locator(".workspace-tabs .tab").first().click();
  await page.locator(".file-row").filter({ hasText: "README.md" }).click();
  await page.getByRole("button", { name: "所选路径历史", exact: true }).click();
  await expect(page.locator(".history-list .history-row")).toHaveCount(1);
  await expect(page.locator(".filter-row")).toContainText("README.md");
  await expect(page.locator(".history-list .history-row")).toContainText(
    "初始化工作空间",
  );
  await page
    .locator(".historical-path")
    .filter({ hasText: "/README.md" })
    .click();
  await expect(page.locator(".historical-sidebar")).toBeVisible();
  await page.getByRole("button", { name: "所选路径历史", exact: true }).click();
  await expect(page.locator(".history-list .history-row")).toHaveCount(1);
  await expect(page.locator(".historical-sidebar")).toHaveCount(0);
  await page.locator(".workspace-tabs .tab").first().click();
  await page.getByRole("combobox", { name: "状态筛选" }).click();
  await page.getByRole("option", { name: "未跟踪", exact: true }).click();
  await page.locator(".file-row").filter({ hasText: "新增.txt" }).click();
  await page.getByRole("button", { name: "更多文件操作" }).click();
  await page
    .getByRole("menuitem", { name: "添加到版本控制", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "状态筛选" })).toHaveText(
    "修改",
  );
  await expect(
    page.locator(".file-row").filter({ hasText: "README.md" }),
  ).toBeVisible();
  await expect(
    page.locator(".file-row").filter({ hasText: "新增.txt" }),
  ).toBeVisible();
  const addedFiles = await service.execute("status", {
    workspaceId: "integration",
  });
  expect(addedFiles.find((file) => file.path === "新增.txt")?.status).toBe(
    "added",
  );
  const bridgeState = await page.evaluate(() => ({
    node: typeof window.require,
    bridge: typeof window.svnx,
    theme: document.documentElement.dataset.theme,
  }));
  expect(bridgeState.node).toBe("undefined");
  expect(bridgeState.bridge).toBe("object");
  const files = await service.execute("status", { workspaceId: "integration" });
  expect(files.some((f) => f.path === "路由.ts")).toBe(false);
  expect(files.some((f) => f.path === "README.md")).toBe(true);
  const remoteWriter = path.join(directory, "remote-writer");
  cli("svn", ["checkout", pathToFileURL(repo).href, remoteWriter]);
  await fs.writeFile(path.join(remoteWriter, "远端新增.txt"), "remote file\n");
  cli("svn", ["add", "远端新增.txt"], remoteWriter);
  cli("svn", ["commit", "-m", "remote update"], remoteWriter);
  await page.getByRole("button", { name: /偏好设置/ }).click();
  await page.getByRole("checkbox", { name: "自动检测", exact: true }).check();
  await expect(
    page.getByRole("combobox", { name: "更新检测间隔" }),
  ).toBeEnabled();
  await page.getByRole("combobox", { name: "更新检测间隔" }).click();
  await page.getByRole("option", { name: "每 5 分钟", exact: true }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator(".incoming-count")).toHaveText("1", {
    timeout: 15000,
  });
  await assertFileNotDownloaded();
  async function assertFileNotDownloaded() {
    try {
      await fs.stat(path.join(root, "远端新增.txt"));
      throw new Error("自动检测不应下载文件");
    } catch (error) {
      expect(error.code).toBe("ENOENT");
    }
  }
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          "打包页面加载",
          "隔离 preload",
          "utilityProcess 真实 SVN",
          "74px 顶栏",
          "44px 文件行",
          "Monaco 本地 worker",
          "文件搜索",
          "多行提交说明",
          "只提交所选文件",
          "深色主题",
          "真实提交历史",
          "远端更新数量与自动检测开关、间隔保存",
          "新增与修改统一显示并保留状态标识",
          "C# 语法高亮",
          "自动定位首处差异",
          "紧凑历史行",
          "深色正文对比度至少 4.5:1",
        ],
        browserErrors: errors,
      },
      null,
      2,
    ),
  );
} finally {
  if (app) await app.close();
  if (path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep))
    await fs.rm(directory, { recursive: true, force: true });
}
