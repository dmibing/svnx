import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), "svnx-native-startup-"),
);
const executable = path.resolve("build/startup/SVNX.Startup.exe");
const children = [];
function launch(parent, name, reduced = false) {
  const ready = path.join(directory, name + ".ready");
  const probe = path.join(directory, name + ".log");
  const child = spawn(
    executable,
    [String(parent), ready, probe, ...(reduced ? ["--reduced-motion"] : [])],
    {
      stdio: "ignore",
    },
  );
  const exit = new Promise((resolve, reject) => {
    child.once("exit", (code) => resolve(code));
    child.once("error", reject);
  });
  children.push(child);
  return { ready, probe, child, exit };
}
async function until(check, description, timeout = 10000) {
  const end = Date.now() + timeout;
  do {
    if (await check()) return;
    await delay(100);
  } while (Date.now() < end);
  throw new Error(description);
}
async function exited(instance) {
  await until(
    () => instance.child.exitCode !== null,
    "Native startup did not exit",
  );
  assert.equal(await instance.exit, 0);
}
try {
  const normal = launch(process.pid, "ready");
  await until(async () => {
    const rows = (await fs.readFile(normal.probe, "utf8").catch(() => ""))
      .trim()
      .split(/\r?\n/);
    return new Set(rows.map((row) => row.split(":")[0])).size === 4;
  }, "Native window did not paint all four running poses");
  await fs.writeFile(normal.ready, "ready");
  await exited(normal);

  const reduced = launch(process.pid, "reduced", true);
  await until(async () => {
    const rows = (await fs.readFile(reduced.probe, "utf8").catch(() => ""))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    return new Set(rows.map((row) => row.split(":")[0])).size === 4;
  }, "Reduced-motion startup did not paint all four poses");
  const reducedRows = (await fs.readFile(reduced.probe, "utf8"))
    .trim()
    .split(/\r?\n/);
  assert.equal(new Set(reducedRows.map((row) => row.split(":")[1])).size, 1);
  await fs.writeFile(reduced.ready, "ready");
  await exited(reduced);

  const parent = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
  });
  children.push(parent);
  const orphan = launch(parent.pid, "orphan");
  await until(
    () =>
      fs
        .stat(orphan.probe)
        .then(() => true)
        .catch(() => false),
    "Native window did not start",
  );
  parent.kill();
  await exited(orphan);

  const invalid = launch(0, "invalid");
  await exited(invalid);
  console.log(
    "PASS: native four-pose rendering, readiness close, parent termination cleanup, invalid parent cleanup",
  );
} finally {
  for (const child of children) if (child.exitCode === null) child.kill();
  await fs.rm(directory, { recursive: true, force: true });
}
