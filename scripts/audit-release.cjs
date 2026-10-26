const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const yaml = require("js-yaml");

async function digest(file, algorithm, encoding = "hex") {
  const hash = createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}
async function auditRelease() {
  const version = require("../package.json").version;
  const directory = path.resolve("release");
  const names = [
    `SVNX-Setup-${version}-x64.exe`,
    `SVNX-${version}-win-x64-portable.exe`,
  ];
  const asar = await import("@electron/asar");
  const archive = path.join(directory, "win-unpacked/resources/app.asar");
  const entries = asar.listPackage(archive);
  const privateEntries = entries.filter((entry) =>
    /(?:^|[\\/])(?:settings\.json|backups|userData|user-data|sessionData|session-data|artifacts|test-results|\.svn|\.git)(?:[\\/]|$)/i.test(
      entry,
    ),
  );
  const findings = [...privateEntries];
  const roots = [os.homedir(), process.env.APPDATA, process.env.LOCALAPPDATA]
    .filter(Boolean)
    .map((root) => root.replaceAll("\\", "/").toLowerCase());
  for (const entry of entries) {
    if (
      /^[/\\]node_modules[/\\]/.test(entry) ||
      !/\.(cjs|js|json|css|html|svg|png|map)$/i.test(entry)
    )
      continue;
    const data = asar.extractFile(archive, entry.replace(/^[/\\]/, ""));
    const text = data
      .toString("utf8")
      .replaceAll("\\", "/")
      .replace(/\/+/g, "/")
      .toLowerCase();
    if (
      roots.some((root) => text.includes(root)) ||
      /github_pat_[a-z0-9_]{20,}|gh[pousr]_[a-z0-9_]{20,}|-----begin (?:rsa |ec |openssh )?private key-----/i.test(
        text,
      )
    )
      findings.push(entry);
  }
  if (findings.length)
    throw new Error(`Release privacy check failed: ${findings.join(", ")}`);
  const info = yaml.load(
    await fsp.readFile(path.join(directory, "latest.yml"), "utf8"),
  );
  const file = info.files?.find((file) => file.url === names[0]);
  if (
    info.version !== version ||
    !file ||
    info.files.length !== 1 ||
    info.path !== names[0]
  )
    throw new Error("Installer update metadata does not match this release.");
  if (
    (await digest(path.join(directory, names[0]), "sha512", "base64")) !==
    file.sha512
  )
    throw new Error("Installer SHA512 mismatch.");
  const hashes = {};
  for (const name of names)
    hashes[name] = await digest(path.join(directory, name), "sha256");
  await fsp.writeFile(
    path.join(directory, "SHA256SUMS.txt"),
    Object.entries(hashes)
      .map(([name, hash]) => `${hash}  ${name}\n`)
      .join(""),
  );
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const result = {
    version,
    commit,
    archiveEntries: entries.length,
    privateRuntimeEntries: 0,
    personalPathOrCredentialFindings: 0,
    hashes,
  };
  await fsp.mkdir("artifacts", { recursive: true });
  await fsp.writeFile(
    "artifacts/release-audit.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    `PASS: release ${version}, no private runtime files, no personal paths/credentials, installer SHA512 verified`,
  );
  return result;
}
module.exports = { auditRelease, digest };
if (require.main === module)
  auditRelease().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
