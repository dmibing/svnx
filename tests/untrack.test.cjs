const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { SvnService } = require("../electron/svn.cjs");
test("stop tracking keeps modified and unversioned directory contents and requires a separate commit", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-untrack-"));
  const root = path.join(temp, "wc"),
    repo = path.join(temp, "repo");
  const cli = (cmd, args, cwd) => {
    const result = spawnSync(cmd, args, {
      cwd,
      encoding: "utf8",
      detached: process.platform === "win32",
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  try {
    cli("svnadmin", ["create", repo]);
    await fs.mkdir(root);
    cli("svn", ["checkout", pathToFileURL(repo).href, "."], root);
    await fs.mkdir(path.join(root, "产物"));
    await fs.writeFile(path.join(root, "产物/a.txt"), "original");
    cli("svn", ["add", "产物"], root);
    cli("svn", ["commit", "-m", "fixture"], root);
    await fs.writeFile(path.join(root, "产物/a.txt"), "modified");
    await fs.writeFile(path.join(root, "产物/private.txt"), "untracked");
    const service = new SvnService({
      backupDirectory: path.join(temp, "backups"),
    });
    service.register({ id: "test", path: root });
    const run = (paths) =>
      service.execute("untrack", { workspaceId: "test", paths });
    await assert.rejects(run([""]));
    await assert.rejects(run(["../outside"]));
    await assert.rejects(run(["产物/a.txt", "产物/private.txt"]));
    assert.doesNotMatch(cli("svn", ["status"], root), /^D/m);
    await run(["产物", "产物/a.txt"]);
    assert.equal(
      await fs.readFile(path.join(root, "产物/a.txt"), "utf8"),
      "modified",
    );
    assert.equal(
      await fs.readFile(path.join(root, "产物/private.txt"), "utf8"),
      "untracked",
    );
    assert.match(cli("svn", ["status"], root), /^D/m);
    assert.match(
      cli("svn", ["list", "--xml", pathToFileURL(repo).href]),
      /产物/,
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
