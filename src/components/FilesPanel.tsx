import { useRef, useState, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Search,
  RefreshCw,
  ListFilter,
  FileCode2,
  CheckCheck,
  RotateCcw,
  MoreHorizontal,
  Folder,
} from "lucide-react";
import type { FileEntry } from "../types";
import { statusNames, letters } from "../i18n/zh-CN";
import { filterFiles } from "../file-filter";
import Select from "./Select";
export function Badge({ file }: { file: FileEntry }) {
  const status =
    file.treeConflict || file.props === "conflicted"
      ? "conflicted"
      : file.status;
  return (
    <span
      className={`badge ${status === "unversioned" ? "untracked" : status === "conflicted" ? "conflict" : status}`}
      title={`${statusNames[status] || status}${file.props === "modified" ? " · 属性已修改" : ""}${file.lock ? ` · 锁所有者 ${file.lock.owner}` : ""}`}
    >
      {letters[status] || status[0]}
    </span>
  );
}
export default function FilesPanel({
  files,
  selected,
  checked,
  onSelect,
  onCheck,
  query,
  onQuery,
  filter,
  onFilter,
  refresh,
  loading,
  onAction,
  menu,
  setMenu,
}: {
  files: FileEntry[];
  selected: string;
  checked: string[];
  onSelect: (f: FileEntry) => void;
  onCheck: (ids: string[]) => void;
  query: string;
  onQuery: (v: string) => void;
  filter: string;
  onFilter: (v: string) => void;
  refresh: () => void;
  loading: boolean;
  onAction: (action: string) => void;
  menu: boolean;
  setMenu: (v: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuPoint, setMenuPoint] = useState({ x: 0, y: 0 });
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    setMenuPosition({
      x: Math.max(8, Math.min(menuPoint.x, window.innerWidth - rect.width - 8)),
      y: Math.max(
        8,
        Math.min(menuPoint.y, window.innerHeight - rect.height - 8),
      ),
    });
    menuRef.current.querySelector<HTMLButtonElement>("button")?.focus();
  }, [menu, menuPoint]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: Event) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !triggerRef.current?.contains(event.target as Node)
      )
        setMenu(false);
    };
    const close = () => setMenu(false);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") {
        setMenu(false);
        if (event.key === "Escape") triggerRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", key);
    };
  }, [menu, setMenu]);
  useEffect(() => {
    setMenu(false);
  }, [query, filter]);
  const visible = filterFiles(files, query, filter);
  const virtual = useVirtualizer({
    count: visible.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 44,
    overscan: 8,
  });
  return (
    <>
      <div className="search-row">
        <div className="search-input">
          <Search size={14} />
          <input
            placeholder="搜索文件…"
            aria-label="搜索文件"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
        <button
          title="刷新状态 (F5)"
          className="icon-button"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? "spin" : ""} />
        </button>
      </div>
      <div className="filter-row">
        <span>
          <ListFilter size={13} />
          <Select
            label="状态筛选"
            value={filter}
            onValueChange={onFilter}
            options={[
              { value: "all", label: "全部状态" },
              ...Object.entries(statusNames)
                .filter(([value]) => !["added", "normal"].includes(value))
                .map(([value, label]) => ({
                  value,
                  label: value === "modified" ? "修改" : label,
                })),
            ]}
          />
        </span>
        <span>{visible.length.toLocaleString("zh-CN")} 个文件</span>
      </div>
      <div className="file-list-heading">
        <input
          type="checkbox"
          aria-label="选择所有可见文件"
          checked={
            visible.length > 0 && visible.every((f) => checked.includes(f.path))
          }
          onChange={() =>
            onCheck(
              visible.every((f) => checked.includes(f.path))
                ? checked.filter((p) => !visible.some((f) => f.path === p))
                : [...new Set([...checked, ...visible.map((f) => f.path)])],
            )
          }
        />
        <span>文件</span>
        <span>状态</span>
      </div>
      <div className="file-list" ref={ref}>
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((row) => {
            const file = visible[row.index];
            return (
              <div
                key={file.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${row.start}px)`,
                }}
                role="button"
                tabIndex={0}
                className={`file-row ${selected === file.path ? "selected" : ""}`}
                onClick={() => onSelect(file)}
                onKeyDown={(e) => {
                  if (
                    e.target === e.currentTarget &&
                    (e.key === "Enter" || e.key === " ")
                  ) {
                    e.preventDefault();
                    onSelect(file);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onSelect(file);
                  onCheck([file.path]);
                  setMenuPoint({ x: e.clientX, y: e.clientY });
                  setMenu(true);
                }}
              >
                <input
                  type="checkbox"
                  aria-label={`选择 ${file.path || "工作副本根目录"}`}
                  checked={checked.includes(file.path)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() =>
                    onCheck(
                      checked.includes(file.path)
                        ? checked.filter((x) => x !== file.path)
                        : [...checked, file.path],
                    )
                  }
                />
                <FileCode2 className="file-icon" size={15} />
                <div
                  className="file-name"
                  title={file.path || "工作副本根目录"}
                >
                  <span>
                    {file.path.split("/").at(-1) || "工作副本根目录"}
                    {file.props === "modified" && (
                      <em className="property-indicator">属性</em>
                    )}
                    {file.lock && <em className="property-indicator">锁</em>}
                  </span>
                  <small>
                    {file.path.split("/").slice(0, -1).join("/") ||
                      "项目根目录"}
                    {file.copied ? " · 保留历史" : ""}
                  </small>
                </div>
                <Badge file={file} />
              </div>
            );
          })}
        </div>
        {!visible.length && (
          <div className="empty">
            <CheckCheck size={28} />
            <strong>
              {query || filter !== "all" ? "没有匹配的文件" : "工作副本干净"}
            </strong>
            <span>
              {query || filter !== "all"
                ? "试试其他关键词或状态"
                : "没有待提交的变更，可使用“浏览文件”查看项目。"}
            </span>
          </div>
        )}
      </div>
      <div className="list-summary">
        <span>
          {checked.length
            ? `已选择 ${checked.length} 个文件`
            : `${files.length.toLocaleString("zh-CN")} 个变更文件`}
        </span>
        {loading && <span>正在刷新…</span>}
      </div>
      <div className="file-actions">
        <button
          className="button subtle"
          disabled={!checked.length && !selected}
          onClick={() => onAction("revert")}
        >
          <RotateCcw size={13} />
          还原{checked.length ? ` (${checked.length})` : ""}
        </button>
        <button className="button subtle" onClick={() => onAction("browse")}>
          <Folder size={13} />
          浏览文件
        </button>
        <div className="menu-anchor">
          <button
            className="icon-button"
            title="更多文件操作"
            ref={triggerRef}
            aria-expanded={menu}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenuPoint({ x: rect.left, y: rect.bottom + 4 });
              setMenu(!menu);
            }}
          >
            <MoreHorizontal size={17} />
          </button>
          {menu &&
            createPortal(
              <div
                ref={menuRef}
                className="dropdown file-context-menu"
                role="menu"
                aria-label="文件操作"
                style={{ left: menuPosition.x, top: menuPosition.y }}
              >
                {[
                  ["add", "添加到版本控制"],
                  ["delete", "删除并保留备份"],
                  ["move", "移动／重命名"],
                  ["ignore", "忽略未跟踪文件"],
                  ["properties", "查看／修改属性"],
                  ["conflict", "解决冲突"],
                  ["lock", "加锁"],
                  ["unlock", "解锁"],
                  ["updateSelected", "更新所选路径"],
                  ["cleanup", "清理工作副本"],
                  ["reveal", "在文件管理器中显示"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      onAction(id);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>,
              document.body,
            )}
        </div>
      </div>
    </>
  );
}
