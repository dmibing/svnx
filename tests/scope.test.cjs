const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { SvnService } = require("../electron/svn.cjs");
const { Scheduler } = require("../electron/scheduler.cjs");
function cli(args, cwd) {
  const result = spawnSync("svn", args, {
    cwd,
    windowsHide: true,
    detached: process.platform === "win32",
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
test("selected subdirectory bounds status, diff, commit, revert, update and shared-WC scheduling", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-scope-"));
  const root = path.join(temp, "wc"),
    other = path.join(temp, "other"),
    repo = path.join(temp, "repo");
  try {
    assert.equal(
      spawnSync("svnadmin", ["create", repo], { windowsHide: true }).status,
      0,
    );
    const url = pathToFileURL(repo).href;
    cli(["checkout", url, root]);
    const a = path.join(root, "子项目 A"),
      b = path.join(root, "子项目 B");
    await fs.mkdir(a);
    await fs.mkdir(b);
    await fs.writeFile(path.join(a, "Main.cs"), "a base\n");
    await fs.writeFile(path.join(b, "Main.cs"), "b base\n");
    await fs.writeFile(path.join(root, "root.txt"), "root base\n");
    cli(["add", "--force", "."], root);
    cli(["commit", "-m", "seed", "."], root);
    const service = new SvnService({
      backupDirectory: path.join(temp, "backups"),
    });
    const scopeA = { ...(await service.inspect(a)), id: "a" },
      scopeB = { ...(await service.inspect(b)), id: "b" };
    service.register(scopeA);
    service.register(scopeB);
    service.register({ id: "root", path: root });
    const scoped = (method, params = {}) =>
      service.execute(method, { workspaceId: "a", ...params });
    assert.equal(scopeA.path, await fs.realpath(a));
    assert.equal(scopeA.name, "子项目 A");
    assert.equal(scopeA.wcRoot, await fs.realpath(root));
    assert.equal(service.wcRoots.get("a"), service.wcRoots.get("b"));
    await fs.writeFile(path.join(a, "Main.cs"), "a edited\n");
    await fs.writeFile(path.join(b, "Main.cs"), "b edited\n");
    await fs.writeFile(path.join(root, "root.txt"), "root edited\n");
    assert.deepEqual(
      (await scoped("status")).map((f) => f.path),
      ["Main.cs"],
    );
    assert.equal((await scoped("info")).path, scopeA.path);
    assert.deepEqual(
      (await scoped("tree", { path: "" })).map((f) => f.name),
      ["Main.cs"],
    );
    assert.equal(
      (await scoped("diff", { path: "Main.cs" })).before,
      "a base\n",
    );
    await assert.rejects(scoped("diff", { path: "../子项目 B/Main.cs" }));
    const plan = await scoped("commitPlan", { paths: ["Main.cs"] });
    assert.deepEqual(plan.paths, ["Main.cs"]);
    await scoped("commit", {
      paths: plan.paths,
      fingerprint: plan.fingerprint,
      message: "only selected child",
    });
    assert.deepEqual(
      (await service.execute("status", { workspaceId: "root" }))
        .map((f) => f.path)
        .sort(),
      ["root.txt", "子项目 B/Main.cs"].sort(),
    );
    await fs.writeFile(path.join(a, "Main.cs"), "a discard\n");
    const revert = await scoped("revertPlan", { paths: ["Main.cs"] });
    await scoped("revert", {
      paths: revert.paths,
      fingerprint: revert.fingerprint,
    });
    assert.equal(
      await fs.readFile(path.join(a, "Main.cs"), "utf8"),
      "a edited\n",
    );
    assert.equal(
      await fs.readFile(path.join(b, "Main.cs"), "utf8"),
      "b edited\n",
    );
    cli(["checkout", url, other]);
    await fs.writeFile(path.join(other, "子项目 A", "Main.cs"), "a incoming\n");
    await fs.writeFile(path.join(other, "子项目 B", "Main.cs"), "b incoming\n");
    cli(["commit", "-m", "incoming", "."], other);
    await scoped("update", { paths: [""], revision: "HEAD" });
    assert.equal(
      await fs.readFile(path.join(a, "Main.cs"), "utf8"),
      "a incoming\n",
    );
    assert.equal(
      await fs.readFile(path.join(b, "Main.cs"), "utf8"),
      "b edited\n",
    );
    assert.equal(
      (await service.execute("diff", { workspaceId: "b", path: "Main.cs" }))
        .before,
      "b base\n",
    );
    assert.equal(
      await fs.readFile(path.join(root, "root.txt"), "utf8"),
      "root edited\n",
    );
    const scheduler = new Scheduler();
    let finishA,
      bStarted = false;
    const first = scheduler.submit(
      "a",
      service.wcRoots.get("a"),
      () =>
        new Promise((resolve) => {
          finishA = resolve;
        }),
    );
    const second = scheduler.submit("b", service.wcRoots.get("b"), async () => {
      bStarted = true;
    });
    await Promise.resolve();
    assert.equal(bStarted, false);
    finishA();
    await Promise.all([first, second]);
    assert.equal(bStarted, true);
  } finally {
    assert.ok(
      path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    await fs.rm(temp, { recursive: true, force: true });
  }
});
