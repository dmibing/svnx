const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { SoftwareUpdate } = require("../electron/software-update.cjs");
const tick = () => new Promise((resolve) => setImmediate(resolve));

class FakeUpdater extends EventEmitter {
  checks = 0;
  downloads = 0;
  installs = 0;
  async checkForUpdates() {
    this.checks++;
    await tick();
    this.emit("update-available", {
      version: "1.1.0",
      releaseNotes: "<script>literal notes</script>",
    });
  }
  downloadUpdate(token) {
    this.downloads++;
    return new Promise((resolve, reject) => {
      this.complete = () => {
        this.emit("update-downloaded");
        resolve(["verified-installer.exe"]);
      };
      this.fail = (error) => {
        this.emit("error", error);
        reject(error);
      };
      token.onCancel(() => reject(new Error("cancelled")));
    });
  }
  quitAndInstall() {
    this.installs++;
  }
}
test("software updates are explicit, deduplicate checks/downloads and block installing during SVN work", async () => {
  const updater = new FakeUpdater();
  let busy = true;
  const service = new SoftwareUpdate({
    currentVersion: "1.0.0",
    mode: "installed",
    updater,
    busy: () => busy,
  });
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.allowPrerelease, false);
  assert.throws(() => service.apply(), /校验/);
  const checks = [service.check(), service.check()];
  await Promise.all(checks);
  assert.equal(updater.checks, 1);
  assert.equal(updater.downloads, 0);
  assert.equal(service.snapshot().phase, "available");
  service.download();
  service.download();
  assert.equal(updater.downloads, 1);
  updater.emit("download-progress", { percent: 50 });
  assert.equal(service.snapshot().progress, 50);
  assert.throws(() => service.apply(), /校验/);
  updater.complete();
  await tick();
  assert.equal(service.snapshot().phase, "downloaded");
  assert.equal(updater.installs, 0);
  assert.throws(() => service.apply(), /SVN/);
  busy = false;
  service.apply();
  assert.equal(updater.installs, 1);
  service.dispose();
});
test("cancel can retry; checksum rejection never becomes installable or leaks local paths", async () => {
  const updater = new FakeUpdater();
  const service = new SoftwareUpdate({
    currentVersion: "1.0.0",
    mode: "installed",
    updater,
  });
  await service.check();
  service.download();
  service.cancel();
  await tick();
  assert.equal(service.snapshot().phase, "available");
  service.download();
  updater.fail(
    Object.assign(new Error("sha512 mismatch in private cache"), {
      code: "ERR_UPDATER_CHECKSUM_MISMATCH",
    }),
  );
  await tick();
  assert.equal(service.snapshot().phase, "error");
  assert.match(service.snapshot().error, /校验/);
  assert.doesNotMatch(service.snapshot().error, /private cache/);
  assert.throws(() => service.apply(), /校验/);
  assert.equal(updater.installs, 0);
  service.dispose();
});
test("portable checks only the fixed public release endpoint and cannot install", async () => {
  let release = { tag_name: "v1.2.0", body: "notes" };
  const service = new SoftwareUpdate({
    currentVersion: "1.1.0",
    mode: "portable",
    fetchRelease: async (url) => {
      assert.equal(
        url,
        "https://api.github.com/repos/dmibing/svnx/releases/latest",
      );
      return release;
    },
  });
  await service.check();
  assert.equal(service.snapshot().phase, "available");
  assert.throws(() => service.download(), /便携版/);
  assert.throws(() => service.apply(), /校验/);
  release = { tag_name: "v1.0.0" };
  await service.check();
  assert.equal(service.snapshot().phase, "unavailable");
  release = { tag_name: "v2.0.0-beta.1", prerelease: true };
  await service.check();
  assert.equal(service.snapshot().phase, "error");
  service.dispose();
});
