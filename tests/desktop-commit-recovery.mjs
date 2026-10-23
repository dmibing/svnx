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
  service.register(workspace);
  await service.execute("setProperty", {
    workspaceId: workspace.id,
    path: "",
    name: "svn:ignore",
    value: "*.cache",
  });
  app = await electron.launch({
    args: ["."],
    env: { ...process.env, SVNX_TEST_DATA: data, SVNX_DEV_URL: "" },
  });
  const page = await app.firstWindow();
  await expect(
    page.getByRole("checkbox", { name: "选择 工作副本根目录", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("checkbox", { name: "选择 工作副本根目录", exact: true })
    .check();
  await page
    .locator(".workspace-actions")
    .getByRole("button", { name: /^提交/ })
    .click();
  await page.locator("#message").fill("保留这条提交说明\n第二行");
  await page
    .getByRole("button", { name: "提交 1 个路径", exact: true })
    .click();
  await expect(page.locator(".commit-recovery")).toContainText(
    "基础版本已过期",
  );
  await expect(page.locator("#message")).toHaveValue(
    "保留这条提交说明\n第二行",
  );
  await page
    .getByRole("button", { name: "拉取所选路径并重新检查", exact: true })
    .click();
  await expect(page.locator(".commit-recovery")).toHaveCount(0);
  await expect(page.locator("#message")).toHaveValue(
    "保留这条提交说明\n第二行",
  );
  await expect(page.getByRole("dialog")).toContainText(
    "请核对提交范围后再次确认提交",
  );
  expect(cli("svnlook", ["youngest", repo]).trim()).toBe("1");
  await fs.mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/commit-recovery.png" });
  await page
    .getByRole("button", { name: "提交 1 个路径", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "提交成功", exact: true }),
  ).toBeVisible();
  expect(cli("svnlook", ["youngest", repo]).trim()).toBe("2");
  console.log(
    "PASS: real out-of-date recovery preserves message, updates selected scope, and requires explicit commit confirmation",
  );
} finally {
  if (app) await app.close();
  await fs.rm(temp, { recursive: true, force: true });
}
