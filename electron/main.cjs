const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  utilityProcess,
  nativeTheme,
  shell,
  clipboard,
} = require("electron");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { schemas, revision } = require("./contracts.cjs");
// Separate Chromium caches when multiple development instances are running.
if (process.env.SVNX_DEV_URL) {
  const sessionDirectory = fsSync.mkdtempSync(
    path.join(os.tmpdir(), "svnx-dev-"),
  );
  app.setPath("sessionData", sessionDirectory);
}
let window, worker, config, configFile, checkoutDirectory;
const startupSignal = process.env.SVNX_STARTUP_SIGNAL;
let startupCompleted = false;
function completeStartup() {
  if (startupCompleted) return;
  startupCompleted = true;
  // The launcher supplies a per-launch temporary directory. Never persist it.
  if (startupSignal && path.basename(startupSignal) === "startup.ready")
    fsSync.writeFileSync(startupSignal, "ready");
}
ipcMain.on("svnx:startup-ready", (event) => {
  if (startupCompleted || !window || event.sender !== window.webContents) return;
  window.show();
  try {
    completeStartup();
  } catch {
    /* Launcher also watches process lifetime. */
  }
});
let writing = Promise.resolve();
const pending = new Map(),
  activeTasks = new Map(),
  watchers = new Map();
const readMethods = new Set([
  "status",
  "incoming",
  "info",
  "tree",
  "diff",
  "log",
  "properties",
  "ignoreRules",
  "ignorePreview",
  "conflict",
  "backups",
  "commitPlan",
  "revertPlan",
]);
const defaults = {
  theme: "system",
  listWidth: 330,
  svnPath: "svn",
  externalTool: "",
  locale: "zh-CN",
  autoCheckUpdates: true,
  updateCheckMinutes: 5,
};
let updateCheckTimer;
const incomingUpdates = {};
const checkingUpdates = new Set();
async function checkIncoming(workspace) {
  if (!config.settings.autoCheckUpdates || checkingUpdates.has(workspace.id))
    return;
  checkingUpdates.add(workspace.id);
  try {
    const result = await rpc("incoming", { workspaceId: workspace.id });
    if (
      !config.settings.autoCheckUpdates ||
      !config.workspaces.some((w) => w.id === workspace.id)
    )
      return;
    incomingUpdates[workspace.id] = result;
    broadcast({ type: "incoming", workspaceId: workspace.id, result });
  } catch (error) {
    if (!config.settings.autoCheckUpdates) return;
    const result = { ...incomingUpdates[workspace.id], error: error.message };
    incomingUpdates[workspace.id] = result;
    broadcast({ type: "incoming", workspaceId: workspace.id, result });
  } finally {
    checkingUpdates.delete(workspace.id);
  }
}
function scheduleUpdateChecks() {
  clearInterval(updateCheckTimer);
  if (!config.settings.autoCheckUpdates) return;
  const checkAll = async () => {
    for (const workspace of config.workspaces) await checkIncoming(workspace);
  };
  updateCheckTimer = setInterval(
    checkAll,
    config.settings.updateCheckMinutes * 60000,
  );
  updateCheckTimer.unref();
  void checkAll();
}
function broadcast(data) {
  if (window && !window.isDestroyed())
    window.webContents.send("svnx:event", data);
}
async function save() {
  const text = JSON.stringify(config, null, 2);
  writing = writing
    .catch(() => {})
    .then(async () => {
      const temp = configFile + ".tmp";
      await fs.writeFile(temp, text, { mode: 0o600 });
      await fs.rename(temp, configFile);
    });
  return writing;
}
function rpc(method, params = {}, id = randomUUID()) {
  return new Promise((resolve, reject) => {
    if (!worker)
      return reject(
        Object.assign(new Error("后台服务不可用，请重启应用"), {
          code: "SERVICE",
        }),
      );
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, method, params });
  });
}
function watch(w) {
  if (watchers.has(w.id)) return;
  let timer;
  try {
    const handle = fsSync.watch(w.path, { recursive: true }, (_, filename) => {
      if (filename?.split(/[\\/]/).includes(".svn")) return;
      clearTimeout(timer);
      timer = setTimeout(
        () => broadcast({ type: "changed", workspaceId: w.id }),
        600,
      );
    });
    handle.on("error", () => {
      handle.close();
      watchers.delete(w.id);
    });
    watchers.set(w.id, {
      close() {
        clearTimeout(timer);
        handle.close();
      },
    });
  } catch {}
}
async function register(data) {
  const existing = config.workspaces.find(
    (w) => w.path.toLowerCase() === data.path.toLowerCase(),
  );
  const w = { ...data, id: existing?.id || randomUUID() };
  config.workspaces = [...config.workspaces.filter((x) => x.id !== w.id), w];
  await rpc("$register", w);
  watch(w);
  await save();
  broadcast({ type: "workspaces", workspaces: config.workspaces });
  void checkIncoming(w);
  return w;
}
function trusted(event) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("拒绝未知窗口请求");
}
function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    trusted(event);
    try {
      return { ok: true, data: await callback(...args) };
    } catch (e) {
      return {
        ok: false,
        error: {
          code: e.code || "VALIDATION",
          message: e.name === "ZodError" ? "请求参数无效" : e.message,
        },
      };
    }
  });
}
async function setup() {
  const dataRoot = process.env.SVNX_TEST_DATA || app.getPath("userData");
  await fs.mkdir(dataRoot, { recursive: true });
  configFile = path.join(dataRoot, "settings.json");
  try {
    config = JSON.parse(await fs.readFile(configFile, "utf8"));
    if (config.version !== 1 || !Array.isArray(config.workspaces))
      throw new Error();
    config.settings = { ...defaults, ...config.settings };
  } catch {
    config = { version: 1, settings: { ...defaults }, workspaces: [] };
  }
  worker = utilityProcess.fork(path.join(__dirname, "worker.cjs"), [], {
    stdio: "pipe",
    serviceName: "SVNX Subversion",
  });
  worker.on("message", (m) => {
    if (m.type) {
      broadcast(m);
      return;
    }
    const request = pending.get(m.id);
    if (!request) return;
    pending.delete(m.id);
    m.ok
      ? request.resolve(m.data)
      : request.reject(Object.assign(new Error(m.error.message), m.error));
  });
  worker.on("exit", () => {
    worker = null;
    for (const r of pending.values())
      r.reject(
        Object.assign(new Error("SVN 后台服务已退出，请重启并刷新工作副本"), {
          code: "SERVICE",
        }),
      );
    pending.clear();
    broadcast({
      type: "service-error",
      message: "后台服务已退出，请重启应用。",
    });
  });
  await rpc("$init", {
    executable: config.settings.svnPath,
    backupDirectory: path.join(dataRoot, "backups"),
    workspaces: config.workspaces,
  });
  for (const w of config.workspaces) watch(w);
  nativeTheme.themeSource = config.settings.theme;
  handle("svnx:bootstrap", async () => {
    let engine, engineError;
    try {
      engine = await rpc("$version");
    } catch (e) {
      engineError = e.message;
    }
    return { ...config, engine, engineError, incomingUpdates };
  });
  handle("svnx:open", async () => {
    const r = await dialog.showOpenDialog(window, {
      title: "打开 SVN 工作副本",
      properties: ["openDirectory"],
    });
    return r.canceled
      ? null
      : register(await rpc("$inspect", { path: r.filePaths[0] }));
  });
  handle("svnx:checkout-directory", async () => {
    const r = await dialog.showOpenDialog(window, {
      title: "选择用于检出的空目录",
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled) return null;
    const selected = await fs.realpath(r.filePaths[0]);
    if ((await fs.readdir(selected)).length)
      throw new Error("请选择空目录，避免覆盖已有文件");
    checkoutDirectory = selected;
    return selected;
  });
  handle("svnx:remove", async (id) => {
    if (typeof id !== "string") throw new Error("工作副本 ID 无效");
    if ([...activeTasks.values()].some((t) => t.workspaceId === id))
      throw new Error("请等待该工作副本任务结束");
    config.workspaces = config.workspaces.filter((w) => w.id !== id);
    watchers.get(id)?.close();
    watchers.delete(id);
    await rpc("$unregister", { id });
    await save();
    broadcast({ type: "workspaces", workspaces: config.workspaces });
    return true;
  });
  handle("svnx:settings", async (patch) => {
    if (
      !patch ||
      typeof patch !== "object" ||
      Object.keys(patch).some(
        (k) =>
          ![
            "theme",
            "listWidth",
            "autoCheckUpdates",
            "updateCheckMinutes",
          ].includes(k),
      )
    )
      throw new Error("不支持的设置");
    if (patch.theme && !["light", "dark", "system"].includes(patch.theme))
      throw new Error("主题无效");
    if (
      patch.listWidth !== undefined &&
      (!Number.isFinite(patch.listWidth) ||
        patch.listWidth < 280 ||
        patch.listWidth > 520)
    )
      throw new Error("面板宽度无效");
    if (
      patch.autoCheckUpdates !== undefined &&
      typeof patch.autoCheckUpdates !== "boolean"
    )
      throw new Error("自动检测开关无效");
    if (
      patch.updateCheckMinutes !== undefined &&
      (!Number.isInteger(patch.updateCheckMinutes) ||
        patch.updateCheckMinutes < 1 ||
        patch.updateCheckMinutes > 60)
    )
      throw new Error("检测间隔应为 1 至 60 分钟");
    Object.assign(config.settings, patch);
    nativeTheme.themeSource = config.settings.theme;
    await save();
    if (
      patch.autoCheckUpdates !== undefined ||
      patch.updateCheckMinutes !== undefined
    )
      scheduleUpdateChecks();
    return config.settings;
  });
  handle("svnx:engine", async () => {
    const r = await dialog.showOpenDialog(window, {
      title: "选择 SVN 1.14+ 可执行文件",
      properties: ["openFile"],
      filters:
        process.platform === "win32"
          ? [{ name: "SVN", extensions: ["exe"] }]
          : [],
    });
    if (r.canceled) return null;
    const version = await rpc("$executable", { executable: r.filePaths[0] });
    config.settings.svnPath = r.filePaths[0];
    await save();
    return { path: r.filePaths[0], version };
  });
  handle("svnx:external-tool", async () => {
    const r = await dialog.showOpenDialog(window, {
      title: "选择支持 old-file new-file 参数的差异工具",
      properties: ["openFile"],
    });
    if (r.canceled) return null;
    config.settings.externalTool = r.filePaths[0];
    await save();
    return r.filePaths[0];
  });
  handle("svnx:reveal", async (p) => {
    if (p?.backups === true) {
      await fs.mkdir(path.join(dataRoot, "backups"), { recursive: true });
      await shell.openPath(path.join(dataRoot, "backups"));
      return true;
    }
    const w = config.workspaces.find((w) => w.id === p?.workspaceId);
    if (!w) throw new Error("工作副本不存在");
    if (p.path) {
      require("./contracts.cjs").relative.parse(p.path);
      const full = path.resolve(w.path, p.path);
      if (!full.startsWith(w.path + path.sep)) throw new Error("路径无效");
      shell.showItemInFolder(full);
    } else await shell.openPath(w.path);
    return true;
  });
  handle("svnx:external-diff", async (p) => {
    if (!config.settings.externalTool)
      throw new Error("请先在设置中选择外部差异工具");
    const result = await rpc("diff", { ...p, loadLarge: true });
    if (result.binary || result.large || result.directory)
      throw new Error("请在文件管理器中使用专用工具查看二进制或超大文件");
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-diff-"));
    const old = path.join(temp, "BASE-" + path.basename(p.path)),
      next = path.join(temp, "WORKING-" + path.basename(p.path));
    await fs.writeFile(old, result.before);
    await fs.writeFile(next, result.after);
    const child = spawn(config.settings.externalTool, [old, next], {
      shell: false,
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.on("exit", () =>
      fs.rm(temp, { recursive: true, force: true }).catch(() => {}),
    );
    return true;
  });
  handle("svnx:cancel", (id) => {
    if (typeof id !== "string") throw new Error("任务 ID 无效");
    worker?.postMessage({ method: "$cancel", params: { id } });
    return true;
  });
  handle("svnx:copy-text", (text) => {
    if (typeof text !== "string" || text.length > 32768 || text.includes("\0"))
      throw new Error("复制内容无效");
    clipboard.writeText(text);
    return true;
  });
  handle("svnx:run", async (request) => {
    if (
      !request ||
      !/^[a-f0-9-]{36}$/.test(request.id) ||
      activeTasks.has(request.id)
    )
      throw new Error("请求 ID 无效");
    const { id, method, params } = request;
    if (method === "checkout") {
      if (!checkoutDirectory || params.directory !== checkoutDirectory)
        throw new Error("请先选择检出目录");
      revision.parse(params.revision || "HEAD");
      if (typeof params.url !== "string" || params.url.length > 32768)
        throw new Error("仓库地址无效");
    } else {
      if (!schemas[method]) throw new Error("操作不在允许列表中");
      schemas[method].parse(params);
      if (!config.workspaces.some((w) => w.id === params.workspaceId))
        throw new Error("工作副本未注册");
    }
    activeTasks.set(id, { workspaceId: params.workspaceId, method });
    broadcast({
      type: "task",
      id,
      method,
      workspaceId: params.workspaceId,
      state: "queued",
      date: new Date().toISOString(),
    });
    try {
      const data = await rpc(
        method === "checkout" ? "$checkout" : method,
        params,
        id,
      );
      const result = method === "checkout" ? await register(data) : data;
      if (["update", "commit"].includes(method)) {
        const workspace = config.workspaces.find(
          (w) => w.id === params.workspaceId,
        );
        if (workspace) void checkIncoming(workspace);
      }
      broadcast({
        type: "task",
        id,
        method,
        workspaceId: params.workspaceId,
        state: "completed",
      });
      return result;
    } catch (e) {
      broadcast({
        type: "task",
        id,
        method,
        workspaceId: params.workspaceId,
        state: e.code === "CANCELLED" ? "cancelled" : "failed",
        error: { code: e.code, message: e.message },
      });
      throw e;
    } finally {
      activeTasks.delete(id);
      if (!readMethods.has(method))
        broadcast({ type: "changed", workspaceId: params.workspaceId });
    }
  });
}
function createWindow(startup = false) {
  window = new BrowserWindow({
    show: !startupSignal || startupCompleted,
    width: 1440,
    height: 940,
    minWidth: 1060,
    minHeight: 680,
    title: "SVNX",
    icon: path.join(__dirname, "../build/icon.ico"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#242424" : "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      const dev = !app.isPackaged && process.env.SVNX_DEV_URL;
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; script-src 'self'" +
              (dev ? " 'unsafe-inline'" : "") +
              "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'" +
              (dev ? " ws://127.0.0.1:*" : "") +
              "; object-src 'none'; base-uri 'self'",
          ],
        },
      });
    },
  );
  window.webContents.session.setPermissionRequestHandler((_, __, callback) =>
    callback(false),
  );
  window.on("focus", () => broadcast({ type: "activated" }));
  window.on("close", (event) => {
    if ([...activeTasks.values()].some((t) => !readMethods.has(t.method))) {
      const answer = dialog.showMessageBoxSync(window, {
        type: "warning",
        buttons: ["继续等待", "取消任务并退出"],
        defaultId: 0,
        cancelId: 0,
        message: "仍有 SVN 任务正在运行",
        detail:
          "退出会中断任务。提交可能已在服务器完成，重新打开后请先检查历史。",
      });
      if (answer === 0) event.preventDefault();
      else
        for (const id of activeTasks.keys())
          worker?.postMessage({ method: "$cancel", params: { id } });
    }
  });
  if (startup)
    return window.loadFile(
      path.join(
        __dirname,
        app.isPackaged ? "../dist/startup.html" : "../public/startup.html",
      ),
    );
  return loadMainWindow();
}
function loadMainWindow() {
  if (!window || window.isDestroyed()) return;
  if (
    !app.isPackaged &&
    /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.SVNX_DEV_URL || "")
  )
    return window.loadURL(process.env.SVNX_DEV_URL);
  return window.loadFile(path.join(__dirname, "../dist/index.html"));
}
app
  .whenReady()
  .then(async () => {
    await createWindow(true);
    await setup();
    await loadMainWindow();
    scheduleUpdateChecks();
  })
  .catch((e) => {
    try {
      completeStartup();
    } catch {}
    dialog.showErrorBox("SVNX 启动失败", e.message);
    app.quit();
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
let exiting = false;
app.on("before-quit", (event) => {
  try {
    completeStartup();
  } catch {}
  clearInterval(updateCheckTimer);
  if (activeTasks.size && !exiting) {
    event.preventDefault();
    for (const id of activeTasks.keys())
      worker?.postMessage({ method: "$cancel", params: { id } });
    const poll = setInterval(() => {
      if (!activeTasks.size) {
        clearInterval(poll);
        exiting = true;
        app.quit();
      }
    }, 100);
    return;
  }
  for (const w of watchers.values()) w.close();
  worker?.kill();
});
app.on("activate", () => {
  if (!BrowserWindow.getAllWindows().length) createWindow();
});
