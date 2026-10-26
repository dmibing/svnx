const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { SvnService } = require("../electron/svn.cjs");

test("status expands unversioned directories, previews children and adds overlapping selections", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-unversioned-"));
  const root = path.join(temp, "wc");
  const cli = (command, args, cwd = root) => {
    const result = spawnSync(command, args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    const repo = path.join(temp, "repo");
    cli("svnadmin", ["create", repo], temp);
    cli("svn", ["checkout", pathToFileURL(repo).href, root], temp);
    cli("svn", ["propset", "svn:ignore", "ignored", "."]);
    cli("svn", ["propset", "svn:global-ignores", "*.cache cache-dir", "."]);
    await fs.mkdir(path.join(root, "ThirdParty", "sub"), { recursive: true });
    await fs.mkdir(path.join(root, "ThirdParty", "cache-dir"));
    await fs.writeFile(
      path.join(root, "ThirdParty", "sub", "visible.cs"),
      "class Visible {}\n",
    );
    await fs.writeFile(
      path.join(root, "ThirdParty", "sub", "hidden.cache"),
      "ignored",
    );
    await fs.writeFile(
      path.join(root, "ThirdParty", "cache-dir", "secret.txt"),
      "ignored",
    );
    await fs.mkdir(path.join(root, "ignored"));
    await fs.writeFile(path.join(root, "ignored", "private.txt"), "ignored");
    await fs.mkdir(path.join(root, ".dsh-tmp", "中文 @ nested", "empty"), {
      recursive: true,
    });
    for (let i = 0; i < 20; i++) {
      await fs.writeFile(
        path.join(root, ".dsh-tmp", `file${i}.txt`),
        "pending\n",
      );
    }
    const deep = ".dsh-tmp/中文 @ nested/deep.txt";
    await fs.writeFile(path.join(root, deep), "deep content\n");
    for (let i = 0; i < 6; i++) {
      await fs.writeFile(path.join(root, `loose${i}.txt`), "loose\n");
    }
    cli("svn", ["checkout", pathToFileURL(repo).href, "nested-wc"]);
    await fs.writeFile(
      path.join(root, "nested-wc", "private.txt"),
      "separate wc",
    );
    const service = new SvnService({
      backupDirectory: path.join(temp, "backups"),
    });
    service.register({ id: "test", path: root });
    const run = (method, data = {}) =>
      service.execute(method, { workspaceId: "test", ...data });
    const status = await run("status");
    const untracked = status.filter((entry) => entry.status === "unversioned");
    assert.equal(untracked.filter((entry) => !entry.directory).length, 28);
    assert.equal(
      untracked.find((entry) => entry.path === "ThirdParty").directory,
      true,
    );
    assert.ok(
      untracked.some((entry) => entry.path === "ThirdParty/sub/visible.cs"),
    );
    assert.ok(
      !status.some(
        (entry) =>
          entry.path.endsWith("hidden.cache") ||
          entry.path.includes("cache-dir"),
      ),
    );
    assert.equal(
      untracked.find((entry) => entry.path === ".dsh-tmp").directory,
      true,
    );
    assert.equal(
      untracked.find((entry) => entry.path === ".dsh-tmp/中文 @ nested/empty")
        .directory,
      true,
    );
    assert.ok(untracked.some((entry) => entry.path === deep));
    assert.equal(
      new Set(status.map((entry) => entry.path)).size,
      status.length,
    );
    assert.ok(!status.some((entry) => entry.path.startsWith("ignored")));
    assert.ok(!status.some((entry) => entry.path.startsWith("nested-wc/")));
    const withIgnored = await run("status", { showIgnored: true });
    assert.equal(
      withIgnored.find((entry) => entry.path === "ThirdParty/sub/hidden.cache")
        .status,
      "ignored",
    );
    assert.equal(
      withIgnored.find((entry) => entry.path === "ThirdParty/cache-dir")
        .directory,
      true,
    );
    assert.ok(
      !withIgnored.some(
        (entry) => entry.path === "ThirdParty/cache-dir/secret.txt",
      ),
    );
    assert.equal(
      withIgnored.find((entry) => entry.path === "ignored").status,
      "ignored",
    );
    assert.ok(
      !withIgnored.some((entry) => entry.path === "ignored/private.txt"),
    );
    const diff = await run("diff", { path: deep });
    assert.equal(diff.before, "");
    assert.equal(diff.after, "deep content\n");
    await run("add", {
      paths: [deep, ".dsh-tmp", ".dsh-tmp/中文 @ nested", deep],
    });
    const added = await run("status");
    assert.equal(added.find((entry) => entry.path === deep).status, "added");
    assert.equal(
      added.find((entry) => entry.path === ".dsh-tmp/file19.txt").status,
      "added",
    );
    assert.equal(
      added.find((entry) => entry.path === "loose0.txt").status,
      "unversioned",
    );
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith("svnx-unversioned-"));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
