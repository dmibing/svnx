import { useEffect, useState } from "react";
import { Search, ChevronRight, FileCode2, ArrowLeft } from "lucide-react";
import type { LogEntry, Workspace } from "../types";
import { run } from "../client";
import type { Comparison } from "./DiffView";
export default function HistoryView({
  workspace,
  scope,
  onCompare,
  onError,
}: {
  workspace: Workspace;
  scope: string;
  onCompare: (comparison: Comparison) => void;
  onError: (error: Error) => void;
}) {
  const [entries, setEntries] = useState<LogEntry[]>([]),
    [selected, setSelected] = useState<LogEntry | null>(null),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(false),
    [hasMore, setHasMore] = useState(true),
    [oldRev, setOldRev] = useState(""),
    [newRev, setNewRev] = useState("");
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
      if (start === undefined) setSelected(next[0] || null);
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
  return (
    <>
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
                onClick={() => {
                  setSelected(r);
                  setOldRev(String(Math.max(0, r.revision - 1)));
                  setNewRev(String(r.revision));
                }}
              >
                <div>
                  <span className="history-revision">r{r.revision}</span>
                  <small>
                    {new Date(r.date).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </div>
                <strong>{r.message || "（无提交说明）"}</strong>
                <span className="history-author">
                  <span className="avatar">{r.author[0]}</span>
                  {r.author}
                  <span>{r.paths.length} 个路径</span>
                </span>
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
            <div className="section-eyebrow">提交详情</div>
            <h2>{selected.message || "（无提交说明）"}</h2>
            <div className="revision-detail-meta">
              <span className="avatar">{selected.author[0]}</span>
              {selected.author}
              <span>{new Date(selected.date).toLocaleString("zh-CN")}</span>
              <code>r{selected.revision}</code>
            </div>
            <div className="revision-info">
              <span>比较版本</span>
              <div className="revision-inputs">
                <input
                  aria-label="原始版本"
                  placeholder={String(selected.revision - 1)}
                  value={oldRev}
                  onChange={(e) => setOldRev(e.target.value)}
                />
                <span>→</span>
                <input
                  aria-label="目标版本"
                  placeholder={String(selected.revision)}
                  value={newRev}
                  onChange={(e) => setNewRev(e.target.value)}
                />
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
