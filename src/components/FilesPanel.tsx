import { useRef, useState, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import FileIcon from "./FileIcon";
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
  List,
  ListTree,
  ChevronRight,
  ChevronDown,
  ChevronsDownUp,
} from "lucide-react";
import type { FileEntry } from "../types";
import { statusNames, letters } from "../i18n/zh-CN";
import { filterFiles, isVersionedChange } from "../file-filter";
import Select from "./Select";
import { buildFileTree, flattenFileTree } from "../file-tree";
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
  const [layout, setLayout] = useState(() =>
    localStorage.getItem("svnx.fileLayout") === "tree" ? "tree" : "list",
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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
    menuRef.current
      .querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
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
    setCollapsed(new Set());
  }, [query, filter]);
  const visible = useMemo(
    () => filterFiles(files, query, filter),
    [files, query, filter],
  );
  const tree = useMemo(() => buildFileTree(visible), [visible]);
  const rows = useMemo(
    () =>
      layout === "tree"
        ? flattenFileTree(tree, collapsed)
        : visible.map((file) => ({
            node: { path: file.path, file, children: [], entries: [file] },
            depth: 0,
          })),
    [visible, tree, layout, collapsed, query],
  );
  const checkedSet = useMemo(() => new Set(checked), [checked]);
  const clean =
    !files.some(isVersionedChange) &&
    !query &&
    ["all", "modified"].includes(filter);
  const toggleGroup = (entries: FileEntry[]) => {
    const paths = new Set(entries.map((file) => file.path));
    onCheck(
      entries.every((file) => checkedSet.has(file.path))
        ? checked.filter((path) => !paths.has(path))
        : [...new Set([...checked, ...paths])],
    );
  };
  const toggleDirectory = (path: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const virtual = useVirtualizer({
    count: rows.length,
    getItemKey: (index) => rows[index].node.path,
    getScrollElement: () => ref.current,
    estimateSize: () => (layout === "tree" ? 32 : 44),
    overscan: 8,
  });
  const stateControl = (
    <Select
      icon={<ListFilter size={14} />}
      label="状态筛选"
      value={filter}
      onValueChange={onFilter}
      options={[
        { value: "all", label: "全部变更" },
        ...Object.entries(statusNames)
          .filter(([value]) => !["added", "normal"].includes(value))
          .map(([value, label]) => ({
            value,
            label:
              value === "modified"
                ? "修改"
                : value === "unversioned"
                  ? `未跟踪 · ${files.filter((file) => file.status === "unversioned").length}`
                  : label,
          })),
      ]}
    />
  );
  return (
    <>
      <div className="file-toolbar">
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
        <div className="filter-row file-state-filter">
          <span>{stateControl}</span>
        </div>
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
        <span className="compact-state-filter">{stateControl}</span>
        <span className="file-heading-name">
          <span className="file-heading-caption">文件 </span>
          <small className="file-visible-count">
            {visible.length.toLocaleString("zh-CN")} 个文件
          </small>
        </span>
        <span className="file-state-heading">状态</span>
        <div
          className="file-layout-actions"
          role="group"
          aria-label="文件显示方式"
        >
          {layout === "tree" && (
            <button
              className="icon-button"
              title="折叠全部目录"
              aria-label="折叠全部目录"
              onClick={() => {
                const paths: string[] = [];
                const collect = (nodes: typeof tree) =>
                  nodes.forEach((node) => {
                    if (node.children.length) {
                      paths.push(node.path);
                      collect(node.children);
                    }
                  });
                collect(tree);
                setCollapsed(new Set(paths));
              }}
            >
              <ChevronsDownUp size={14} />
            </button>
          )}
          {(["list", "tree"] as const).map((mode) => (
            <button
              key={mode}
              className="icon-button"
              aria-label={mode === "tree" ? "文件树显示" : "平铺显示"}
              title={mode === "tree" ? "文件树显示" : "平铺显示"}
              aria-pressed={layout === mode}
              onClick={() => {
                setLayout(mode);
                localStorage.setItem("svnx.fileLayout", mode);
              }}
            >
              {mode === "tree" ? <ListTree size={14} /> : <List size={14} />}
            </button>
          ))}
        </div>
      </div>
      <div className="file-list" ref={ref}>
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((row) => {
            const { node, depth } = rows[row.index];
            const file = node.file;
            if (layout === "tree" && node.children.length)
              return (
                <div
                  key={node.path}
                  className={`file-row tree-folder ${file && selected === file.path ? "selected" : ""}`}
                  style={{
                    position: "absolute",
                    top: row.start,
                    width: "100%",
                    paddingLeft: 12 + depth * 16,
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onSelect(file || node.entries[0]);
                    onCheck(node.entries.map((entry) => entry.path));
                    setMenuPoint({ x: event.clientX, y: event.clientY });
                    setMenu(true);
                  }}
                >
                  <input
                    type="checkbox"
                    aria-label={`选择目录 ${node.path}`}
                    checked={node.entries.every((entry) =>
                      checkedSet.has(entry.path),
                    )}
                    ref={(input) => {
                      if (input)
                        input.indeterminate =
                          node.entries.some((entry) =>
                            checkedSet.has(entry.path),
                          ) &&
                          !node.entries.every((entry) =>
                            checkedSet.has(entry.path),
                          );
                    }}
                    onChange={() => toggleGroup(node.entries)}
                  />
                  <button
                    className="tree-folder-label"
                    aria-expanded={!collapsed.has(node.path)}
                    title={node.path}
                    onClick={() => toggleDirectory(node.path)}
                  >
                    {!collapsed.has(node.path) ? (
                      <ChevronDown size={13} />
                    ) : (
                      <ChevronRight size={13} />
                    )}
                    <Folder size={15} />
                    <span>{node.path.split("/").at(-1)}</span>
                  </button>
                  {file && (
                    <button
                      className="icon-button"
                      title="查看目录属性变更"
                      onClick={() => onSelect(file)}
                    >
                      <Badge file={file} />
                    </button>
                  )}
                  <small>{node.entries.length}</small>
                </div>
              );
            if (!file) return null;
            return (
              <div
                key={file.path}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${row.start}px)`,
                  ...(layout === "tree"
                    ? { paddingLeft: 12 + depth * 16 }
                    : {}),
                }}
                role="button"
                tabIndex={0}
                className={`file-row ${layout === "tree" ? "tree-file" : ""} ${selected === file.path ? "selected" : ""}`}
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
                  if (!checkedSet.has(file.path)) onCheck([file.path]);
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
                <FileIcon path={file.path} />
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
                  {layout !== "tree" && (
                    <small>
                      {file.path.split("/").slice(0, -1).join("/") ||
                        "项目根目录"}
                      {file.copied ? " · 保留历史" : ""}
                    </small>
                  )}
                </div>
                <Badge file={file} />
              </div>
            );
          })}
        </div>
        {!visible.length && (
          <div className="empty">
            <CheckCheck size={28} />
            <strong>{clean ? "工作副本干净" : "当前筛选无结果"}</strong>
            <span>{clean ? "没有待提交的变更" : "试试其他关键词或状态"}</span>
            {!clean && (
              <button
                className="button subtle"
                onClick={() => {
                  onQuery("");
                  onFilter("all");
                }}
              >
                查看全部状态
              </button>
            )}
          </div>
        )}
      </div>
      {(checked.length > 0 || loading) && (
        <div className="list-summary">
          {checked.length > 0 && <span>已选择 {checked.length} 个文件</span>}
          {loading && <span>正在刷新…</span>}
        </div>
      )}
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
                  ["untrack", "停止跟踪（保留本地文件）"],
                  ["delete", "删除并保留备份"],
                  ["deleteDirect", "直接删除（不备份）"],
                  ["move", "移动／重命名"],
                  ["ignore", "忽略未跟踪文件"],
                  ["ignoreRules", "管理忽略规则"],
                  ["properties", "查看／修改属性"],
                  ["history", "查看文件历史"],
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
