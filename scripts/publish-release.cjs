const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { auditRelease, digest } = require("./audit-release.cjs");

async function publishRelease() {
  const audit = await auditRelease();
  const raw = execFileSync(
    "git",
    ["-c", "credential.interactive=false", "credential", "fill"],
    {
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const credential = Object.fromEntries(
    raw
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
  if (!credential.password || /[\r\n]/.test(credential.password))
    throw new Error("GitHub publishing credentials are unavailable.");
  // Keep credentials in stdin only, never in args, files, application bundles or logs.
  const curlConfig = `header = ${JSON.stringify("Authorization: Bearer " + credential.password)}\nheader = "Accept: application/vnd.github+json"\n`;
  function request(url, method = "GET", data, file) {
    const args = [
      "--silent",
      "--show-error",
      "--http1.1",
      "--connect-timeout",
      "20",
      "--max-time",
      "600",
      "--config",
      "-",
      "--user-agent",
      "SVNX-release",
      "--write-out",
      "\n%{http_code}",
      "--request",
      method,
    ];
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (proxy) args.push("--proxy", proxy);
    if (file)
      args.push(
        "--header",
        "Content-Type: application/octet-stream",
        "--data-binary",
        "@" + file,
      );
    else if (data)
      args.push(
        "--header",
        "Content-Type: application/json",
        "--data-binary",
        JSON.stringify(data),
      );
    args.push(url);
    const out = execFileSync(
      process.platform === "win32" ? "curl.exe" : "curl",
      args,
      {
        input: curlConfig,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const at = out.lastIndexOf("\n"),
      status = Number(out.slice(at + 1));
    let result;
    try {
      result = JSON.parse(out.slice(0, at));
    } catch {
      throw new Error(`GitHub returned a non-JSON response (${status}).`);
    }
    if (status < 200 || status >= 300)
      throw new Error(`GitHub release request failed (${status}).`);
    return result;
  }
  const base = "https://api.github.com/repos/dmibing/svnx";
  const tag = `v${audit.version}`;
  const changelog = fs.readFileSync("CHANGELOG.md", "utf8");
  const section = changelog
    .split(`## ${audit.version}`)[1]
    ?.split("\n## ")[0]
    ?.trim();
  if (!section) throw new Error("Release notes are missing.");
  const existing = request(base + "/releases?per_page=100").find(
    (release) => release.tag_name === tag,
  );
  if (existing && !existing.draft)
    throw new Error(
      "This version is already published; do not replace a published update.",
    );
  const release =
    existing ||
    request(base + "/releases", "POST", {
      tag_name: tag,
      target_commitish: audit.commit,
      name: `SVNX ${audit.version}`,
      draft: true,
      prerelease: false,
      body:
        section +
        "\n\n安装版支持自定义目录和应用内升级。便携版无需安装；已有设置继续沿用。\n校验文件见 SHA256SUMS.txt。",
    });
  const names = [
    `SVNX-Setup-${audit.version}-x64.exe`,
    `SVNX-Setup-${audit.version}-x64.exe.blockmap`,
    `SVNX-${audit.version}-win-x64-portable.exe`,
    "SHA256SUMS.txt",
    "latest.yml",
  ];
  for (const name of names) {
    const file = path.resolve("release", name);
    if (!fs.existsSync(file)) throw new Error(`Missing release asset: ${name}`);
    const hash = await digest(file, "sha256");
    const previous = release.assets?.find((asset) => asset.name === name);
    if (previous) {
      if (previous.digest === `sha256:${hash}`) continue;
      throw new Error(
        `Draft already contains a different ${name}; review it before retrying.`,
      );
    }
    console.log(`Uploading ${name}`);
    const asset = request(
      `https://uploads.github.com/repos/dmibing/svnx/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
      "POST",
      null,
      file,
    );
    if (
      asset.state !== "uploaded" ||
      (asset.digest && asset.digest !== `sha256:${hash}`)
    )
      throw new Error(`Upload integrity check failed: ${name}`);
  }
  const published = request(`${base}/releases/${release.id}`, "PATCH", {
    draft: false,
    make_latest: "true",
  });
  console.log(`Published ${published.html_url}`);
}
publishRelease().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
