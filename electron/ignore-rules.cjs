const fs = require("node:fs/promises");
const path = require("node:path");
const { Minimatch } = require("minimatch");
const { SvnError } = require("./runner.cjs");
const array = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const text = (p) =>
  (p.encoding === "base64"
    ? Buffer.from(p["#text"] || "", "base64").toString("utf8")
    : String(p["#text"] || "")
  ).replace(/\r\n?/g, "\n");
const names = ["svn:ignore", "svn:global-ignores"];
async function readRules(xml, target, hash) {
  const data = await xml([
    "proplist",
    "--xml",
    "--verbose",
    "--show-inherited-props",
    `${target}@`,
  ]);
  const own = { "svn:ignore": "", "svn:global-ignores": "" },
    inherited = [];
  for (const entry of array(data.properties?.target)) {
    if (path.resolve(entry.path) === target)
      for (const p of array(entry.property))
        if (names.includes(p.name)) own[p.name] = text(p);
    for (const p of array(entry.inherited_property))
      if (p.name === "svn:global-ignores")
        inherited.push({ source: entry.path, value: text(p) });
  }
  return { own, inherited, fingerprint: hash({ own, inherited }) };
}
async function previewRules({ xml, target, property, value, signal }) {
  const patterns = (
    property === "svn:ignore" ? value.split(/\r?\n/) : value.split(/\s+/)
  ).filter(Boolean);
  if (patterns.some((p) => p.includes("/") || p.includes("\\")))
    throw new SvnError(
      "规则按文件名匹配，请勿使用目录路径或 Git 的递归路径语法",
      "VALIDATION",
    );
  const matches = [],
    limit = 5000;
  let scanned = 0,
    truncated = false;
  const matchers = patterns.map(
    (pattern) =>
      new Minimatch(pattern, {
        dot: true,
        nonegate: true,
        nocomment: true,
        noext: true,
        nobrace: true,
        noglobstar: true,
        platform: "linux",
        nocase: false,
      }),
  );
  const match = (name) => matchers.some((matcher) => matcher.match(name));
  const inspect = async (full) => {
    if (signal?.aborted) throw new SvnError("操作已取消", "CANCELLED");
    if (scanned >= limit) {
      truncated = true;
      return;
    }
    const stat = await fs.lstat(full).catch(() => null);
    if (
      !stat ||
      stat.isSymbolicLink() ||
      path.basename(full).toLowerCase() === ".svn"
    )
      return;
    scanned++;
    const relative = path.relative(target, full).replaceAll("\\", "/");
    if (
      match(path.basename(full)) &&
      (property !== "svn:ignore" || path.dirname(full) === target)
    ) {
      matches.push({ path: relative, directory: stat.isDirectory() });
      return; // Matching a directory ignores its entire unversioned subtree.
    }
    if (stat.isDirectory() && property === "svn:global-ignores")
      for (const child of await fs.readdir(full)) {
        if (truncated) break;
        await inspect(path.join(full, child));
      }
  };
  const status = await xml([
    "status",
    "--xml",
    "--no-ignore",
    "--ignore-externals",
    `${target}@`,
  ]);
  for (const entry of array(status.status?.target).flatMap((t) =>
    array(t.entry),
  )) {
    if (!["unversioned", "ignored"].includes(entry["wc-status"]?.item))
      continue;
    const full = path.resolve(entry.path);
    if (full === target || !full.startsWith(target + path.sep)) continue;
    await inspect(full);
    if (truncated) break;
  }
  return { matches, scanned, truncated, limit };
}
module.exports = { readRules, previewRules };
