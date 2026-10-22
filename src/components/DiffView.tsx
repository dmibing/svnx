import { lazy, Suspense, useEffect, useState, useRef } from "react";
import {
  ArrowUp,
  ArrowDown,
  Columns2,
  List,
  FileCode2,
  Copy,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import type { Diff, FileEntry, Workspace } from "../types";
import { run, bridge, unwrap } from "../client";
import { Badge } from "./FilesPanel";
import Select from "./Select";
const Editor = lazy(() => import("../Editor"));
export interface Comparison {
  path: string;
  oldRevision: string;
  newRevision: string;
  repositoryPath: string;
  peg: number;
  label?: string;
}
export default function DiffView({
  workspace,
  file,
  dark,
  comparison,
  onError,
  onConflict,
}: {
  workspace: Workspace;
  file: FileEntry | null;
  dark: boolean;
  comparison: Comparison | null;
  onError: (e: Error) => void;
  onConflict: () => void;
}) {
  const [data, setData] = useState<Diff | null>(null),
    [loading, setLoading] = useState(false),
    [inline, setInline] = useState(false),
    [ignore, setIgnore] = useState(false),
    [encoding, setEncoding] = useState("auto"),
    [loadLarge, setLoadLarge] = useState(false),
    [tab, setTab] = useState("content"),
    [direction, setDirection] = useState({ index: 0, forward: true });
  const sequence = useRef(0);
  const target = comparison?.path ?? file?.path;
  useEffect(() => {
    setLoadLarge(false);
    setEncoding("auto");
    setData(null);
    setTab("content");
  }, [workspace.id, target, comparison?.newRevision, comparison?.oldRevision]);
  const request = {
    workspaceId: workspace.id,
    path: target ?? "",
    ...comparison,
    encoding,
    loadLarge,
  };
  useEffect(() => {
    if (target === undefined) return;
    const index = ++sequence.current,
      id = crypto.randomUUID();
    setLoading(true);
    run<Diff>("diff", request, { id })
      .then((result) => {
        if (index === sequence.current) setData(result);
      })
      .catch((e) => {
        if (index === sequence.current && e.code !== "CANCELLED") onError(e);
      })
      .finally(() => {
        if (index === sequence.current) setLoading(false);
      });
    return () => {
      sequence.current++;
      void bridge().cancel(id);
    };
  }, [
    workspace.id,
    target,
    comparison?.oldRevision,
    comparison?.newRevision,
    comparison?.repositoryPath,
    encoding,
    loadLarge,
    file,
  ]);
  if (target === undefined)
    return (
      <div className="empty diff-empty">
        <div className="empty-icon">
          <Columns2 size={28} />
        </div>
        <strong>每一处变更，一目了然</strong>
        <span>从左侧选择文件，查看修改前后的差异。</span>
      </div>
    );
  const external = () => {
    void bridge().externalDiff(request).then(unwrap).catch(onError);
  };
  return (
    <>
      <div className="diff-heading">
        <FileCode2 size={16} />
        <span title={target}>
          {target?.split("/").at(-1) || "工作副本根目录"}
        </span>
        {file && <Badge file={file} />}
        <button
          className="icon-button push-right"
          title="复制相对路径"
          onClick={() =>
            navigator.clipboard.writeText(target || "").catch(onError)
          }
        >
          <Copy size={13} />
        </button>
        <button
          className="icon-button"
          title="使用外部差异工具"
          onClick={external}
        >
          <ExternalLink size={13} />
        </button>
      </div>
      <div className="diff-toolbar">
        <div>
          <span className="mono">
            {comparison ? `r${comparison.oldRevision}` : "BASE"}
          </span>
          <span className="compare-arrow">→</span>
          <span>{comparison ? `r${comparison.newRevision}` : "工作副本"}</span>
        </div>
        <div>
          <button
            className={`text-toggle ${tab === "properties" ? "toggled" : ""}`}
            onClick={() =>
              setTab(tab === "properties" ? "content" : "properties")
            }
          >
            属性
          </button>
          <button
            className={ignore ? "icon-button toggled" : "icon-button"}
            aria-label="忽略空白"
            title="忽略行首尾空白"
            onClick={() => setIgnore(!ignore)}
          >
            ≋
          </button>
          <span className="toolbar-divider" />
          <button
            className={`icon-button ${!inline ? "toggled" : ""}`}
            title="并排对比"
            onClick={() => setInline(false)}
          >
            <Columns2 size={14} />
          </button>
          <button
            className={`icon-button ${inline ? "toggled" : ""}`}
            title="行内对比"
            onClick={() => setInline(true)}
          >
            <List size={15} />
          </button>
          <button
            className="icon-button"
            title="上一处变更"
            onClick={() =>
              setDirection((d) => ({ index: d.index + 1, forward: false }))
            }
          >
            <ArrowUp size={14} />
          </button>
          <button
            className="icon-button"
            title="下一处变更"
            onClick={() =>
              setDirection((d) => ({ index: d.index + 1, forward: true }))
            }
          >
            <ArrowDown size={14} />
          </button>
        </div>
      </div>
      {!comparison &&
        file &&
        (file.status === "conflicted" ||
          file.treeConflict ||
          file.props === "conflicted") && (
          <div className="conflict-banner">
            <AlertTriangle size={14} />
            <span>此路径存在冲突，需要先解决再提交。</span>
            <button onClick={onConflict}>解决冲突</button>
          </div>
        )}
      {loading && <div className="loading-strip">正在读取差异…</div>}
      <div className="editor-container">
        {!data ? (
          <div className="empty">
            {loading ? "正在加载…" : "未能读取差异，请刷新或重新选择文件。"}
          </div>
        ) : tab === "properties" ? (
          <pre className="property-diff">
            {data.properties || "没有属性变更。"}
          </pre>
        ) : data.large ? (
          <div className="empty">
            <AlertTriangle size={25} />
            <strong>文件超过自动预览限制</strong>
            <span>超过 5 MB 的文件不自动加载；手动加载上限为 32 MB。</span>
            {!loadLarge && (
              <button className="button" onClick={() => setLoadLarge(true)}>
                仍然加载
              </button>
            )}
            <button
              className="button"
              onClick={() =>
                void bridge()
                  .reveal({ workspaceId: workspace.id, path: target })
                  .then(unwrap)
                  .catch(onError)
              }
            >
              在文件管理器中显示
            </button>
          </div>
        ) : data.binary ? (
          <div className="empty">
            <FileCode2 size={28} />
            <strong>二进制文件</strong>
            <span>
              BASE：{data.oldBytes?.toLocaleString()} 字节 · 当前：
              {data.newBytes?.toLocaleString()} 字节
            </span>
            <button
              className="button"
              onClick={() =>
                void bridge()
                  .reveal({ workspaceId: workspace.id, path: target })
                  .then(unwrap)
                  .catch(onError)
              }
            >
              在文件管理器中显示
            </button>
          </div>
        ) : data.directory ? (
          <div className="empty">
            <strong>目录</strong>
            <span>可切换到“属性”查看目录属性变更。</span>
          </div>
        ) : (
          <>
            <div className="editor-labels">
              <span>
                原始内容
                <code>
                  {comparison ? `r${comparison.oldRevision}` : "BASE"}
                </code>
              </span>
              {!inline && (
                <span>
                  修改内容
                  <code>
                    {comparison ? `r${comparison.newRevision}` : "WORKING"}
                  </code>
                </span>
              )}
            </div>
            <div className="monaco-slot">
              <Suspense
                fallback={<div className="empty">正在加载差异编辑器…</div>}
              >
                <Editor
                  file={data}
                  dark={dark}
                  inline={inline}
                  ignoreWhitespace={ignore}
                  direction={direction}
                />
              </Suspense>
            </div>
          </>
        )}
      </div>
      <div className="diff-footer">
        <span title={target}>{target}</span>
        <span>
          <Select
            label="文件编码"
            value={encoding}
            onValueChange={setEncoding}
            options={[
              {
                value: "auto",
                label: data?.encoding?.toUpperCase() || "自动编码",
              },
              { value: "utf-8", label: "UTF-8" },
              { value: "gb18030", label: "GB18030" },
              { value: "utf-16le", label: "UTF-16 LE" },
              { value: "utf-16be", label: "UTF-16 BE" },
            ]}
          />
          <span className="footer-divider" />
          {data?.eol || "LF"}
        </span>
      </div>
    </>
  );
}
