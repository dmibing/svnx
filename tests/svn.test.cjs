const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { SvnService, decode } = require("../electron/svn.cjs");
const { Scheduler } = require("../electron/scheduler.cjs");
let directory, root, other, url, service;
function cli(command, args, cwd) {
  const r = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    detached: process.platform === "win32",
    env: { ...process.env, LANG: "C.UTF-8" },
  });
  assert.equal(r.status, 0, `${command} ${args.join(" ")}\n${r.stderr}`);
  return r.stdout;
}
const exec = (method, params = {}) =>
  service.execute(method, { workspaceId: "test", ...params });
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-test-"));
  root = path.join(directory, "工作副本 @ one");
  other = path.join(directory, "other");
  const repo = path.join(directory, "repo");
  cli("svnadmin", ["create", repo]);
  url = pathToFileURL(repo).href;
  await fs.mkdir(root);
  cli("svn", ["checkout", url, "."], root);
  cli("svn", ["checkout", url, other]);
  service = new SvnService({
    backupDirectory: path.join(directory, "backups"),
  });
  service.register({ id: "test", path: root });
  await fs.writeFile(path.join(root, "中文 @ 文件.txt"), "first\nsecond\n");
  await fs.writeFile(path.join(root, "other.txt"), "original\n");
  await exec("add", { paths: ["中文 @ 文件.txt", "other.txt"] });
  const plan = await exec("commitPlan", {
    paths: ["中文 @ 文件.txt", "other.txt"],
  });
  await exec("commit", {
    paths: plan.paths,
    fingerprint: plan.fingerprint,
    message: "初始文件",
  });
});
after(async () => {
  if (directory) {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
test("version, root detection and canonical paths", async () => {
  assert.match(await service.version(), /^1\./);
  const w = await service.inspect(root);
  assert.equal(w.path, await fs.realpath(root));
  assert.equal((await exec("info")).revision, 0);
});
test("incoming detects remote changes without updating local files", async () => {
  const repo = path.join(directory, "incoming-repo");
  const writer = path.join(directory, "incoming-writer");
  const reader = path.join(directory, "incoming-reader");
  cli("svnadmin", ["create", repo]);
  cli("svn", ["checkout", pathToFileURL(repo).href, writer]);
  await fs.writeFile(path.join(writer, "待更新.txt"), "before\n");
  cli("svn", ["add", "待更新.txt"], writer);
  cli("svn", ["commit", "-m", "initial"], writer);
  cli("svn", ["checkout", pathToFileURL(repo).href, reader]);
  const monitor = new SvnService({
    backupDirectory: path.join(directory, "incoming-backups"),
  });
  monitor.register({ id: "incoming", path: reader });
  assert.equal(
    (await monitor.execute("incoming", { workspaceId: "incoming" })).count,
    0,
  );
  await fs.writeFile(path.join(writer, "待更新.txt"), "after\n");
  await fs.writeFile(path.join(writer, "新增.txt"), "new\n");
  cli("svn", ["add", "新增.txt"], writer);
  cli("svn", ["commit", "-m", "remote changes"], writer);
  const incoming = await monitor.execute("incoming", {
    workspaceId: "incoming",
  });
  assert.equal(incoming.count, 2);
  assert.equal(
    await fs.readFile(path.join(reader, "待更新.txt"), "utf8"),
    "before\n",
  );
  await assert.rejects(fs.stat(path.join(reader, "新增.txt")), {
    code: "ENOENT",
  });
  await monitor.execute("update", {
    workspaceId: "incoming",
    paths: [""],
    revision: "HEAD",
  });
  assert.equal(
    (await monitor.execute("incoming", { workspaceId: "incoming" })).count,
    0,
  );
});
test("partial commit excludes unchecked sibling and preserves special paths", async () => {
  await fs.appendFile(path.join(root, "中文 @ 文件.txt"), "third\n");
  await fs.appendFile(path.join(root, "other.txt"), "not selected\n");
  const files = await exec("status");
  assert.equal(files.length, 2);
  const plan = await exec("commitPlan", { paths: ["中文 @ 文件.txt"] });
  assert.deepEqual(plan.paths, ["中文 @ 文件.txt"]);
  await exec("commit", {
    paths: plan.paths,
    fingerprint: plan.fingerprint,
    message: "仅提交一个文件",
  });
  assert.deepEqual(
    (await exec("status")).map((f) => f.path),
    ["other.txt"],
  );
  const diff = await exec("diff", { path: "other.txt" });
  assert.equal(diff.before, "original\n");
  assert.ok(diff.after.includes("not selected"));
});
test("stale preview blocks commit", async () => {
  const plan = await exec("commitPlan", { paths: ["other.txt"] });
  await fs.appendFile(path.join(root, "other.txt"), "changed after preview\n");
  await assert.rejects(
    exec("commit", {
      paths: plan.paths,
      fingerprint: plan.fingerprint,
      message: "should fail",
    }),
    (e) => e.code === "STALE",
  );
});
test("revert backs up contents and restores without deleting untracked files", async () => {
  const before = await fs.readFile(path.join(root, "other.txt"), "utf8");
  await fs.writeFile(path.join(root, "keep.txt"), "untracked\n");
  const plan = await exec("revertPlan", { paths: ["other.txt"] });
  const result = await exec("revert", {
    paths: plan.paths,
    fingerprint: plan.fingerprint,
  });
  assert.equal(
    await fs.readFile(path.join(root, "other.txt"), "utf8"),
    "original\n",
  );
  assert.equal(
    await fs.readFile(path.join(root, "keep.txt"), "utf8"),
    "untracked\n",
  );
  await exec("restoreBackup", { backupId: result.backupId });
  assert.equal(await fs.readFile(path.join(root, "other.txt"), "utf8"), before);
});
test("ignore and property changes are real SVN properties", async () => {
  await exec("ignore", { directory: "", patterns: ["*.tmp"] });
  await fs.writeFile(path.join(root, "hidden.tmp"), "ignored");
  assert.ok(!(await exec("status")).some((f) => f.path === "hidden.tmp"));
  const props = await exec("properties", { path: "" });
  assert.ok(props.find((p) => p.name === "svn:ignore").value.includes("*.tmp"));
  await exec("setProperty", {
    path: "other.txt",
    name: "custom:note",
    value: "中文属性",
  });
  assert.equal(
    (await exec("properties", { path: "other.txt" })).find(
      (p) => p.name === "custom:note",
    ).value,
    "中文属性",
  );
});
test("path traversal and .svn access are rejected", async () => {
  for (const p of ["../outside", ".svn/wc.db", "sub/../../outside"])
    await assert.rejects(exec("diff", { path: p }));
  await assert.rejects(service.guard(root, "../outside"));
  await assert.rejects(exec("delete", { paths: [""] }));
});
test("new parent directory dependencies and exact depth commit", async () => {
  await fs.mkdir(path.join(root, "new dir"));
  await fs.writeFile(path.join(root, "new dir", "chosen.txt"), "chosen");
  await fs.writeFile(path.join(root, "new dir", "unchecked.txt"), "unchecked");
  await exec("add", { paths: ["new dir/chosen.txt", "new dir/unchecked.txt"] });
  const plan = await exec("commitPlan", { paths: ["new dir/chosen.txt"] });
  assert.ok(plan.paths.includes("new dir"));
  await exec("commit", {
    paths: plan.paths,
    fingerprint: plan.fingerprint,
    message: "新增目录仅选一个文件",
  });
  assert.ok(
    (await exec("status")).find(
      (f) => f.path === "new dir/unchecked.txt" && f.status === "added",
    ),
  );
});
test("history pagination, revision diff and rename history", async () => {
  const history = await exec("log", { path: "中文 @ 文件.txt", limit: 2 });
  assert.equal(history.length, 2);
  const rev = history[0].revision;
  const repositoryPath = history[0].paths.find((p) =>
    p.path.includes("中文"),
  ).path;
  const diff = await exec("diff", {
    path: "中文 @ 文件.txt",
    repositoryPath,
    peg: rev,
    oldRevision: String(rev - 1),
    newRevision: String(rev),
  });
  assert.ok(diff.after.includes("third"));
  assert.ok(!diff.before.includes("third"));
  await exec("move", { path: "中文 @ 文件.txt", destination: "renamed.txt" });
  const plan = await exec("commitPlan", {
    paths: ["中文 @ 文件.txt", "renamed.txt"],
  });
  await exec("commit", {
    paths: plan.paths,
    fingerprint: plan.fingerprint,
    message: "重命名保留历史",
  });
  assert.ok((await exec("log", { path: "renamed.txt" })).length >= 3);
});
test("conflict is preserved on update and resolves from explicit content", async () => {
  cli("svn", ["update", `${other}@`]);
  await fs.writeFile(path.join(other, "renamed.txt"), "incoming\n");
  cli("svn", [
    "commit",
    "-m",
    "remote change",
    `${path.join(other, "renamed.txt")}@`,
  ]);
  await fs.writeFile(path.join(root, "renamed.txt"), "local\n");
  await exec("update", { paths: [""], revision: "HEAD" });
  const files = await exec("status");
  assert.equal(
    files.find((f) => f.path === "renamed.txt").status,
    "conflicted",
  );
  const conflict = await exec("conflict", { path: "renamed.txt" });
  assert.ok(conflict.kinds.includes("text"));
  await exec("resolve", {
    path: "renamed.txt",
    kind: "text",
    accept: "working",
    fingerprint: conflict.fingerprint,
    content: "merged\n",
  });
  assert.equal(
    (await exec("status")).find((f) => f.path === "renamed.txt").status,
    "modified",
  );
  assert.equal(
    await fs.readFile(path.join(root, "renamed.txt"), "utf8"),
    "merged\n",
  );
});
test("binary and oversized content are not silently decoded or truncated", async () => {
  await fs.writeFile(path.join(root, "binary.bin"), Buffer.from([1, 0, 2, 3]));
  assert.equal((await exec("diff", { path: "binary.bin" })).binary, true);
  await fs.writeFile(
    path.join(root, "large.txt"),
    Buffer.alloc(5 * 1024 * 1024 + 1, 65),
  );
  assert.equal((await exec("diff", { path: "large.txt" })).large, true);
});
test("encoding detection preserves UTF-8, BOM and GB18030", () => {
  const iconv = require("iconv-lite");
  assert.equal(decode(iconv.encode("中文", "gb18030")).text, "中文");
  assert.equal(decode(Buffer.from([239, 187, 191, 65])).bom, true);
  assert.equal(decode(Buffer.from([255, 254, 65, 0])).encoding, "utf-16le");
});
test("scheduler serializes overlapping roots and supports queued cancellation", async () => {
  const scheduler = new Scheduler();
  const order = [];
  let release;
  const a = scheduler.submit(
    "a",
    root,
    () =>
      new Promise((resolve) => {
        release = () => {
          order.push("a");
          resolve();
        };
      }),
  );
  const b = scheduler.submit("b", path.join(root, "nested"), async () =>
    order.push("b"),
  );
  const c = scheduler.submit("c", other, async () => order.push("c"));
  await c;
  assert.deepEqual(order, ["c"]);
  await Promise.resolve();
  release();
  await Promise.all([a, b]);
  assert.deepEqual(order, ["c", "a", "b"]);
  let unblock;
  const d = scheduler.submit(
    "d",
    root,
    () =>
      new Promise((r) => {
        unblock = r;
      }),
  );
  const e = scheduler.submit("e", root, () => {});
  scheduler.cancel("e");
  await assert.rejects(e);
  await Promise.resolve();
  unblock();
  await d;
});

test("direct delete skips backups while normal delete keeps them", async () => {
  const direct = "direct-delete.txt",
    protectedFile = "backup-delete.txt";
  for (const file of [direct, protectedFile])
    await fs.writeFile(path.join(root, file), "local changes\n");
  await exec("add", { paths: [direct, protectedFile] });
  const original = service.backup.create.bind(service.backup);
  let created = 0;
  service.backup.create = async (...args) => {
    created++;
    return original(...args);
  };
  try {
    const result = await exec("delete", { paths: [direct], backup: false });
    assert.equal(result.backupId, undefined);
    assert.equal(created, 0);
    await assert.rejects(fs.stat(path.join(root, direct)), { code: "ENOENT" });
    const backedUp = await exec("delete", { paths: [protectedFile] });
    assert.ok(backedUp.backupId);
    assert.equal(created, 1);
    await assert.rejects(
      exec("delete", { paths: [""], backup: false }),
      /不能删除工作副本根目录/,
    );
  } finally {
    service.backup.create = original;
  }
});
