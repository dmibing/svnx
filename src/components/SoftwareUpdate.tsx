import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { bridge, unwrap } from "../client";
import type { SoftwareUpdateState } from "../types";

export default function SoftwareUpdate() {
  const [state, setState] = useState<SoftwareUpdateState | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const receive = (next: SoftwareUpdateState) =>
    setState((previous) =>
      !previous || (next.sequence ?? 0) >= (previous.sequence ?? 0)
        ? next
        : previous,
    );
  useEffect(() => {
    if (!window.svnx) return;
    let active = true;
    const remove = bridge().onEvent((event) => {
      if (event.type === "software-update" && active)
        receive(event.state as SoftwareUpdateState);
    });
    void bridge()
      .softwareUpdate("status")
      .then(unwrap)
      .then((state) => {
        if (active) receive(state);
      })
      .catch(() => {});
    return () => {
      active = false;
      remove();
    };
  }, []);
  const action = async (
    action: Parameters<ReturnType<typeof bridge>["softwareUpdate"]>[0],
  ) => {
    setError("");
    try {
      receive(unwrap(await bridge().softwareUpdate(action)));
    } catch (error) {
      setError((error as Error).message);
    }
  };
  if (!state) return null;
  const ready = state.phase === "downloaded";
  const downloading = state.phase === "downloading";
  const busy = ["checking", "downloading", "installing"].includes(state.phase);
  return (
    <section className="software-update-section" aria-label="软件更新">
      <div className="software-update-heading">
        <div>
          <h3>软件更新</h3>
          <p>
            当前版本 {state.currentVersion}
            {state.version && state.phase !== "unavailable"
              ? ` · 新版本 ${state.version}`
              : ""}
          </p>
        </div>
        {!ready && (
          <button
            className="button"
            disabled={busy}
            onClick={() => void action("check")}
          >
            <RefreshCw size={13} />
            {state.phase === "checking" ? "正在检查…" : "检查软件更新"}
          </button>
        )}
      </div>
      {state.mode !== "installed" && (
        <p className="muted-caption">
          当前为便携／免安装运行方式。下载安装版后，可在应用内下载并重启升级；设置继续沿用。
        </p>
      )}
      {state.phase === "unavailable" && (
        <p role="status">当前已是最新正式版本。</p>
      )}
      {state.phase === "available" && state.mode === "installed" && (
        <button className="button" onClick={() => void action("download")}>
          <Download size={13} />
          下载更新
        </button>
      )}
      {downloading && (
        <div>
          <progress
            aria-label="更新下载进度"
            max={100}
            value={state.progress || 0}
          />
          <span> {Math.floor(state.progress || 0)}%</span>
          <button className="button" onClick={() => void action("cancel")}>
            取消下载
          </button>
        </div>
      )}
      {ready && !confirm && (
        <button className="button primary" onClick={() => setConfirm(true)}>
          重启并安装更新
        </button>
      )}
      {ready && confirm && (
        <div className="software-update-confirm">
          <p>
            将关闭当前窗口并安装更新。请先保存未完成的冲突编辑；设置和工作副本保持不变。
          </p>
          <button
            className="button primary"
            onClick={() => void action("install")}
          >
            确认重启安装
          </button>
          <button className="button" onClick={() => setConfirm(false)}>
            稍后
          </button>
        </div>
      )}
      {state.phase === "installing" && <p role="status">正在重启升级…</p>}
      {(error || state.error) && (
        <p className="inline-warning" role="alert">
          {error || state.error}
        </p>
      )}
      {state.notes &&
        ["available", "downloading", "downloaded"].includes(state.phase) && (
          <details>
            <summary>版本更新说明</summary>
            <pre className="software-update-notes">{state.notes}</pre>
          </details>
        )}
      <button className="button subtle" onClick={() => void action("release")}>
        {state.mode === "installed"
          ? "查看发布页"
          : "前往发布页下载安装版或便携版"}
      </button>
    </section>
  );
}
