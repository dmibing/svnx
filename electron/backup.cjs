const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { SvnError } = require("./runner.cjs");
const LIMIT = 512 * 1024 * 1024;
class BackupStore {
  constructor(directory) {
    this.directory = directory;
  }
  async list(root) {
    await fs.mkdir(this.directory, { recursive: true });
    const result = [];
    for (const id of await fs.readdir(this.directory)) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue;
      try {
        const data = JSON.parse(
          await fs.readFile(
            path.join(this.directory, id, "manifest.json"),
            "utf8",
          ),
        );
        if (data.root === root && data.complete) result.push({ ...data, id });
      } catch {}
    }
    return result.sort((a, b) => b.date.localeCompare(a.date));
  }
  async create(root, targets, reason) {
    const id = randomUUID();
    const directory = path.join(this.directory, id);
    let bytes = 0;
    const files = [];
    const walk = async (absolute) => {
      const relative = path.relative(root, absolute);
      if (relative.split(path.sep).includes(".svn")) return;
      let stat;
      try {
        stat = await fs.lstat(absolute);
      } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
      }
      if (stat.isSymbolicLink())
        throw new SvnError(
          "此操作不支持符号链接，请使用 SVN 命令行处理",
          "VALIDATION",
        );
      if (stat.isDirectory()) {
        files.push({ path: relative, directory: true });
        for (const item of await fs.readdir(absolute))
          await walk(path.join(absolute, item));
      } else {
        bytes += stat.size;
        if (bytes > LIMIT)
          throw new SvnError("本次备份超过 512 MB，请缩小操作范围", "LIMIT");
        files.push({ path: relative, bytes: stat.size });
      }
    };
    for (const target of targets) await walk(target);
    const unique = [...new Map(files.map((f) => [f.path, f])).values()];
    const existing = await this.list(root);
    const total = existing.reduce((sum, b) => sum + b.bytes, 0);
    if (total + bytes > 2 * 1024 ** 3)
      throw new SvnError(
        "该工作副本备份已达 2 GB，请先从备份目录归档或删除不再需要的备份",
        "LIMIT",
      );
    await fs.mkdir(path.join(directory, "files"), { recursive: true });
    for (const file of unique) {
      const destination = path.join(directory, "files", file.path);
      if (file.directory) await fs.mkdir(destination, { recursive: true });
      else {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(path.join(root, file.path), destination);
      }
    }
    const manifest = {
      root,
      date: new Date().toISOString(),
      reason,
      bytes,
      files: unique,
      complete: true,
    };
    await fs.writeFile(
      path.join(directory, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    return { id, ...manifest };
  }
  async restore(root, id, guard) {
    const backup = (await this.list(root)).find((b) => b.id === id);
    if (!backup) throw new SvnError("找不到此工作副本的备份", "VALIDATION");
    const targets = [];
    for (const file of backup.files) targets.push(await guard(file.path));
    await this.create(
      root,
      targets.filter((_, i) => !backup.files[i].directory),
      "恢复备份前的保护副本",
    );
    for (let i = 0; i < backup.files.length; i++) {
      const file = backup.files[i],
        target = targets[i];
      if (file.directory) await fs.mkdir(target, { recursive: true });
      else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(
          path.join(this.directory, id, "files", file.path),
          target,
        );
      }
    }
    return {
      restored: backup.files.length,
      note: "仅恢复文件内容，不变更 SVN 调度状态。请刷新后检查状态。",
    };
  }
}
module.exports = { BackupStore };
