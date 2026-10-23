const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { SvnService } = require("../electron/svn.cjs");
test("ignore editor reads inherited rules, previews without mutation, replaces and clears safely", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-ignore-"));
  const root = path.join(temp, "wc"),
    repo = path.join(temp, "repo");
  const cli = (cmd, args, cwd) => {
    const r = spawnSync(cmd, args, {
      cwd,
      encoding: "utf8",
      detached: process.platform === "win32",
      windowsHide: true,
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  try {
    cli("svnadmin", ["create", repo]);
    await fs.mkdir(root);
    cli("svn", ["checkout", pathToFileURL(repo).href, "."], root);
    await fs.mkdir(path.join(root, "child"));
    await fs.writeFile(path.join(root, "tracked.tmp"), "tracked");
    cli("svn", ["add", "child", "tracked.tmp"], root);
    cli("svn", ["commit", "-m", "fixture"], root);
    const service = new SvnService({
      backupDirectory: path.join(temp, "backups"),
    });
    service.register({ id: "test", path: root });
    const run = (method, data = {}) =>
      service.execute(method, { workspaceId: "test", directory: "", ...data });
    let data = await run("ignoreRules");
    await run("saveIgnoreRules", {
      property: "svn:global-ignores",
      value: "*.tmp",
      fingerprint: data.fingerprint,
    });
    let child = await run("ignoreRules", { directory: "child" });
    assert.ok(
      child.inherited.some(
        (p) => p.value.includes("*.tmp") && p.source === root,
      ),
    );
    await fs.writeFile(path.join(root, "pending.log"), "keep");
    await fs.writeFile(path.join(root, "child", "nested.log"), "keep");
    await fs.mkdir(path.join(root, "untracked"));
    await fs.writeFile(path.join(root, "untracked", "deep.log"), "keep");
    const before = await run("ignoreRules");
    const local = await run("ignorePreview", {
      property: "svn:ignore",
      value: "*.log",
    });
    assert.deepEqual(
      local.matches.map((p) => p.path),
      ["pending.log"],
    );
    const recursive = await run("ignorePreview", {
      property: "svn:global-ignores",
      value: "*.log",
    });
    assert.deepEqual(recursive.matches.map((p) => p.path).sort(), [
      "child/nested.log",
      "pending.log",
      "untracked/deep.log",
    ]);
    assert.deepEqual(await run("ignoreRules"), before);
    assert.equal(
      (
        await run("ignorePreview", { property: "svn:ignore", value: "*.tmp" })
      ).matches.some((p) => p.path === "tracked.tmp"),
      false,
    );
    await run("saveIgnoreRules", {
      directory: "child",
      property: "svn:ignore",
      value: "*.log\nspace name.tmp",
      fingerprint: child.fingerprint,
    });
    child = await run("ignoreRules", { directory: "child" });
    assert.ok(child.own["svn:ignore"].includes("space name.tmp"));
    assert.equal(child.own["svn:ignore"].includes("&#13;"), false);
    assert.deepEqual(child.own["svn:ignore"].trim().split("\n"), [
      "*.log",
      "space name.tmp",
    ]);
    await assert.rejects(
      run("saveIgnoreRules", {
        directory: "child",
        property: "svn:ignore",
        value: "*.txt",
        fingerprint: before.fingerprint,
      }),
      /规则已被其他操作修改/,
    );
    await run("saveIgnoreRules", {
      directory: "child",
      property: "svn:ignore",
      value: "",
      fingerprint: child.fingerprint,
    });
    assert.equal(
      (await run("ignoreRules", { directory: "child" })).own["svn:ignore"],
      "",
    );
    assert.equal(
      await fs.readFile(path.join(root, "pending.log"), "utf8"),
      "keep",
    );
    assert.match(
      cli("svn", ["log", "--xml", "-l", "1", pathToFileURL(repo).href], root),
      /revision="1"/,
    );
    await assert.rejects(run("ignoreRules", { directory: ".." }));
    await assert.rejects(
      run("ignorePreview", { property: "svn:ignore", value: "path/*.log" }),
      /按文件名匹配/,
    );
    await fs.mkdir(path.join(root, "发布文件"));
    await fs.writeFile(path.join(root, "发布文件", "本地产物.txt"), "keep");
    await run("ignore", { patterns: ["发布文件"] });
    assert.equal(
      (await run("status")).some((entry) => entry.path === "发布文件"),
      false,
    );
    assert.equal(
      (await run("status", { showIgnored: true })).find(
        (entry) => entry.path === "发布文件",
      )?.status,
      "ignored",
    );
    const chineseRules = await run("ignoreRules");
    assert.match(chineseRules.own["svn:ignore"], /发布文件/);
    await fs.mkdir(path.join(root, "child", "中文缓存"));
    await run("saveIgnoreRules", {
      property: "svn:global-ignores",
      value: "中文缓存",
      fingerprint: chineseRules.fingerprint,
    });
    assert.equal(
      (await run("status", { showIgnored: true })).find(
        (entry) => entry.path === "child/中文缓存",
      )?.status,
      "ignored",
    );
    assert.equal(
      await fs.readFile(path.join(root, "发布文件", "本地产物.txt"), "utf8"),
      "keep",
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
