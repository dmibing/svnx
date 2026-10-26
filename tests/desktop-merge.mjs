import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const { SvnService } = createRequire(import.meta.url)("../electron/svn.cjs");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-merge-ui-"));
const root = path.join(temp, "wc"),
  repo = path.join(temp, "repo"),
  other = path.join(temp, "other"),
  data = path.join(temp, "data");
const cli = (cmd, args, cwd = root) => {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    detached: process.platform === "win32",
    windowsHide: true,
  });
  if (result.status !== 0) throw Error(result.stderr);
  return result.stdout;
};
let app;
try {
  await fs.mkdir(root);
  await fs.mkdir(data);
  cli("svnadmin", ["create", repo]);
  const url = pathToFileURL(repo).href;
  cli("svn", ["checkout", url, "."]);
  const original =
    Array.from({ length: 100 }, (_, index) =>
      index === 20
        ? "// first = BASE"
        : index === 70
          ? "// second = BASE"
          : `// unchanged ${index}`,
    ).join("\n") + "\n";
  await fs.writeFile(path.join(root, "Merge.cs"), original);
  await fs.writeFile(path.join(root, "notes.ts"), "export const n = 1;\n");
  cli("svn", ["add", "Merge.cs", "notes.ts"]);
  cli("svn", ["commit", "-m", "fixture"]);
  cli("svn", ["checkout", url, other]);
  await fs.writeFile(
    path.join(root, "Merge.cs"),
    original
      .replace("first = BASE", "first = LOCAL")
      .replace("second = BASE", "second = LOCAL"),
  );
  await fs.writeFile(
    path.join(other, "Merge.cs"),
    original
      .replace("first = BASE", "first = REMOTE")
      .replace("second = BASE", "second = REMOTE"),
  );
  cli("svn", ["commit", "-m", "remote"], other);
  cli("svn", ["update"]);
  await fs.appendFile(path.join(root, "notes.ts"), "// pending\n");
  const service = new SvnService({
    backupDirectory: path.join(data, "backups"),
  });
  const workspace = {
    ...(await service.inspect(root)),
    id: "fixture",
    name: "Merge project",
  };
  service.register(workspace);
  const initial = await fs.readFile(path.join(root, "Merge.cs"), "utf8");
  await fs.writeFile(
    path.join(data, "settings.json"),
    JSON.stringify({
      version: 1,
      settings: {
        theme: "dark",
        svnPath: "svn",
        listWidth: 330,
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
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByRole("combobox", { name: "状态筛选" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("combobox", { name: "状态筛选" }).click();
  await page.getByRole("option", { name: "全部变更", exact: true }).click();
  await page.locator(".file-row").filter({ hasText: "Merge.cs" }).click();
  await expect(page.locator(".merge-view")).toBeVisible();
  await expect(page.locator(".merge-block-toolbar")).toContainText(
    "剩余 2 个冲突块",
  );
  const resultArea = page.locator(
    ".merge-result .monaco-editor textarea.inputarea",
  );
  await expect(resultArea).toHaveCount(1, { timeout: 20000 });
  await expect(
    page.getByRole("button", { name: "保存并标记解决", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "使用右侧全部内容", exact: true })
    .click();
  await expect(page.locator(".merge-block-toolbar")).toContainText(
    "冲突标记已清除",
  );
  await resultArea.focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".merge-block-toolbar")).toContainText(
    "剩余 2 个冲突块",
  );
  for (const name of ["本块先左后右", "本块先右后左"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator(".merge-block-toolbar")).toContainText(
      "剩余 1 个冲突块",
    );
    await resultArea.focus();
    await page.keyboard.press("Control+z");
    await expect(page.locator(".merge-block-toolbar")).toContainText(
      "剩余 2 个冲突块",
    );
  }
  await page.getByRole("button", { name: "本块采用左侧", exact: true }).click();
  await expect(page.locator(".merge-block-toolbar")).toContainText(
    "剩余 1 个冲突块",
  );
  await page.getByRole("button", { name: "本块采用右侧", exact: true }).click();
  await expect(page.locator(".merge-block-toolbar")).toContainText(
    "冲突标记已清除",
  );
  await resultArea.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("// manual merge\n");
  await page.locator(".file-row").filter({ hasText: "notes.ts" }).click();
  await page.locator(".file-row").filter({ hasText: "Merge.cs" }).click();
  await expect(page.locator(".merge-note")).toContainText("恢复");
  expect(await fs.readFile(path.join(root, "Merge.cs"), "utf8")).toBe(initial);
  await fs.mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/merge-editor-dark.png" });
  await page
    .getByRole("button", { name: "保存并标记解决", exact: true })
    .click();
  await expect(page.locator(".merge-view")).toHaveCount(0);
  const saved = await fs.readFile(path.join(root, "Merge.cs"), "utf8");
  expect(saved).toContain("first = LOCAL");
  expect(saved).toContain("second = REMOTE");
  expect(saved).toContain("// manual merge");
  expect(saved).not.toContain("<<<<<<<");
  expect(
    (await service.execute("status", { workspaceId: workspace.id })).find(
      (entry) => entry.path === "Merge.cs",
    ).status,
  ).toBe("modified");
  expect(cli("svnlook", ["youngest", repo]).trim()).toBe("2");
  expect(
    (await service.execute("backups", { workspaceId: workspace.id })).length,
  ).toBeGreaterThan(0);
  await page
    .locator(".file-row")
    .filter({ hasText: "notes.ts" })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", {
      name: "停止跟踪并忽略（保留本地文件）",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText("添加忽略规则");
  await page
    .getByRole("button", { name: "停止跟踪并添加忽略", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await fs.readFile(path.join(root, "notes.ts"), "utf8")).toContain(
    "// pending",
  );
  expect(
    (
      await service.execute("ignoreRules", {
        workspaceId: workspace.id,
        directory: "",
      })
    ).own["svn:ignore"],
  ).toContain("notes.ts");
  expect(errors).toEqual([]);
  console.log(
    "PASS: real SVN multi-block merge, side choice, undo, manual edit, navigation draft, backup, resolve and combined untrack shortcut",
  );
} finally {
  if (app) await app.close();
  await fs.rm(temp, { recursive: true, force: true });
}
