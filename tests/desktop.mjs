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
  }))
    await fs.writeFile(path.join(root, name), text);
  await service.execute("add", {
    workspaceId: "integration",
    paths: ["路由.ts", "设置.ts", "README.md", "theme.css"],
  });
  const plan = await service.execute("commitPlan", {
    workspaceId: "integration",
    paths: ["路由.ts", "设置.ts", "README.md", "theme.css"],
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
  await expect(page.getByText("3 个变更文件", { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator(".monaco-diff-editor")).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator(".workspace-heading")).toHaveCSS("height", "74px");
  await expect(page.locator(".file-row").first()).toHaveCSS("height", "44px");
  await fs.mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/desktop-light.png" });
  await page
    .getByRole("textbox", { name: "搜索文件", exact: true })
    .fill("路由");
  await expect(page.locator(".file-row")).toHaveCount(1);
  await page.getByRole("textbox", { name: "搜索文件", exact: true }).fill("");
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
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByText("2 个变更文件", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /偏好设置/ }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.screenshot({ path: "artifacts/desktop-dark.png" });
  await page.getByRole("button", { name: "版本历史", exact: true }).click();
  await expect(page.locator(".history-row").first()).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator(".history-row").first()).toContainText("完善路由");
  await page.screenshot({ path: "artifacts/desktop-history.png" });
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
