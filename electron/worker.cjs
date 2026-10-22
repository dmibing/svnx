const { parentPort } = require("node:worker_threads");
const fs = require("node:fs/promises");
const { SvnService } = require("./svn.cjs");
const { Scheduler } = require("./scheduler.cjs");
const { run, SvnError } = require("./runner.cjs");
const port = process.parentPort || parentPort;
let service;
const scheduler = new Scheduler();
const send = (message) => port.postMessage(message);
port.on("message", async (event) => {
  const { id, method, params = {} } = process.parentPort ? event.data : event;
  if (method === "$cancel") {
    scheduler.cancel(params.id);
    return;
  }
  if (method === "$init") {
    service = new SvnService(params);
    for (const w of params.workspaces || []) service.register(w);
    send({ id, ok: true, data: true });
    return;
  }
  try {
    const data = await scheduler.submit(
      id,
      method === "$checkout"
        ? params.directory
        : service.wcRoots.get(params.workspaceId) || "__configuration__",
      async (signal) => {
        send({ type: "task", id, state: "running" });
        if (method === "$inspect") return service.inspect(params.path);
        if (method === "$register") {
          service.register(params);
          return true;
        }
        if (method === "$unregister") {
          service.roots.delete(params.id);
          service.wcRoots.delete(params.id);
          return true;
        }
        if (method === "$version") return service.version(params.executable);
        if (method === "$executable") {
          const version = await service.version(params.executable);
          service.executable = params.executable;
          return version;
        }
        if (method === "$checkout") {
          if (!/^(https?|svn|svn\+ssh|file):\/\//i.test(params.url))
            throw new SvnError("仓库地址协议不受支持", "VALIDATION");
          if (new URL(params.url).password)
            throw new SvnError(
              "请在认证窗口输入密码，不要写在地址中",
              "VALIDATION",
            );
          if ((await fs.readdir(params.directory)).length)
            throw new SvnError("检出目录必须为空", "VALIDATION");
          await run(
            service.executable,
            [
              "checkout",
              "-r",
              params.revision || "HEAD",
              `${params.url}@`,
              ".",
            ],
            {
              cwd: params.directory,
              signal,
              credentials: params.credentials,
              progress: (bytes) => send({ type: "progress", id, bytes }),
            },
          );
          return service.inspect(params.directory);
        }
        return service.execute(method, params, signal, (data) =>
          send({ type: "progress", id, ...data }),
        );
      },
    );
    send({ id, ok: true, data });
  } catch (e) {
    send({
      id,
      ok: false,
      error: {
        code: e.code || "VALIDATION",
        message: e.name === "ZodError" ? "请求参数不符合接口约束" : e.message,
      },
    });
  }
});
process.on("SIGTERM", () => {
  scheduler.close();
  process.exit(0);
});
