const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { XMLParser } = require("fast-xml-parser");
const iconv = require("iconv-lite");
const { run, SvnError, decodeOutput, nativeEncoding } = require("./runner.cjs");
const { schemas } = require("./contracts.cjs");
const { BackupStore } = require("./backup.cjs");
const { updateResult } = require("./update-result.cjs");
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
});
const array = (value) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const peg = (value) => `${value}@`;
const empty = () => Buffer.alloc(0);
const decode = (buffer, encoding = "auto") => {
  if (encoding !== "auto")
    return { text: iconv.decode(buffer, encoding), encoding };
  if (buffer[0] === 0xff && buffer[1] === 0xfe)
    return { text: iconv.decode(buffer, "utf-16le"), encoding: "utf-16le" };
  if (buffer[0] === 0xfe && buffer[1] === 0xff)
    return { text: iconv.decode(buffer, "utf-16be"), encoding: "utf-16be" };
  if (buffer.includes(0)) return { binary: true, text: "", encoding: "binary" };
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
      encoding: "utf-8",
      bom: buffer.subarray(0, 3).equals(Buffer.from([239, 187, 191])),
    };
  } catch {
    return { text: iconv.decode(buffer, "gb18030"), encoding: "gb18030" };
  }
};
class SvnService {
  constructor({ executable = "svn", backupDirectory }) {
    this.executable = executable;
    this.roots = new Map();
    this.wcRoots = new Map();
    this.backup = new BackupStore(backupDirectory);
  }
  async version(executable = this.executable) {
    const output = decodeOutput(
      await run(executable, ["--version", "--quiet"]),
    ).trim();
    if (!/^1\.(1[4-9]|[2-9]\d)\./.test(output))
      throw new SvnError(`需要 SVN 1.14+，当前为 ${output}`, "ENGINE");
    return output;
  }
  async inspect(directory) {
    const info = parser.parse(
      (
        await run(this.executable, ["info", "--xml", "."], { cwd: directory })
      ).toString("utf8"),
    ).info.entry;
    if (!info?.["wc-info"]?.["wcroot-abspath"])
      throw new SvnError("请选择已检出的 SVN 工作副本目录", "VALIDATION");
    // 用户选择的目录是工作区边界；wcroot 仅用于共享管理数据与调度锁。
    const selected = await fs.realpath(directory);
    const wcRoot = await fs.realpath(info["wc-info"]["wcroot-abspath"]);
    return {
      path: selected,
      wcRoot,
      name: path.basename(selected),
      url: info.url,
      repositoryRoot: info.repository.root,
      uuid: info.repository.uuid,
      revision: Number(info.revision),
    };
  }
  register(workspace) {
    this.roots.set(workspace.id, path.resolve(workspace.path));
    this.wcRoots.set(
      workspace.id,
      path.resolve(workspace.wcRoot || workspace.path),
    );
  }
  async guard(root, relative) {
    if (
      typeof relative !== "string" ||
      relative.includes("\0") ||
      relative.includes("\n") ||
      relative.includes("\r") ||
      relative
        .split(/[\\/]/)
        .some((s) => s === ".." || s.toLowerCase() === ".svn") ||
      path.isAbsolute(relative)
    )
      throw new SvnError("非法工作副本路径", "VALIDATION");
    const full = path.resolve(root, relative || ".");
    const rel = path.relative(root, full);
    if (rel.startsWith("..") || path.isAbsolute(rel))
      throw new SvnError("路径超出工作副本", "VALIDATION");
    let cursor = full;
    while (cursor !== root) {
      try {
        const stat = await fs.lstat(cursor);
        if (stat.isSymbolicLink())
          throw new SvnError("不允许操作符号链接路径", "VALIDATION");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new SvnError("路径边界错误", "VALIDATION");
      cursor = parent;
    }
    return full;
  }
  async execute(method, input, signal, onProgress = () => {}) {
    if (!schemas[method]) throw new SvnError("不支持的操作", "VALIDATION");
    const p = schemas[method].parse(input);
    const root = this.roots.get(p.workspaceId);
    if (!root) throw new SvnError("工作副本未注册", "VALIDATION");
    const cli = (args, extra = {}) =>
      run(this.executable, args, {
        cwd: root,
        signal,
        credentials: p.credentials,
        progress: (bytes) => onProgress({ bytes }),
        ...extra,
      });
    const xml = async (args) =>
      parser.parse((await cli(args)).toString("utf8"));
    const local = async (relative) => {
      await this.guard(root, relative);
      return peg(relative || ".");
    };
    const targets = async () => Promise.all(p.paths.map(local));
    const batch = async (command, flags, list) => {
      const temp = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-targets-"));
      try {
        const file = path.join(temp, "paths");
        const text = list.join("\n");
        const encoded = iconv.encode(text, nativeEncoding);
        if (iconv.decode(encoded, nativeEncoding) !== text)
          throw new SvnError(
            "当前 SVN 的系统代码页不能表示所选路径，请使用支持该路径编码的 SVN 环境",
            "ENCODING",
          );
        await fs.writeFile(file, encoded, { mode: 0o600 });
        return await cli([command, ...flags, "--targets", file]);
      } finally {
        await fs.rm(temp, { recursive: true, force: true });
      }
    };
    const status = async (scope = root) => {
      const data = await xml([
        "status",
        "--xml",
        "--ignore-externals",
        ...(p.showIgnored ? ["--no-ignore"] : []),
        peg(path.relative(root, scope) || "."),
      ]);
      const entries = [
        ...array(data.status?.target).flatMap((t) => array(t.entry)),
        ...array(data.status?.changelist).flatMap((t) => array(t.entry)),
      ];
      return entries
        .map((entry) => {
          const s = entry["wc-status"];
          const absolute = path.isAbsolute(entry.path)
            ? entry.path
            : path.join(root, entry.path);
          const relative = path.relative(root, absolute).replaceAll("\\", "/");
          return {
            id: relative || ".",
            path: relative || "",
            status:
              s.item === "normal" && s.props === "modified"
                ? "modified"
                : s.item,
            props: s.props,
            revision: Number(s.revision) || 0,
            treeConflict: s["tree-conflicted"] === "true",
            copied: s.copied === "true",
            switched: s.switched === "true",
            movedFrom: s["moved-from"]
              ? path
                  .relative(root, path.resolve(root, s["moved-from"]))
                  .replaceAll("\\", "/")
              : undefined,
            movedTo: s["moved-to"]
              ? path
                  .relative(root, path.resolve(root, s["moved-to"]))
                  .replaceAll("\\", "/")
              : undefined,
            lock: s.lock
              ? { owner: s.lock.owner, comment: s.lock.comment || "" }
              : null,
            changelist: entry.changelist,
          };
        })
        .filter(
          (e) =>
            !["normal", "none", "external"].includes(e.status) ||
            e.props === "modified" ||
            e.treeConflict ||
            e.lock,
        );
    };
    const info = async () => (await xml(["info", "--xml", "."])).info.entry;
    const snapshot = async (entries) => {
      const result = [];
      for (const entry of entries) {
        const file = await this.guard(root, entry.path);
        let stat;
        try {
          stat = await fs.lstat(file);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        result.push([
          entry.path,
          entry.status,
          entry.props,
          entry.treeConflict,
          entry.copied,
          entry.movedFrom,
          entry.movedTo,
          stat?.mtimeMs,
          stat?.size,
        ]);
      }
      return hash(result);
    };
    const plan = async (operation) => {
      const all = await status();
      let chosen = all.filter((e) => p.paths.includes(e.path));
      if (!chosen.length)
        throw new SvnError("所选路径没有可操作的变更，请刷新", "VALIDATION");
      if (operation === "commit") {
        if (
          chosen.some(
            (e) =>
              [
                "conflicted",
                "missing",
                "obstructed",
                "incomplete",
                "unversioned",
                "ignored",
              ].includes(e.status) ||
              e.treeConflict ||
              e.props === "conflicted",
          )
        )
          throw new SvnError(
            "所选文件包含未添加、缺失或冲突项，请先处理后再提交",
            "VALIDATION",
          );
        const dependencies = all.filter(
          (e) =>
            e.status === "added" &&
            chosen.some((c) => c.path.startsWith(e.path + "/")),
        );
        chosen = [
          ...new Map(
            [...chosen, ...dependencies].map((e) => [e.path, e]),
          ).values(),
        ];
        for (const e of chosen)
          if (["deleted", "replaced"].includes(e.status))
            chosen.push(
              ...all.filter(
                (c) => c.path.startsWith(e.path + "/") && !chosen.includes(c),
              ),
            );
        if (
          chosen.some(
            (e) =>
              (e.movedFrom &&
                !chosen.some(
                  (c) => c.path === e.movedFrom.replaceAll("\\", "/"),
                )) ||
              (e.movedTo &&
                !chosen.some(
                  (c) => c.path === e.movedTo.replaceAll("\\", "/"),
                )),
          )
        )
          throw new SvnError("移动操作的源和目标必须一起提交", "VALIDATION");
      } else {
        chosen = all.filter(
          (e) =>
            chosen.some(
              (c) => e.path === c.path || e.path.startsWith(c.path + "/"),
            ) && !["unversioned", "ignored"].includes(e.status),
        );
      }
      chosen.sort((a, b) => a.path.localeCompare(b.path));
      return {
        entries: chosen,
        paths: chosen.map((e) => e.path),
        fingerprint: await snapshot(chosen),
        warnings: chosen.some((e) => ["deleted", "replaced"].includes(e.status))
          ? ["目录删除／替换将包含该目录下的全部内容，请核对影响范围。"]
          : [],
      };
    };
    switch (method) {
      case "info": {
        const entry = await info();
        return {
          url: entry.url,
          revision: Number(entry.revision),
          repositoryRoot: entry.repository.root,
          uuid: entry.repository.uuid,
          path: root,
          wcRoot: entry["wc-info"]["wcroot-abspath"],
        };
      }
      case "incoming": {
        const data = parser.parse(
          (
            await cli(
              ["status", "--xml", "--show-updates", "--ignore-externals", "."],
              { timeout: 30000 },
            )
          ).toString("utf8"),
        );
        const entries = [
          ...array(data.status?.target).flatMap((target) =>
            array(target.entry),
          ),
          ...array(data.status?.changelist).flatMap((list) =>
            array(list.entry),
          ),
        ];
        const changed = await Promise.all(
          entries.map(async (entry) => {
            const status = entry["repos-status"];
            if (!status) return null;
            const propsChanged = ![undefined, "none", "normal"].includes(
              status.props,
            );
            if (["none", "normal"].includes(status.item) && !propsChanged)
              return null;
            // Parent directories also report modified for changed children; count
            // their own property changes, additions and deletions, not that summary.
            if (status.item === "modified" && !propsChanged) {
              const localPath = path.isAbsolute(entry.path)
                ? entry.path
                : path.join(root, entry.path);
              if ((await fs.stat(localPath).catch(() => null))?.isDirectory())
                return null;
            }
            return entry.path;
          }),
        );
        const paths = [...new Set(changed.filter((value) => value !== null))];
        return {
          count: paths.length,
          paths,
          checkedAt: new Date().toISOString(),
        };
      }
      case "status":
        return status();
      case "tree": {
        const directory = await this.guard(root, p.path);
        return (await fs.readdir(directory, { withFileTypes: true }))
          .filter((e) => e.name !== ".svn" && !e.isSymbolicLink())
          .map((e) => ({
            path: path
              .relative(root, path.join(directory, e.name))
              .replaceAll("\\", "/"),
            name: e.name,
            directory: e.isDirectory(),
          }))
          .sort(
            (a, b) =>
              Number(b.directory) - Number(a.directory) ||
              a.name.localeCompare(b.name),
          );
      }
      case "commitPlan":
        return plan("commit");
      case "revertPlan":
        return plan("revert");
      case "commit": {
        const current = await plan("commit");
        if (current.fingerprint !== p.fingerprint)
          throw new SvnError("文件状态已变化，请重新预览提交范围", "STALE");
        const temp = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-commit-"));
        try {
          await fs.writeFile(path.join(temp, "message"), p.message, {
            mode: 0o600,
          });
          await fs.writeFile(
            path.join(temp, "targets"),
            iconv.encode(
              (await Promise.all(current.paths.map(local))).join("\n"),
              nativeEncoding,
            ),
            { mode: 0o600 },
          );
          return {
            output: decodeOutput(
              await cli([
                "commit",
                "--depth",
                "empty",
                "--encoding",
                "UTF-8",
                "--file",
                path.join(temp, "message"),
                "--targets",
                path.join(temp, "targets"),
                ...(p.keepLocks ? ["--no-unlock"] : []),
              ]),
            ),
            paths: current.paths,
          };
        } finally {
          await fs.rm(temp, { recursive: true, force: true });
        }
      }
      case "revert": {
        const current = await plan("revert");
        if (current.fingerprint !== p.fingerprint)
          throw new SvnError("文件状态已变化，请重新预览还原范围", "STALE");
        const backup = await this.backup.create(
          root,
          await Promise.all(current.paths.map((f) => this.guard(root, f))),
          "还原前备份",
        );
        await batch("revert", ["--depth", "infinity"], await targets());
        return {
          backupId: backup.id,
          output: "已还原。新增文件和未跟踪文件不会被删除。",
        };
      }
      case "update": {
        const list = await targets();
        const output = [];
        let chunk = [],
          length = 0;
        for (const target of list) {
          if (length + target.length > 16000 && chunk.length) {
            output.push(
              decodeOutput(
                await cli([
                  "update",
                  "--accept",
                  "postpone",
                  "-r",
                  p.revision,
                  "--",
                  ...chunk,
                ]),
              ),
            );
            chunk = [];
            length = 0;
          }
          chunk.push(target);
          length += target.length + 3;
        }
        if (chunk.length)
          output.push(
            decodeOutput(
              await cli([
                "update",
                "--accept",
                "postpone",
                "-r",
                p.revision,
                "--",
                ...chunk,
              ]),
            ),
          );
        return updateResult(output.join("\n"));
      }
      case "add":
        return {
          output: decodeOutput(
            await batch(
              "add",
              ["--parents", "--depth", "infinity"],
              await targets(),
            ),
          ),
        };
      case "delete": {
        const full = await Promise.all(p.paths.map((f) => this.guard(root, f)));
        if (full.includes(root))
          throw new SvnError("不能删除工作副本根目录", "VALIDATION");
        const backup = await this.backup.create(root, full, "删除前备份");
        return {
          backupId: backup.id,
          output: decodeOutput(
            await batch("delete", ["--force"], await targets()),
          ),
        };
      }
      case "move": {
        if (!p.path || !p.destination || p.path === p.destination)
          throw new SvnError("请输入不同的源和目标路径", "VALIDATION");
        await this.guard(root, p.destination);
        return {
          output: decodeOutput(
            await cli(["move", "--", await local(p.path), p.destination]),
          ),
        };
      }
      case "cleanup":
        return {
          output:
            decodeOutput(await cli(["cleanup", "."])) ||
            "清理完成。未删除任何未跟踪或忽略的文件。",
        };
      case "lock":
        return {
          output: decodeOutput(
            await batch("lock", ["--message", p.message], await targets()),
          ),
        };
      case "unlock":
        return {
          output: decodeOutput(await batch("unlock", [], await targets())),
        };
      case "ignore": {
        const target = await local(p.directory);
        const props = (await xml(["proplist", "--xml", "--verbose", target]))
          .properties;
        const existing = array(props?.target?.property).find(
          (e) => e.name === "svn:ignore",
        );
        const text = existing?.["#text"] || "";
        const next = [
          ...new Set([...text.split(/\r?\n/).filter(Boolean), ...p.patterns]),
        ].join("\n");
        return this.setProperty(cli, target, "svn:ignore", next);
      }
      case "properties": {
        const result = await xml([
          "proplist",
          "--xml",
          "--verbose",
          await local(p.path),
        ]);
        return array(result.properties?.target?.property).map((e) => ({
          name: e.name,
          value:
            e.encoding === "base64"
              ? Buffer.from(e["#text"] || "", "base64").toString("utf8")
              : String(e["#text"] || ""),
        }));
      }
      case "setProperty":
        return this.setProperty(cli, await local(p.path), p.name, p.value);
      case "log": {
        const data = await xml([
          "log",
          "--xml",
          "--verbose",
          "--limit",
          String(p.limit),
          "-r",
          `${p.start ?? "HEAD"}:0`,
          await local(p.path),
        ]);
        return array(data.log?.logentry).map((e) => ({
          revision: Number(e.revision),
          author: String(e.author || "未知作者"),
          date: String(e.date || ""),
          message: String(e.msg || ""),
          paths: array(e.paths?.path).map((f) => ({
            path: f["#text"],
            action: f.action,
            kind: f.kind,
            copyFrom: f["copyfrom-path"],
            copyRevision: f["copyfrom-rev"]
              ? Number(f["copyfrom-rev"])
              : undefined,
          })),
        }));
      }
      case "diff":
        return this.diff({ p, root, cli, xml, local, status, info });
      case "conflict": {
        const target = await local(p.path);
        const data = (await xml(["info", "--xml", target])).info.entry;
        const conflicts = array(data.conflict);
        const tree = data["tree-conflict"];
        const current = await fs
          .readFile(await this.guard(root, p.path))
          .catch((e) => {
            if (e.code === "ENOENT" || e.code === "EISDIR") return empty();
            throw e;
          });
        const files = {};
        for (const conflict of conflicts)
          for (const key of [
            "prev-base-file",
            "prev-wc-file",
            "cur-base-file",
            "prop-file",
          ])
            if (conflict[key]) {
              const full = path.isAbsolute(conflict[key])
                ? conflict[key]
                : path.join(root, conflict[key]);
              const relative = path.relative(root, full);
              try {
                files[key] = decode(
                  await fs.readFile(await this.guard(root, relative)),
                );
              } catch (e) {
                if (e.code !== "ENOENT") throw e;
              }
            }
        return {
          conflicts,
          tree,
          files,
          current: decode(current),
          fingerprint: hash(current),
          kinds: [
            ...new Set([
              ...conflicts.map((c) => c.type),
              ...(tree ? ["tree"] : []),
            ]),
          ],
        };
      }
      case "resolve": {
        const full = await this.guard(root, p.path);
        const current = await fs.readFile(full).catch((e) => {
          if (["ENOENT", "EISDIR"].includes(e.code)) return empty();
          throw e;
        });
        if (hash(current) !== p.fingerprint)
          throw new SvnError(
            "冲突文件已被外部修改，请重新打开冲突面板",
            "STALE",
          );
        if (p.kind === "tree" && p.accept !== "working")
          throw new SvnError(
            "树冲突仅支持修复结构后确认当前工作副本",
            "VALIDATION",
          );
        await this.backup.create(root, [full], "冲突解决前备份");
        if (p.content !== undefined) {
          if (p.kind !== "text")
            throw new SvnError("只有文本冲突可以写入合并结果", "VALIDATION");
          if (/^(<{7}|={7}|>{7})/m.test(p.content))
            throw new SvnError("合并结果仍包含冲突标记", "VALIDATION");
          const decoded = decode(current);
          if (decoded.binary)
            throw new SvnError("二进制冲突不能作为文本保存", "VALIDATION");
          let next = iconv.encode(p.content, decoded.encoding);
          if (
            decoded.bom &&
            !next.subarray(0, 3).equals(Buffer.from([239, 187, 191]))
          )
            next = Buffer.concat([Buffer.from([239, 187, 191]), next]);
          await fs.writeFile(full, next);
        }
        return {
          output: decodeOutput(
            await cli([
              "resolve",
              "--depth",
              "empty",
              "--accept",
              p.accept,
              peg(full),
            ]),
          ),
        };
      }
      case "backups":
        return this.backup.list(root);
      case "restoreBackup":
        return this.backup.restore(root, p.backupId, (relative) =>
          this.guard(root, relative),
        );
      default:
        throw new SvnError("未知操作", "VALIDATION");
    }
  }
  async setProperty(cli, target, name, value) {
    if (value === null)
      return {
        output: decodeOutput(await cli(["propdel", name, "--", target])),
      };
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "svnx-property-"));
    try {
      const file = path.join(temp, "value");
      await fs.writeFile(file, value, { mode: 0o600 });
      return {
        output: decodeOutput(
          await cli(["propset", name, "--file", file, "--", target]),
        ),
      };
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  }
  async diff({ p, root, cli, xml, local, status, info }) {
    const max = p.loadLarge ? 32 * 1024 ** 2 : 5 * 1024 ** 2;
    let before = empty(),
      after = empty(),
      props = "",
      directory = false;
    try {
      if (p.oldRevision !== undefined && p.newRevision !== undefined) {
        const rootInfo = await info();
        const repoPath = p.repositoryPath;
        if (!repoPath?.startsWith("/") || repoPath.split("/").includes(".."))
          throw new SvnError("历史路径无效", "VALIDATION");
        const url =
          rootInfo.repository.root.replace(/\/$/, "") +
          repoPath.split("/").map(encodeURIComponent).join("/");
        const target = `${url}@${p.peg ?? p.newRevision}`;
        const cat = async (revision) => {
          try {
            return await cli(["cat", "-r", revision, target], {
              maxBytes: max,
            });
          } catch (e) {
            if (/E160013|E200009|E195012|E195007|E170000/.test(e.message))
              return empty();
            throw e;
          }
        };
        [before, after] = await Promise.all([
          cat(p.oldRevision),
          cat(p.newRevision),
        ]);
        try {
          props = decodeOutput(
            await cli(
              [
                "diff",
                "--internal-diff",
                "--properties-only",
                "-r",
                `${p.oldRevision}:${p.newRevision}`,
                target,
              ],
              { maxBytes: max },
            ),
          );
        } catch (e) {
          if (!/E160013|E195012|E195007|E200009/.test(e.message)) throw e;
        }
      } else {
        const full = await this.guard(root, p.path);
        const entry = (await status(full)).find((e) => e.path === p.path);
        let stat;
        try {
          stat = await fs.stat(full);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        directory = stat?.isDirectory() || false;
        if ((stat?.size || 0) > max && !directory)
          return {
            path: p.path,
            large: true,
            size: stat.size,
            before: "",
            after: "",
          };
        if (!directory) {
          if (stat) after = await fs.readFile(full);
          if (
            !entry ||
            !["added", "unversioned", "ignored"].includes(entry.status) ||
            entry.copied
          ) {
            try {
              before = await cli(["cat", "-r", "BASE", await local(p.path)], {
                maxBytes: max,
              });
            } catch (e) {
              if (/E200009|E145001/.test(e.message)) directory = true;
              else throw e;
            }
          }
        }
        if (!entry || !["unversioned", "ignored"].includes(entry.status)) {
          try {
            props = decodeOutput(
              await cli(
                [
                  "diff",
                  "--internal-diff",
                  "--properties-only",
                  "--",
                  p.path || ".",
                ],
                { maxBytes: max },
              ),
            );
          } catch (e) {
            if (!/E200009/.test(e.message)) throw e;
          }
        }
      }
    } catch (e) {
      if (e.code === "LIMIT")
        return { path: p.path, large: true, before: "", after: "" };
      throw e;
    }
    const a = decode(before, p.encoding),
      b = decode(after, p.encoding);
    return {
      path: p.path,
      before: a.text,
      after: b.text,
      binary: !!(a.binary || b.binary),
      directory,
      encoding: b.encoding === "binary" ? a.encoding : b.encoding,
      eol: /\r\n/.test(b.text || a.text) ? "CRLF" : "LF",
      properties: props,
      oldBytes: before.length,
      newBytes: after.length,
      additions: Math.max(
        0,
        b.text.split("\n").length - a.text.split("\n").length,
      ),
      deletions: Math.max(
        0,
        a.text.split("\n").length - b.text.split("\n").length,
      ),
    };
  }
}
module.exports = { SvnService, decode, parser, array, hash };
