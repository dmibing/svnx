const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { SvnService } = require("../electron/svn.cjs");
test("combined untrack-and-ignore keeps files, handles Chinese literal names and multiple parents without replacing old rules", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-untrack-ignore-"));
  const root = path.join(temp, "wc"),
    repo = path.join(temp, "repo");
  const cli = (cmd, args) => {
    const r = spawnSync(cmd, args, {
      cwd: root,
      encoding: "utf8",
      detached: process.platform === "win32",
      windowsHide: true,
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  try {
    await fs.mkdir(root);
    cli("svnadmin", ["create", repo]);
    cli("svn", ["checkout", pathToFileURL(repo).href, "."]);
    await fs.mkdir(path.join(root, "产物[1]"));
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "产物[1]/a.txt"), "keep");
    await fs.writeFile(path.join(root, "src/local.json"), "keep");
    cli("svn", ["add", "产物[1]", "src"]);
    cli("svn", ["commit", "-m", "fixture"]);
    cli("svn", ["update"]);
    const s = new SvnService({ backupDirectory: path.join(temp, "backup") });
    s.register({ id: "test", path: root });
    const run = (method, data) =>
      s.execute(method, { workspaceId: "test", ...data });
    await run("ignore", { directory: "", patterns: ["*.tmp"] });
    await fs.writeFile(path.join(root, "pending.txt"), "pending");
    await assert.rejects(
      run("untrackAndIgnore", { paths: ["src/local.json", "pending.txt"] }),
    );
    assert.ok(
      !(await run("status", {})).some((entry) => entry.status === "deleted"),
    );
    await assert.rejects(run("untrackAndIgnore", { paths: [""] }));
    await run("untrackAndIgnore", {
      paths: ["产物[1]", "产物[1]/a.txt", "src/local.json"],
    });
    assert.equal(
      await fs.readFile(path.join(root, "产物[1]/a.txt"), "utf8"),
      "keep",
    );
    assert.equal(
      await fs.readFile(path.join(root, "src/local.json"), "utf8"),
      "keep",
    );
    const rules = await run("ignoreRules", { directory: "" });
    assert.match(rules.own["svn:ignore"], /\*\.tmp/);
    cli("svn", ["commit", "-m", "untrack and ignore"]);
    const entries = await run("status", { showIgnored: true });
    assert.equal(
      entries.find((entry) => entry.path === "产物[1]").status,
      "ignored",
    );
    assert.equal(
      entries.find((entry) => entry.path === "src/local.json").status,
      "ignored",
    );
    assert.equal(
      await fs.readFile(path.join(root, "产物[1]/a.txt"), "utf8"),
      "keep",
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
