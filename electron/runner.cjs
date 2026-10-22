const { spawn, spawnSync } = require("node:child_process");
// SVN on Windows reads --targets and stdin in the system ANSI code page.
const codePage =
  process.platform === "win32"
    ? spawnSync(
        "reg.exe",
        [
          "query",
          "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage",
          "/v",
          "ACP",
        ],
        { encoding: "utf8", windowsHide: true },
      ).stdout?.match(/REG_SZ\s+(\d+)/)?.[1]
    : "65001";
const nativeEncoding =
  codePage === "65001" ? "utf8" : codePage ? "cp" + codePage : "gb18030";
const iconv = require("iconv-lite");
class SvnError extends Error {
  constructor(message, code = "SVN", details = "") {
    super(message);
    this.code = code;
    this.details = details;
  }
}
function classify(text) {
  if (
    /E170001|E215004|E170013.*authentication|authentication failed|authorization failed|认证失败/i.test(
      text,
    )
  )
    return "AUTH";
  if (/E230001|certificate verification|证书验证/i.test(text))
    return "CERTIFICATE";
  if (/E155004|E155037|locked|cleanup/i.test(text)) return "WC_LOCKED";
  if (/E155011|E160028|out.of.date/i.test(text)) return "OUT_OF_DATE";
  if (/E170013|E175002|E730061|could not connect|无法连接/i.test(text))
    return "NETWORK";
  return "SVN";
}
function decodeOutput(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return iconv.decode(
      buffer,
      process.platform === "win32" ? nativeEncoding : "utf8",
    );
  }
}
function run(
  executable,
  args,
  {
    cwd,
    signal,
    credentials,
    progress,
    maxBytes = 128 * 1024 * 1024,
    timeout = 0,
  } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(
        new SvnError("任务已取消；请刷新工作副本确认实际状态", "CANCELLED"),
      );
    const safeArgs = ["--non-interactive", ...args];
    if (credentials) {
      safeArgs.unshift(
        "--no-auth-cache",
        "--username",
        credentials.username,
        "--password-from-stdin",
      );
      if (credentials.trust?.length)
        safeArgs.unshift(
          "--trust-server-cert-failures",
          credentials.trust.join(","),
        );
    }
    const child = spawn(executable, safeArgs, {
      cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform === "win32",
      env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out = [],
      err = [];
    let size = 0,
      killedForLimit = false;
    let timer;
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        const killer = spawn(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true },
        );
        killer.on("error", () => child.kill());
      } else child.kill("SIGTERM");
    };
    const abort = () => stop();
    signal?.addEventListener("abort", abort, { once: true });
    if (timeout) timer = setTimeout(stop, timeout);
    child.stdin.on("error", () => {});
    child.stdin.end(
      credentials
        ? iconv.encode(credentials.password, nativeEncoding)
        : undefined,
    );
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        killedForLimit = true;
        stop();
      } else out.push(chunk);
      progress?.(chunk.length);
    });
    child.stderr.on("data", (chunk) => {
      if (err.reduce((n, x) => n + x.length, 0) < 1024 * 1024) err.push(chunk);
    });
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      clearTimeout(timer);
    };
    child.on("error", (error) => {
      cleanup();
      reject(
        new SvnError(
          error.code === "ENOENT"
            ? "找不到 SVN，请在设置中选择 SVN 1.14 或更高版本的可执行文件"
            : error.message,
          "ENGINE",
        ),
      );
    });
    child.on("close", (code) => {
      cleanup();
      if (signal?.aborted)
        return reject(
          new SvnError(
            "任务已取消。提交可能已在服务器完成，请先核对历史，勿直接重试。",
            "CANCELLED",
          ),
        );
      if (killedForLimit)
        return reject(
          new SvnError(
            "结果超过资源限制，请缩小操作范围或使用外部工具",
            "LIMIT",
          ),
        );
      if (code !== 0) {
        let message = decodeOutput(Buffer.concat(err));
        if (credentials?.password)
          message = message.split(credentials.password).join("[已隐藏]");
        message = message.replace(
          /(https?:\/\/)[^/@\s]+:[^/@\s]+@/g,
          "$1[已隐藏]@",
        );
        return reject(
          new SvnError(
            `${args[0]}: ${message || `SVN 退出码 ${code}`}`,
            classify(message),
          ),
        );
      }
      resolve(Buffer.concat(out));
    });
  });
}
module.exports = { run, SvnError, decodeOutput, nativeEncoding };
