const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { SvnService } = require("../electron/svn.cjs");
test("own file commits can stale directory properties; selected-path sync preserves siblings and never commits", async () => {
  const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), "svnx-commit-recovery-"),
  );
  const root = path.join(temp, "wc"),
    repo = path.join(temp, "repo"),
    other = path.join(temp, "other");
  const cli = (command, args, cwd = root) => {
    const r = spawnSync(command, args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      detached: process.platform === "win32",
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  try {
    await fs.mkdir(root);
    cli("svnadmin", ["create", repo]);
    const url = pathToFileURL(repo).href;
    cli("svn", ["checkout", url, "."]);
    await fs.writeFile(path.join(root, "a.txt"), "base\n");
    await fs.writeFile(path.join(root, "b.txt"), "base\n");
    cli("svn", ["add", "a.txt", "b.txt"]);
    cli("svn", ["commit", "-m", "fixture"]);
    cli("svn", ["update"]);
    const service = new SvnService({
      backupDirectory: path.join(temp, "backup"),
    });
    service.register({ id: "test", path: root });
    const run = (method, params = {}) =>
      service.execute(method, { workspaceId: "test", ...params });
    const commit = async (paths) => {
      const plan = await run("commitPlan", { paths });
      return run("commit", {
        paths,
        fingerprint: plan.fingerprint,
        message: "self change",
      });
    };
    await fs.appendFile(path.join(root, "a.txt"), "self\n");
    await commit(["a.txt"]);
    assert.equal((await run("incoming")).count, 0);
    await run("setProperty", {
      path: "",
      name: "svn:ignore",
      value: "*.cache",
    });
    const plan = await run("commitPlan", { paths: [""] });
    await assert.rejects(
      run("commit", {
        paths: [""],
        fingerprint: plan.fingerprint,
        message: "directory rule",
      }),
      (error) => error.code === "OUT_OF_DATE",
    );
    cli("svn", ["checkout", url, other]);
    await fs.appendFile(path.join(other, "b.txt"), "remote sibling\n");
    cli("svn", ["commit", "-m", "sibling"], other);
    const youngest = cli("svnlook", ["youngest", repo]);
    await assert.rejects(
      run("syncCommit", { paths: [""], fingerprint: "0".repeat(64) }),
      (error) => error.code === "STALE",
    );
    await run("syncCommit", { paths: [""], fingerprint: plan.fingerprint });
    assert.equal(cli("svnlook", ["youngest", repo]), youngest);
    assert.equal(await fs.readFile(path.join(root, "b.txt"), "utf8"), "base\n");
    assert.equal(
      (await run("ignoreRules", { directory: "" })).own["svn:ignore"].trim(),
      "*.cache",
    );
    await commit([""]);
    // A real content conflict must remain a conflict and prevent another commit.
    cli("svn", ["update"], root);
    cli("svn", ["update"], other);
    await fs.writeFile(path.join(root, "a.txt"), "local different\n");
    await fs.writeFile(path.join(other, "a.txt"), "remote different\n");
    cli("svn", ["commit", "-m", "conflicting"], other);
    const conflictPlan = await run("commitPlan", { paths: ["a.txt"] });
    await run("syncCommit", {
      paths: ["a.txt"],
      fingerprint: conflictPlan.fingerprint,
    });
    assert.equal(
      (await run("status")).find((entry) => entry.path === "a.txt").status,
      "conflicted",
    );
    await assert.rejects(run("commitPlan", { paths: ["a.txt"] }), /冲突/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
