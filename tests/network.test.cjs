const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { run } = require("../electron/runner.cjs");
test("svnserve authentication uses stdin and never caches supplied passwords", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-auth-"));
  let server;
  try {
    const repo = path.join(directory, "repo");
    assert.equal(
      spawnSync("svnadmin", ["create", repo], { windowsHide: true }).status,
      0,
    );
    const secret = randomUUID();
    await fs.writeFile(
      path.join(repo, "conf", "svnserve.conf"),
      "[general]\nanon-access = none\nauth-access = write\npassword-db = passwd\nrealm = svnx-integration\n",
    );
    await fs.writeFile(
      path.join(repo, "conf", "passwd"),
      `[users]\ntester = ${secret}\n`,
    );
    const port = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.listen(0, "127.0.0.1", () => {
        const port = probe.address().port;
        probe.close(() => resolve(port));
      });
    });
    server = spawn(
      "svnserve",
      [
        "--daemon",
        "--foreground",
        "--listen-host",
        "127.0.0.1",
        "--listen-port",
        String(port),
        "--root",
        directory,
      ],
      { windowsHide: true },
    );
    server.on("error", () => {});
    await new Promise((resolve, reject) => {
      const until = Date.now() + 5000;
      const connect = () => {
        const socket = net.connect(port, "127.0.0.1");
        socket.on("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.on("error", () => {
          socket.destroy();
          if (Date.now() > until) reject(new Error("svnserve 启动失败"));
          else setTimeout(connect, 50);
        });
      };
      connect();
    });
    const url = `svn://127.0.0.1:${port}/repo`;
    await assert.rejects(
      run("svn", ["info", "--xml", url]),
      (e) => e.code === "AUTH",
    );
    const result = await run("svn", ["info", "--xml", url], {
      credentials: { username: "tester", password: secret },
    });
    assert.ok(result.toString().includes("<info>"));
    await assert.rejects(
      run("svn", ["info", "--xml", url], {
        credentials: { username: "tester", password: "incorrect" },
      }),
      (e) => e.code === "AUTH" && !e.message.includes(secret),
    );
    await assert.rejects(
      run("svn", ["info", "--xml", url]),
      (e) => e.code === "AUTH",
    );
  } finally {
    server?.kill();
    if (server)
      await new Promise((resolve) => {
        if (server.exitCode !== null) return resolve();
        server.once("exit", resolve);
      });
    assert.ok(
      path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    await fs.rm(directory, { recursive: true, force: true });
  }
});
