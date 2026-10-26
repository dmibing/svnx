import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeft, Folder, Search } from "lucide-react";
import {
  compareHistoryFile,
  type HistoryComparison,
} from "../history-comparison";
import type { LogPath } from "../types";
import FileIcon from "./FileIcon";

const actions: Record<string, string> = {
  A: "新增",
  M: "修改",
  D: "删除",
  R: "替换",
};
export default function HistoryFilesPanel({
  comparison,
  onSelect,
  onBack,
}: {
  comparison: HistoryComparison;
  onSelect: (comparison: HistoryComparison) => void;
  onBack: () => void;
}) {
  const { commit, file } = comparison;
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const prefix = useMemo(() => {
    const directories = commit.paths.map((path) =>
      path.path.split("/").slice(0, -1),
    );
    const shared = [...(directories[0] || [])];
    while (
      shared.length &&
      !directories.every((parts) =>
        shared.every((part, i) => parts[i] === part),
      )
    )
      shared.pop();
    return shared.length ? shared.join("/") + "/" : "/";
  }, [commit.paths]);
  const paths = useMemo(
    () =>
      commit.paths.filter((path) =>
        path.path.toLowerCase().includes(query.toLowerCase().trim()),
      ),
    [commit.paths, query],
  );
  const selected = paths.findIndex((path) => path.path === file.repositoryPath);
  const virtual = useVirtualizer({
    count: paths.length,
    getScrollElement: () => list.current,
    estimateSize: () => 44,
    overscan: 6,
    getItemKey: (index) => paths[index].path,
  });
  useEffect(() => {
    if (selected >= 0) virtual.scrollToIndex(selected, { align: "auto" });
  }, [file.repositoryPath, selected]);
  const select = (path: LogPath) =>
    onSelect(
      compareHistoryFile(commit, path, file.oldRevision, file.newRevision),
    );
  return (
    <>
      <div className="history-files-summary">
        <div className="history-files-title">
          <button
            className="icon-button"
            aria-label="返回历史记录"
            title="返回历史记录"
            onClick={onBack}
          >
            <ArrowLeft size={16} />
          </button>
          <strong>本次提交文件</strong>
          <code>r{commit.revision}</code>
        </div>
        <p title={commit.message}>{commit.message || "（无提交说明）"}</p>
        <span className="history-files-range">
          比较 r{file.oldRevision} → r{file.newRevision}
        </span>
      </div>
      <div className="search-row history-files-search">
        <div className="search-input">
          <Search size={14} />
          <input
            aria-label="搜索本次提交文件"
            placeholder="搜索本次提交文件…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <div className="file-list-heading">
        <span>文件</span>
        <span>
          {query
            ? `${paths.length} / ${commit.paths.length}`
            : commit.paths.length}{" "}
          个路径
        </span>
      </div>
      <div
        className="history-files-list"
        ref={list}
        role="listbox"
        aria-label="本次提交文件"
        tabIndex={0}
        aria-activedescendant={
          selected < 0 ? undefined : `history-file-${selected}`
        }
        onKeyDown={(event) => {
          if (
            !paths.length ||
            !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
          )
            return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? paths.length - 1
                : Math.max(
                    0,
                    Math.min(
                      paths.length - 1,
                      selected + (event.key === "ArrowUp" ? -1 : 1),
                    ),
                  );
          select(paths[next]);
        }}
      >
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((item) => {
            const path = paths[item.index];
            const name = path.path.split("/").at(-1) || path.path;
            const relative = path.path.startsWith(prefix)
              ? path.path.slice(prefix.length)
              : path.path.replace(/^\//, "");
            const directory =
              relative.split("/").slice(0, -1).join("/") || "提交目录";
            return (
              <button
                key={path.path}
                id={`history-file-${item.index}`}
                role="option"
                aria-selected={path.path === file.repositoryPath}
                aria-posinset={item.index + 1}
                aria-setsize={paths.length}
                tabIndex={-1}
                className={`file-row history-file-row${path.path === file.repositoryPath ? " selected" : ""}`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${item.start}px)`,
                }}
                title={`${path.path}${path.copyFrom ? `\n复制自 ${path.copyFrom}@${path.copyRevision}` : ""}`}
                onClick={() => select(path)}
              >
                {path.kind === "dir" ? (
                  <Folder size={16} className="file-icon" />
                ) : (
                  <FileIcon path={path.path} />
                )}
                <span className="file-name">
                  <span>{name}</span>
                  <small>{directory}</small>
                </span>
                <span
                  className={`badge ${path.action === "A" ? "added" : path.action === "D" ? "deleted" : "modified"}`}
                  title={actions[path.action] || path.action}
                >
                  {path.action}
                </span>
              </button>
            );
          })}
        </div>
        {!paths.length && <div className="empty">没有匹配的文件</div>}
      </div>
    </>
  );
}
