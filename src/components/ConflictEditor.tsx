import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { run, bridge } from "../client";
import type { Conflict, Workspace } from "../types";
import {
  acceptConflict,
  conflictSections,
  hasConflictMarkers,
} from "../conflict-sections";
import FileIcon from "./FileIcon";
const SourceEditor = lazy(() => import("../Editor"));
const ResultEditor = lazy(() =>
  import("../Editor").then((module) => ({ default: module.ResultEditor })),
);
const drafts = new Map<string, { fingerprint: string; value: string }>();
export default function ConflictEditor({
  workspace,
  path,
  dark,
  onResolved,
  onOther,
}: {
  workspace: Workspace;
  path: string;
  dark: boolean;
  onResolved: () => Promise<void>;
  onOther: () => void;
}) {
  const [data, setData] = useState<Conflict | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [focusBlock, setFocusBlock] = useState(0);
  const [reveal, setReveal] = useState<{ index: number; offset: number }>();
  const key = `${workspace.id}:${path}`;
  const fingerprint = useRef("");
  const change = (value: string) => {
    setResult(value);
    if (fingerprint.current) {
      drafts.delete(key);
      drafts.set(key, { fingerprint: fingerprint.current, value });
      if (drafts.size > 5) drafts.delete(drafts.keys().next().value!);
    }
  };
  const load = () => {
    const id = crypto.randomUUID();
    let active = true;
    setLoading(true);
    setError("");
    void run<Conflict>("conflict", { workspaceId: workspace.id, path }, { id })
      .then((value) => {
        if (!active) return;
        setData(value);
        fingerprint.current = value.fingerprint;
        const draft = drafts.get(key);
        setResult(
          draft?.fingerprint === value.fingerprint
            ? draft.value
            : value.current.text,
        );
        setNotice(
          draft
            ? draft.fingerprint === value.fingerprint
              ? "已恢复本次运行中暂存的合并草稿。"
              : "文件已被外部修改，未套用旧草稿，请重新核对。"
            : "",
        );
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      void bridge().cancel(id);
    };
  };
  useEffect(load, [workspace.id, path]);
  const blocks = useMemo(() => conflictSections(result), [result]);
  const block = blocks[Math.min(focusBlock, Math.max(0, blocks.length - 1))];
  const local = data?.files["prev-wc-file"]?.text;
  const remote = data?.files["cur-base-file"]?.text;
  const editable =
    !!data?.kinds.includes("text") &&
    !data.current.binary &&
    local !== undefined &&
    remote !== undefined &&
    result.length + local.length + remote.length < 10000000;
  const sources = useMemo(
    () => ({ path, before: local || "", after: remote || "" }),
    [path, local, remote],
  );
  const save = async () => {
    if (!data || busy || hasConflictMarkers(result)) return;
    setBusy(true);
    setError("");
    try {
      await run("resolve", {
        workspaceId: workspace.id,
        path,
        kind: "text",
        accept: "working",
        content: result,
        fingerprint: data.fingerprint,
      });
      drafts.delete(key);
      await onResolved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="merge-view">
      <div className="diff-heading">
        <FileIcon path={path} />
        <strong>{path.split("/").at(-1)}</strong>
        <span className="merge-status">
          {data?.current.binary ? "二进制冲突" : "文本冲突"}
        </span>
        <button className="button subtle" onClick={onOther} disabled={busy}>
          其他冲突处理
        </button>
      </div>
      {loading ? (
        <div className="empty">正在读取冲突版本…</div>
      ) : !editable ? (
        <div className="empty">
          <strong>此冲突无法直接作为文本合并</strong>
          <span>
            {error ||
              "可能是二进制、缺少冲突来源、文件过大或涉及目录结构，请使用其他冲突处理。"}
          </span>
          <button className="button" onClick={onOther}>
            打开冲突处理
          </button>
        </div>
      ) : (
        <>
          <div className="merge-toolbar">
            <span>左侧：本地内容　右侧：远端内容</span>
            <button
              className="button"
              disabled={busy}
              onClick={() => change(local!)}
            >
              使用左侧全部内容
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => change(remote!)}
            >
              使用右侧全部内容
            </button>
          </div>
          <div className="merge-sources">
            <Suspense fallback={<div className="empty">正在加载编辑器…</div>}>
              <SourceEditor
                file={sources}
                dark={dark}
                inline={false}
                ignoreWhitespace={false}
                direction={{ index: 0, forward: true }}
              />
            </Suspense>
          </div>
          <div className="merge-toolbar merge-block-toolbar">
            <strong>合并结果</strong>
            <span>
              {blocks.length
                ? `剩余 ${blocks.length} 个冲突块`
                : hasConflictMarkers(result)
                  ? "仍有冲突标记，请手动处理"
                  : "冲突标记已清除，请检查结果"}
            </span>
            {block && (
              <>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    const next =
                      (Math.min(focusBlock, blocks.length - 1) + 1) %
                      blocks.length;
                    setFocusBlock(next);
                    setReveal((previous) => ({
                      index: (previous?.index || 0) + 1,
                      offset: blocks[next].start,
                    }));
                  }}
                >
                  切换冲突块（{Math.min(focusBlock, blocks.length - 1) + 1}/
                  {blocks.length}）
                </button>
                {(["local", "remote", "both", "remoteFirst"] as const).map(
                  (choice) => (
                    <button
                      className="button"
                      disabled={busy}
                      key={choice}
                      onClick={() => {
                        const next = acceptConflict(result, block, choice);
                        change(next);
                        setFocusBlock(0);
                        setReveal((previous) => ({
                          index: (previous?.index || 0) + 1,
                          offset: conflictSections(next)[0]?.start || 0,
                        }));
                      }}
                    >
                      {
                        {
                          local: "本块采用左侧",
                          remote: "本块采用右侧",
                          both: "本块先左后右",
                          remoteFirst: "本块先右后左",
                        }[choice]
                      }
                    </button>
                  ),
                )}
              </>
            )}
          </div>
          <div className="merge-result">
            <Suspense fallback={<div className="empty">正在加载合并结果…</div>}>
              <ResultEditor
                path={path}
                value={result}
                dark={dark}
                onChange={change}
                disabled={busy}
                reveal={reveal}
              />
            </Suspense>
          </div>
          {error && (
            <div className="merge-error" role="alert">
              {error}
              　如文件已外部修改，请切换文件后重新打开，草稿会暂存在本次运行中。
            </div>
          )}
          {notice && <div className="merge-note">{notice}</div>}
          <div className="merge-save">
            <span>下方结果可编辑。保存前备份；含冲突标记时不能标记解决。</span>
            <button
              className="button primary"
              disabled={busy || hasConflictMarkers(result)}
              onClick={() => void save()}
            >
              {busy ? "正在保存…" : "保存并标记解决"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
