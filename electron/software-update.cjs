const { EventEmitter } = require("node:events");
const { CancellationToken } = require("builder-util-runtime");
const semver = require("semver");
const RELEASE_URL = "https://github.com/dmibing/svnx/releases/latest";
const RELEASE_API = "https://api.github.com/repos/dmibing/svnx/releases/latest";

function notes(value) {
  return (
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value.map((entry) => entry.note || "").join("\n")
        : ""
  ).slice(0, 8000);
}
function message(error) {
  if (/checksum|sha512|signature/i.test(`${error.code} ${error.message}`))
    return "更新包校验未通过，未进行安装。请重新检查更新。";
  if (
    /404|latest.*not.*found|no published/i.test(
      `${error.code} ${error.message}`,
    )
  )
    return "暂未找到已发布的正式版本，请稍后重试。";
  return "软件更新失败，请检查网络后重试，或前往发布页下载。";
}

class SoftwareUpdate extends EventEmitter {
  constructor({
    currentVersion,
    mode,
    updater,
    fetchRelease,
    busy = () => false,
    install = () => updater.quitAndInstall(true, true),
  }) {
    super();
    this.updater = updater;
    this.fetchRelease = fetchRelease;
    this.busy = busy;
    this.install = install;
    this.state = {
      sequence: 0,
      phase: "idle",
      currentVersion,
      mode,
      releaseUrl: RELEASE_URL,
    };
    this.listeners = [];
    if (!updater) return;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.disableWebInstaller = true;
    const on = (event, callback) => {
      updater.on(event, callback);
      this.listeners.push([event, callback]);
    };
    on("update-available", (info) =>
      this.set({
        phase: "available",
        version: info.version,
        notes: notes(info.releaseNotes),
        progress: 0,
        error: undefined,
      }),
    );
    on("update-not-available", () =>
      this.set({ phase: "unavailable", version: undefined, error: undefined }),
    );
    on("download-progress", (progress) => {
      if (this.state.phase !== "downloading") return;
      const now = Date.now();
      if (now - (this.lastProgress || 0) < 150 && progress.percent < 100)
        return;
      this.lastProgress = now;
      this.set({ progress: Math.max(0, Math.min(100, progress.percent)) });
    });
    on("update-downloaded", () => {
      if (this.state.phase === "downloading" && !this.token?.cancelled)
        this.set({ phase: "downloaded", progress: 100, error: undefined });
    });
    on("error", (error) => {
      if (!this.token?.cancelled)
        this.set({ phase: "error", error: message(error) });
    });
  }
  snapshot() {
    return { ...this.state };
  }
  set(patch) {
    Object.assign(this.state, patch, { sequence: this.state.sequence + 1 });
    this.emit("state", this.snapshot());
  }
  check() {
    if (this.checking) return this.checking;
    if (["downloading", "downloaded", "installing"].includes(this.state.phase))
      return Promise.resolve(this.snapshot());
    this.token = null;
    this.set({
      phase: "checking",
      error: undefined,
      progress: undefined,
      version: undefined,
      notes: undefined,
    });
    this.checking = (async () => {
      try {
        if (this.updater) await this.updater.checkForUpdates();
        else {
          const release = await this.fetchRelease(RELEASE_API);
          const version = semver.valid(
            String(release.tag_name || "").replace(/^v/, ""),
          );
          if (!version || release.draft || release.prerelease)
            throw new Error("Invalid release metadata");
          this.set({
            phase: semver.gt(version, this.state.currentVersion)
              ? "available"
              : "unavailable",
            version,
            notes: notes(release.body),
          });
        }
      } catch (error) {
        this.set({ phase: "error", error: message(error) });
      }
      return this.snapshot();
    })().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }
  download() {
    if (this.downloading) return this.snapshot();
    if (
      !this.updater ||
      this.state.mode !== "installed" ||
      this.state.phase !== "available"
    )
      throw new Error("请先检查更新；便携版请前往发布页下载。");
    this.token = new CancellationToken();
    const token = this.token;
    this.set({ phase: "downloading", progress: 0, error: undefined });
    this.downloading = this.updater
      .downloadUpdate(token)
      .catch((error) => {
        this.set(
          token.cancelled
            ? { phase: "available", progress: 0, error: undefined }
            : { phase: "error", error: message(error) },
        );
      })
      .finally(() => {
        this.downloading = null;
      });
    // IPC returns immediately; progress and completion travel as state events.
    return this.snapshot();
  }
  cancel() {
    if (this.state.phase === "downloading") this.token?.cancel();
    return this.snapshot();
  }
  apply() {
    if (
      !this.updater ||
      this.state.mode !== "installed" ||
      this.state.phase !== "downloaded"
    )
      throw new Error("更新包尚未下载并校验完成。");
    if (this.busy())
      throw new Error("仍有 SVN 任务正在运行，请完成后再重启升级。");
    this.set({ phase: "installing", error: undefined });
    try {
      this.install();
    } catch (error) {
      this.set({ phase: "error", error: message(error) });
      throw error;
    }
    return this.snapshot();
  }
  dispose() {
    this.token?.cancel();
    for (const [event, callback] of this.listeners)
      this.updater.removeListener(event, callback);
    this.removeAllListeners();
  }
}
module.exports = { SoftwareUpdate, RELEASE_URL };
