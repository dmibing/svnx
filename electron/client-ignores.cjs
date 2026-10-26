const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { decodeOutput } = require("./runner.cjs");
const { Minimatch } = require("minimatch");
const exec = promisify(execFile);
// Apache Subversion 1.14 defaults; configured values replace this list.
const defaults =
  "*.o *.lo *.la *.al .libs *.so *.so.[0-9]* *.a *.pyc *.pyo __pycache__ *.rej *~ #*# .#* .*.swp .DS_Store [Tt]humbs.db";
function iniIgnores(text) {
  let section = "",
    value,
    active = false;
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (/^\s*(?:[#;]|$)/.test(line)) continue;
    const heading = line.match(/^\s*\[([^\]]+)\]/);
    if (heading) {
      section = heading[1].trim().toLowerCase();
      active = false;
      continue;
    }
    const option = line.match(/^\s*([^\s=:]+)\s*[=:]\s*(.*)$/);
    if (option) {
      active =
        section === "miscellany" &&
        option[1].toLowerCase() === "global-ignores";
      if (active) value = option[2].trim();
    } else if (active && /^\s+/.test(line)) value += " " + line.trim();
  }
  return value;
}
async function fileOption(file) {
  if (!file) return undefined;
  try {
    if ((await fs.stat(file)).size > 1024 * 1024) return undefined;
    return iniIgnores(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (["ENOENT", "EACCES", "EPERM"].includes(error.code)) return undefined;
    throw error;
  }
}
async function registryOption(hive) {
  try {
    const { stdout } = await exec(
      "reg.exe",
      [
        "query",
        `${hive}\\Software\\Tigris.org\\Subversion\\Config\\miscellany`,
        "/v",
        "global-ignores",
      ],
      { windowsHide: true, timeout: 2000, encoding: "buffer" },
    );
    return decodeOutput(stdout)
      .match(/global-ignores\s+REG_(?:EXPAND_)?SZ\s+(.*)/i)?.[1]
      .trim();
  } catch {
    return undefined;
  }
}
let cached,
  expires = 0;
async function clientIgnorePatterns() {
  if (cached && Date.now() < expires) return cached;
  let sources;
  if (process.platform === "win32") {
    // Per-user INI > per-user registry > system INI > system registry.
    sources = await Promise.all([
      registryOption("HKLM"),
      fileOption(
        process.env.PROGRAMDATA &&
          path.join(process.env.PROGRAMDATA, "Subversion", "config"),
      ),
      registryOption("HKCU"),
      fileOption(
        process.env.APPDATA &&
          path.join(process.env.APPDATA, "Subversion", "config"),
      ),
    ]);
  } else
    sources = await Promise.all([
      fileOption("/etc/subversion/config"),
      fileOption(path.join(os.homedir(), ".subversion", "config")),
    ]);
  cached = (sources.filter((value) => value !== undefined).at(-1) ?? defaults)
    .split(/\s+/)
    .filter(Boolean);
  expires = Date.now() + 3000;
  return cached;
}
function ignoreMatcher(patterns) {
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
  return (name) => matchers.some((matcher) => matcher.match(name));
}
module.exports = { clientIgnorePatterns, iniIgnores, ignoreMatcher };
