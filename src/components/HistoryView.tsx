import { useEffect, useState } from "react";
import { Search, ChevronRight, FileCode2, ArrowLeft } from "lucide-react";
import type { LogEntry, Workspace } from "../types";
import { run } from "../client";
import type { Comparison } from "./DiffView";
import Select from "./Select";
import Dialog from "./Dialog";
export default function HistoryView({
  workspace,
  scope,
  onCompare,
  onError,
  onRestore,
}: {
  workspace: Workspace;
  scope: string;
  onCompare: (comparison: Comparison) => void;
  onError: (error: Error) => void;
  onRestore: (revision: number) => void;
}) {
  const [entries, setEntries] = useState<LogEntry[]>([]),
    [selected, setSelected] = useState<LogEntry | null>(null),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(false),
    [hasMore, setHasMore] = useState(true),
    [oldRev, setOldRev] = useState(""),
    [newRev, setNewRev] = useState("");
  const [context, setContext] = useState<{
    entry: LogEntry;
    x: number;
    y: number;
  } | null>(null);
  const [compareEntry, setCompareEntry] = useState<LogEntry | null>(null);
  useEffect(() => {
    if (!context) return;
    const close = () => setContext(null);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", key);
    };
  }, [context]);
  const comparePrevious = (entry: LogEntry, p: LogEntry["paths"][number]) => {
    setCompareEntry(null);
    onCompare({
      path: p.path.replace(/^\//, ""),
      repositoryPath: p.path,
      oldRevision: String(Math.max(0, entry.revision - 1)),
      newRevision: String(entry.revision),
      peg: p.action === "D" ? entry.revision - 1 : entry.revision,
    });
  };
  const load = async (start?: number) => {
    setLoading(true);
    try {
      const next = await run<LogEntry[]>("log", {
        workspaceId: workspace.id,
        path: scope,
        start,
        limit: 100,
      });
      setEntries((previous) =>
        start === undefined ? next : [...previous, ...next],
      );
      if (start === undefined) {
        setSelected(next[0] || null);
        setOldRev(next[0] ? String(Math.max(0, next[0].revision - 1)) : "");
        setNewRev(next[0] ? String(next[0].revision) : "");
      }
      setHasMore(next.length === 100);
    } catch (e) {
      onError(e as Error);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setEntries([]);
    setSelected(null);
    void load();
  }, [workspace.id, scope]);
  const revisionOptions = [
    ...new Set([
      0,
      workspace.revision,
      ...entries.map((entry) => entry.revision),
      ...(selected
        ? [Math.max(0, selected.revision - 1), selected.revision]
        : []),
    ]),
  ]
    .sort((a, b) => b - a)
    .map((revision) => ({
      value: String(revision),
      label: `r${revision}`,
    }));
  return (
    <>
      {context && (
        <div
          className="history-context-menu"
          role="menu"
          aria-label="历史记录操作"
          style={{ left: context.x, top: context.y }}
        >
          <button
            role="menuitem"
            onClick={() => {
              const entry = context.entry;
              setContext(null);
              onRestore(entry.revision);
            }}
          >
            还原到此版本（r{context.entry.revision}）
          </button>
          <button
            role="menuitem"
            disabled={
              !context.entry.paths.length || context.entry.revision === 0
            }
            onClick={() => {
              const entry = context.entry;
              setContext(null);
              if (entry.paths.length === 1)
                comparePrevious(entry, entry.paths[0]);
              else setCompareEntry(entry);
            }}
          >
            与上一版本比较
          </button>
        </div>
      )}
      {compareEntry && (
        <Dialog
          title={`与上一版本比较 · r${compareEntry.revision - 1} → r${compareEntry.revision}`}
          onClose={() => setCompareEntry(null)}
        >
          <p className="modal-caption">选择此提交中的路径查看差异。</p>
          {compareEntry.paths.map((p) => (
            <button
              key={p.path}
              className="historical-path"
              onClick={() => comparePrevious(compareEntry, p)}
            >
              <span>{p.path}</span>
              <span>{p.action}</span>
            </button>
          ))}
        </Dialog>
      )}
      <section className="change-panel">
        <div className="search-row">
          <div className="search-input">
            <Search size={14} />
            <input
              aria-label="搜索已加载历史"
              placeholder="搜索已加载的说明、作者、版本…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="filter-row">
          <span title={scope}>{scope || "整个工作副本"}</span>
          <span>{entries.length} 条记录</span>
        </div>
        <div className="history-list">
          {entries
            .filter((r) =>
              `${r.revision}${r.author}${r.message}${r.date}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((r) => (
              <button
                key={r.revision}
                className={`history-row ${selected?.revision === r.revision ? "selected" : ""}`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSelected(r);
                  setOldRev(String(Math.max(0, r.revision - 1)));
                  setNewRev(String(r.revision));
                  setContext({
                    entry: r,
                    x: Math.max(
                      8,
                      Math.min(event.clientX, window.innerWidth - 240),
                    ),
                    y: Math.max(
                      8,
                      Math.min(event.clientY, window.innerHeight - 100),
                    ),
                  });
                }}
                onClick={() => {
                  setSelected(r);
                  setOldRev(String(Math.max(0, r.revision - 1)));
                  setNewRev(String(r.revision));
                }}
              >
                <div className="history-primary">
                  <span className="history-revision">r{r.revision}</span>
                  <strong title={r.message || "（无提交说明）"}>
                    {r.message || "（无提交说明）"}
                  </strong>
                </div>
                <div className="history-secondary">
                  <span className="history-author">
                    <span className="avatar">{r.author[0]}</span>
                    {r.author}
                  </span>
                  <small>
                    {new Date(r.date).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                  <span className="history-path-count">
                    {r.paths.length} 个路径
                  </span>
                </div>
              </button>
            ))}
          {!entries.length && !loading && (
            <div className="empty">没有历史记录</div>
          )}
        </div>
        <div className="history-pagination">
          <button
            className="button"
            disabled={loading || !hasMore}
            onClick={() => void load(entries.at(-1)!.revision - 1)}
          >
            {loading
              ? "正在读取…"
              : hasMore
                ? "加载更多（100 条）"
                : "已显示全部历史"}
          </button>
        </div>
      </section>
      <section className="diff-panel">
        {selected ? (
          <div className="revision-detail">
            <div className="section-eyebrow">
              所选提交 · r{selected.revision}
            </div>
            <h2>{selected.message || "（无提交说明）"}</h2>
            <div className="revision-detail-meta">
              <span className="avatar">{selected.author[0]}</span>
              {selected.author}
              <span>{new Date(selected.date).toLocaleString("zh-CN")}</span>
              <code>r{selected.revision}</code>
            </div>
            <div className="revision-info">
              <div className="revision-compare-caption">
                <strong>比较版本</strong>
                <span>从原始版本到目标版本，选择下方文件查看差异</span>
              </div>
              <div className="revision-inputs">
                <div className="revision-choice">
                  <span>原始版本</span>
                  <Select
                    label="原始版本"
                    value={oldRev}
                    onValueChange={setOldRev}
                    options={revisionOptions}
                  />
                </div>
                <span className="revision-arrow" aria-hidden="true">
                  →
                </span>
                <div className="revision-choice">
                  <span>目标版本</span>
                  <Select
                    label="目标版本"
                    value={newRev}
                    onValueChange={setNewRev}
                    options={revisionOptions}
                  />
                </div>
              </div>
            </div>
            <h3>
              修改的路径 <span>{selected.paths.length}</span>
            </h3>
            {selected.paths.map((p) => (
              <button
                key={p.path}
                className="historical-path"
                onClick={() => {
                  const old = oldRev || String(selected.revision - 1),
                    next = newRev || String(selected.revision);
                  if (!/^\d+$/.test(old) || !/^\d+$/.test(next))
                    return onError(new Error("请输入非负版本号"));
                  onCompare({
                    path: p.path.replace(/^\//, ""),
                    repositoryPath: p.path,
                    oldRevision: old,
                    newRevision: next,
                    peg:
                      p.action === "D"
                        ? selected.revision - 1
                        : selected.revision,
                  });
                }}
              >
                <FileCode2 size={15} />
                <span>
                  {p.path}
                  {p.copyFrom && (
                    <small className="copy-history">
                      复制自 {p.copyFrom}@{p.copyRevision}
                    </small>
                  )}
                </span>
                <span className="badge modified">{p.action}</span>
                <ChevronRight size={13} />
              </button>
            ))}
            <p className="muted-caption">
              搜索只过滤当前已加载的记录。可继续加载历史；选择文件查看差异。
            </p>
          </div>
        ) : (
          <div className="empty">选择一条提交记录</div>
        )}
      </section>
    </>
  );
}
