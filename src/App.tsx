import { useCallback, useEffect, useRef, useState } from "react";
import { version } from "../package.json";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Folder,
  FolderOpen,
  GitBranch,
  History,
  Loader2,
  Monitor,
  Moon,
  PanelBottom,
  Plus,
  Settings2,
  Sun,
  X,
  AlertTriangle,
  MoreHorizontal,
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useClient, bridge, unwrap, run, listen } from "./client";
import type { FileEntry, Credentials } from "./types";
import { operationNames, errorHints } from "./i18n/zh-CN";
import FilesPanel from "./components/FilesPanel";
import DiffView, { type Comparison } from "./components/DiffView";
import HistoryView from "./components/HistoryView";
import Operations, { type Execute } from "./components/Operations";
import {
  SettingsDialog,
  CheckoutDialog,
  AuthDialog,
} from "./components/ShellDialogs";
import Dialog from "./components/Dialog";
import { filterFiles, isVersionedChange, isCommittable } from "./file-filter";
export default function App() {
  const state = useClient(),
    {
      workspaces,
      selectedId,
      files,
      settings,
      tasks,
      engine,
      engineError,
      booted,
    } = state;
  const current = workspaces.find((w) => w.id === selectedId) || null,
    changes = files[selectedId] || [];
  const [systemDark, setSystemDark] = useState(
      matchMedia("(prefers-color-scheme: dark)").matches,
    ),
    [sidebarCollapsed, setSidebarCollapsed] = useState(
      () => localStorage.getItem("svnx.sidebarCollapsed") === "true",
    ),
    [view, setView] = useState<"changes" | "history">("changes"),
    [selected, setSelected] = useState<FileEntry | null>(null),
    [checked, setChecked] = useState<string[]>([]),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("modified"),
    [menu, setMenu] = useState(false),
    [modal, setModal] = useState<{
      kind: string;
      paths: string[];
      revision?: string;
    } | null>(null),
    [comparison, setComparison] = useState<Comparison | null>(null),
    [historyScope, setHistoryScope] = useState(""),
    [tasksOpen, setTasksOpen] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState<{ code?: string; message: string } | null>(
      null,
    ),
    [toast, setToast] = useState(""),
    [listWidth, setListWidth] = useState(settings.listWidth);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    dragging = useRef(false),
    refreshLock = useRef(false);
  const dark =
    settings.theme === "dark" || (settings.theme === "system" && systemDark);
  const visibleChanges = filterFiles(changes, query, filter);
  const visibleCount = visibleChanges.filter(isVersionedChange).length;
  const commitFiles = (
    checked.length ? changes.filter((f) => checked.includes(f.path)) : changes
  ).filter(isCommittable);
  const active = selected
    ? visibleChanges.find((f) => f.path === selected.path) ||
      (selected.status === "normal" ? selected : visibleChanges[0] || null)
    : visibleChanges[0] || null;
  const activeTasks = tasks.filter(
    (t) =>
      t.workspaceId === selectedId && ["queued", "running"].includes(t.state),
  );
  const incoming = state.incomingUpdates[selectedId];
  const updateHint = !settings.autoCheckUpdates
    ? "自动检测已关闭，可在偏好设置中开启"
    : incoming?.error
      ? `自动检测失败：${incoming.error}${incoming.checkedAt ? "；显示上次成功检测的数量" : ""}`
      : incoming?.checkedAt
        ? `待更新 ${incoming.count || 0} 个路径；上次检测 ${new Date(incoming.checkedAt).toLocaleTimeString("zh-CN")}，每 ${settings.updateCheckMinutes} 分钟检测`
        : "正在检测远端更新";
  const onError = useCallback((e: Error & { code?: string }) => {
    if (e.code === "CANCELLED") return;
    setError({ code: e.code, message: e.message });
  }, []);
  const notify = (text: string) => {
    setToast(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 3500);
  };
  const refresh = useCallback(async () => {
    if (!selectedId || refreshLock.current || !engine) return;
    refreshLock.current = true;
    setRefreshing(true);
    try {
      await useClient.getState().refresh(selectedId);
    } catch (e) {
      onError(e as Error);
    } finally {
      refreshLock.current = false;
      setRefreshing(false);
    }
  }, [selectedId, engine, onError]);
  const execute: Execute = async (method, params = {}) => {
    const payload = { workspaceId: selectedId, ...params };
    try {
      const result = await run(method, payload);
      if (method === "add" && selectedId) {
        await useClient.getState().refresh(selectedId);
        setFilter("modified");
        setQuery("");
        setChecked([]);
      }
      if (
        ![
          "status",
          "info",
          "diff",
          "tree",
          "log",
          "properties",
          "conflict",
          "backups",
          "commitPlan",
          "revertPlan",
        ].includes(method)
      ) {
        notify(`${operationNames[method] || method}完成`);
        if (["commit", "revert", "delete", "move"].includes(method)) {
          setChecked([]);
          setSelected(null);
        }
        if (selectedId && method !== "add") void refresh();
      }
      return result;
    } catch (e) {
      const problem = e as Error & { code?: string };
      throw e;
    }
  };
  useEffect(() => {
    void state.initialize().catch(onError);
    if (!window.svnx) return;
    return listen();
  }, []);
  useEffect(() => {
    setSelected(null);
    setChecked([]);
    setQuery("");
    setFilter("modified");
    setComparison(null);
    setView("changes");
    setHistoryScope("");
    setError(null);
    if (selectedId) void refresh();
  }, [selectedId, engine]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  useEffect(() => {
    setListWidth(settings.listWidth);
  }, [settings.listWidth]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (dragging.current) {
        const sidebar =
          document.querySelector(".sidebar-rail")?.getBoundingClientRect()
            .width ??
          document.querySelector(".sidebar")?.getBoundingClientRect().width ??
          216;
        setListWidth(Math.max(280, Math.min(520, e.clientX - sidebar)));
      }
    };
    const end = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.classList.remove("resizing");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
  }, []);
  useEffect(() => {
    if (!booted || listWidth === settings.listWidth) return;
    const id = setTimeout(() => {
      void bridge()
        .settings({ listWidth })
        .then(unwrap)
        .then((settings) => useClient.getState().set({ settings }))
        .catch(onError);
    }, 400);
    return () => clearTimeout(id);
  }, [listWidth, booted]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (document.querySelector("[role=dialog]")) return;
      if (e.key === "F5") {
        e.preventDefault();
        void refresh();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        openCommit();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setModal({ kind: "settings", paths: [] });
      }
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const closeModal = useCallback(() => setModal(null), []);
  useEffect(() => {
    setChecked([]);
    setSelected(null);
  }, [query, filter]);
  const openCommit = () => {
    const paths = commitFiles.map((f) => f.path);
    if (!paths.length) {
      notify("请先选择可提交的变更；未跟踪文件需先添加，冲突需先解决。");
      return;
    }
    setModal({ kind: "commit", paths });
  };
  const openWorkspace = () => {
    void bridge()
      .openWorkspace()
      .then(unwrap)
      .then((w) => {
        if (w) useClient.getState().set({ selectedId: w.id });
      })
      .catch(onError);
  };
  const action = (kind: string) => {
    if (!current) return;
    const paths = checked.length ? checked : active ? [active.path] : [];
    if (
      kind === "browse" ||
      kind === "cleanup" ||
      kind === "backups" ||
      kind === "remove"
    ) {
      setModal({ kind, paths: [] });
      return;
    }
    if (kind === "updateSelected") {
      setModal({ kind: "update", paths: paths.length ? paths : [""] });
      return;
    }
    if (kind === "reveal") {
      void bridge()
        .reveal({ workspaceId: current.id, path: paths[0] })
        .then(unwrap)
        .catch(onError);
      return;
    }
    if (kind === "history") {
      const target = active;
      if (!target) {
        notify("请先选择要查看历史的文件。");
        return;
      }
      if (
        ["unversioned", "added", "ignored"].includes(target.status) &&
        !target.copied
      ) {
        notify("该路径尚未提交到仓库，暂无历史记录。");
        return;
      }
      setHistoryScope(target.path);
      setView("history");
      setComparison(null);
      return;
    }
    if (!paths.length) {
      notify("请先选择文件或使用“浏览文件”选择目录。");
      return;
    }
    if (
      ["move", "properties", "conflict"].includes(kind) &&
      paths.length !== 1
    ) {
      notify("此操作需要只选择一个路径。");
      return;
    }
    setModal({ kind, paths });
  };
  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="titlebar-right">
          <span className="demo-tag">
            <span className="status-dot" />
            {version}
          </span>
          <button
            className="icon-button"
            title="使用帮助"
            onClick={() => setModal({ kind: "help", paths: [] })}
          >
            <CircleHelp size={16} />
          </button>
        </div>
      </header>
      <div className="app-body">
        {sidebarCollapsed && (
          <div className="sidebar-rail">
            <button
              className="icon-button"
              aria-label="展开导航栏"
              title="展开导航栏"
              aria-expanded={false}
              aria-controls="workspace-sidebar"
              onClick={() => {
                setSidebarCollapsed(false);
                localStorage.setItem("svnx.sidebarCollapsed", "false");
              }}
            >
              <PanelLeftOpen size={17} />
            </button>
          </div>
        )}
        <aside
          id="workspace-sidebar"
          className="sidebar"
          style={sidebarCollapsed ? { display: "none" } : undefined}
        >
          <div className="sidebar-label">
            <span>工作副本</span>
            <div className="sidebar-heading-actions">
              <button
                className="icon-button"
                aria-label="收起导航栏"
                title="收起导航栏"
                aria-expanded={true}
                aria-controls="workspace-sidebar"
                onClick={() => {
                  setSidebarCollapsed(true);
                  localStorage.setItem("svnx.sidebarCollapsed", "true");
                }}
              >
                <PanelLeftClose size={16} />
              </button>
              <button
                className="icon-button"
                title="打开已有工作副本"
                disabled={!engine}
                onClick={openWorkspace}
              >
                <Plus size={15} />
              </button>
            </div>
          </div>
          <nav className="projects">
            {workspaces.map((w) => (
              <button
                key={w.id}
                className={`project ${w.id === selectedId ? "active" : ""}`}
                onClick={() => state.set({ selectedId: w.id })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  state.set({ selectedId: w.id });
                  setModal({ kind: "remove", paths: [] });
                }}
                title={w.path}
              >
                <FolderOpen size={17} />
                <span>{w.name}</span>
                <span className="count">
                  {files[w.id]
                    ? files[w.id].filter(isVersionedChange).length || (
                        <Check size={12} />
                      )
                    : "—"}
                </span>
              </button>
            ))}
          </nav>
          <button
            className="checkout-link"
            disabled={!engine}
            onClick={openWorkspace}
          >
            <FolderOpen size={14} />
            打开已有工作副本
          </button>
          <button
            className="checkout-link"
            disabled={!engine}
            onClick={() => setModal({ kind: "checkout", paths: [] })}
          >
            <Plus size={14} />
            检出工作副本
          </button>
          <div className="sidebar-divider" />
          <div className="sidebar-label">当前项目</div>
          <nav>
            <button
              className={`nav-item ${view === "changes" ? "active" : ""}`}
              disabled={!current}
              onClick={() => {
                setView("changes");
                setComparison(null);
              }}
            >
              <GitBranch size={16} />
              本地变更<span className="count">{visibleCount}</span>
            </button>
            <button
              className={`nav-item ${view === "history" ? "active" : ""}`}
              disabled={!current}
              onClick={() => {
                setView("history");
                setHistoryScope("");
                setComparison(null);
              }}
            >
              <History size={16} />
              版本历史
            </button>
          </nav>
          <div className="sidebar-bottom">
            <button
              className="nav-item"
              onClick={() => setModal({ kind: "settings", paths: [] })}
            >
              <Settings2 size={16} />
              偏好设置<span className="shortcut">Ctrl ,</span>
            </button>
            <div className="sidebar-footer">
              <span className="sidebar-brand">
                <img src="./brand.png" alt="" aria-hidden="true" />
                SVNX
              </span>
              <span>{version}</span>
            </div>
          </div>
        </aside>
        <main className="main">
          {!current ? (
            <div className="welcome">
              <img src="./brand.png" alt="SVNX" />
              <h1>打开你的工作副本</h1>
              <p>检查变更，浏览差异，让每次提交清晰有序。</p>
              {!window.svnx ? (
                <p className="inline-warning">
                  当前为浏览器预览。请使用 Electron 桌面客户端操作 SVN。
                </p>
              ) : engineError ? (
                <div className="welcome-warning">
                  <AlertTriangle size={18} />
                  <span>{engineError}</span>
                  <button
                    className="button"
                    onClick={() => setModal({ kind: "settings", paths: [] })}
                  >
                    配置 SVN
                  </button>
                </div>
              ) : (
                <div className="welcome-actions">
                  <button
                    className="button primary"
                    disabled={!booted}
                    onClick={openWorkspace}
                  >
                    <FolderOpen size={15} />
                    打开已有工作副本
                  </button>
                  <button
                    className="button"
                    disabled={!booted}
                    onClick={() => setModal({ kind: "checkout", paths: [] })}
                  >
                    <Plus size={15} />
                    从仓库检出
                  </button>
                </div>
              )}
              <small>所有 SVN 操作在本机执行，密码不会写入应用设置。</small>
            </div>
          ) : (
            <>
              <div className="workspace-heading">
                <div>
                  <div className="breadcrumb">
                    工作副本
                    <ChevronRight size={12} />
                    <span>{current.name}</span>
                  </div>
                  <h1>
                    {view === "changes" ? "本地变更" : "版本历史"}
                    <span
                      className="revision"
                      title="工作副本根目录的基础版本；文件可能处于不同版本，此处不代表仓库最新版本。"
                    >
                      根目录 r{current.revision}
                    </span>
                  </h1>
                  <div className="workspace-path" title={current.url}>
                    <Folder size={12} />
                    <span>{current.path}</span>
                  </div>
                </div>
                <div className="workspace-actions">
                  <button
                    className="button"
                    title={updateHint}
                    disabled={!engine}
                    onClick={() => setModal({ kind: "update", paths: [""] })}
                  >
                    <ArrowDownToLine size={15} />
                    拉取
                    {settings.autoCheckUpdates &&
                      incoming?.count !== undefined && (
                        <span
                          className="button-count incoming-count"
                          data-empty={incoming.count === 0}
                          aria-label={`${incoming.count} 个路径可更新`}
                          aria-live="polite"
                        >
                          {incoming.count > 99 ? "99+" : incoming.count}
                        </span>
                      )}
                    {settings.autoCheckUpdates && incoming?.error && (
                      <AlertTriangle size={13} aria-label="远端更新检测失败" />
                    )}
                  </button>
                  <button
                    className="button primary"
                    disabled={!engine || !commitFiles.length}
                    onClick={openCommit}
                  >
                    <ArrowUpFromLine size={15} />
                    提交
                    <span className="button-count">{commitFiles.length}</span>
                  </button>
                  <button
                    className="icon-button"
                    title="移除工作副本记录"
                    onClick={() => setModal({ kind: "remove", paths: [] })}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              </div>
              <div className="workspace-tabs">
                <button
                  className={`tab ${view === "changes" ? "active" : ""}`}
                  onClick={() => {
                    setView("changes");
                    setComparison(null);
                  }}
                >
                  <GitBranch size={14} />
                  变更<span>{visibleCount}</span>
                </button>
                <button
                  className={`tab ${view === "history" ? "active" : ""}`}
                  onClick={() => {
                    setView("history");
                    setHistoryScope("");
                    setComparison(null);
                  }}
                >
                  <Clock3 size={14} />
                  历史记录
                </button>
                <div className="tabs-meta">
                  <span className="status-dot" />
                  {refreshing
                    ? "正在刷新"
                    : activeTasks.length
                      ? `${activeTasks.length} 个任务进行中`
                      : "工作副本已就绪"}
                </div>
              </div>
              {error && (
                <div className="error-banner" role="alert">
                  <AlertTriangle size={15} />
                  <div>
                    <strong>
                      {errorHints[error.code || ""] || "操作未完成"}
                    </strong>
                    <details>
                      <summary>查看详细信息</summary>
                      <pre>{error.message}</pre>
                    </details>
                  </div>
                  <button
                    className="icon-button"
                    title="关闭错误提示"
                    onClick={() => setError(null)}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              <div
                className="workbench"
                style={
                  { "--list-width": `${listWidth}px` } as React.CSSProperties
                }
              >
                {view === "history" && (
                  <div style={{ display: comparison ? "none" : "contents" }}>
                    <HistoryView
                      key={`${current.id}:${historyScope}`}
                      workspace={current}
                      scope={historyScope}
                      onRestore={(revision) =>
                        setModal({
                          kind: "update",
                          paths: [historyScope],
                          revision: String(revision),
                        })
                      }
                      onCompare={setComparison}
                      onError={onError}
                    />
                  </div>
                )}
                {(view !== "history" || comparison) && (
                  <>
                    <section className="change-panel">
                      {comparison ? (
                        <div className="historical-sidebar">
                          <button
                            className="button"
                            onClick={() => setComparison(null)}
                          >
                            <ArrowLeft size={14} />
                            返回历史记录
                          </button>
                          <h3>版本差异</h3>
                          <p>
                            r{comparison.oldRevision} → r
                            {comparison.newRevision}
                          </p>
                          <p className="break-path">{comparison.path}</p>
                        </div>
                      ) : (
                        <FilesPanel
                          files={changes}
                          selected={active?.path || ""}
                          checked={checked}
                          onSelect={(file) => {
                            setSelected(file);
                            setComparison(null);
                          }}
                          onCheck={setChecked}
                          query={query}
                          onQuery={setQuery}
                          filter={filter}
                          onFilter={setFilter}
                          refresh={() => void refresh()}
                          loading={refreshing}
                          onAction={action}
                          menu={menu}
                          setMenu={setMenu}
                        />
                      )}
                    </section>
                    <div
                      className="resize-handle"
                      role="separator"
                      aria-label="调整文件面板宽度"
                      aria-orientation="vertical"
                      tabIndex={0}
                      onPointerDown={() => {
                        dragging.current = true;
                        document.body.classList.add("resizing");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowLeft")
                          setListWidth((w) => Math.max(280, w - 20));
                        if (e.key === "ArrowRight")
                          setListWidth((w) => Math.min(520, w + 20));
                      }}
                    />
                    <section className="diff-panel">
                      <DiffView
                        key={current.id}
                        workspace={current}
                        file={comparison ? null : active}
                        dark={dark}
                        comparison={comparison}
                        onError={onError}
                        onConflict={() => action("conflict")}
                      />
                    </section>
                  </>
                )}
              </div>
            </>
          )}
          {tasksOpen && (
            <div className="task-panel formal-tasks">
              <div>
                <strong>任务记录（最近 100 项）</strong>
                <button
                  className="icon-button"
                  title="关闭任务记录"
                  onClick={() => setTasksOpen(false)}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="task-list">
                {tasks
                  .slice()
                  .reverse()
                  .map((t) => (
                    <div className="task-row" key={t.id}>
                      <span>
                        {new Date(t.date || Date.now()).toLocaleTimeString(
                          "zh-CN",
                        )}
                      </span>
                      <strong>{operationNames[t.method] || t.method}</strong>
                      <span className={`task-state ${t.state}`}>
                        {
                          {
                            queued: "排队中",
                            running: "正在执行",
                            completed: "已完成",
                            failed: "失败",
                            cancelled: "已取消",
                          }[t.state]
                        }
                      </span>
                      {["queued", "running"].includes(t.state) && (
                        <button
                          onClick={() =>
                            void bridge()
                              .cancel(t.id)
                              .then(unwrap)
                              .catch(onError)
                          }
                        >
                          取消
                        </button>
                      )}
                      {t.error && (
                        <details>
                          <summary>详情</summary>
                          <pre>{t.error.message}</pre>
                        </details>
                      )}
                    </div>
                  ))}
                {!tasks.length && (
                  <p className="muted-caption">暂无操作记录。</p>
                )}
              </div>
            </div>
          )}
          <footer className="statusbar">
            <button onClick={() => setTasksOpen(!tasksOpen)}>
              <PanelBottom size={13} />
              任务记录<span>{tasks.length}</span>
            </button>
            <span className="demo-footer">
              {window.svnx
                ? "本机执行 · 提交前核对范围 · 还原前备份"
                : "浏览器预览"}
            </span>
            <div className="statusbar-right">
              <span
                className="footer-engine-status"
                title={engine || engineError || "未检测到 SVN"}
              >
                <span
                  className={engine ? "status-dot" : "status-dot offline"}
                />
                SVN{" "}
                {engine
                  ? engine.match(/\d+\.\d+(?:\.\d+)?/)?.[0] || engine
                  : "未检测到"}
              </span>
              <button
                title="切换主题"
                onClick={() => {
                  const next = dark ? "light" : "dark";
                  void bridge()
                    .settings({ theme: next })
                    .then(unwrap)
                    .then((settings) => state.set({ settings }))
                    .catch(onError);
                }}
              >
                {dark ? <Moon size={13} /> : <Sun size={13} />}
                <span>
                  {settings.theme === "system"
                    ? "跟随系统"
                    : dark
                      ? "深色"
                      : "浅色"}
                </span>
              </button>
            </div>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
          <button
            className="icon-button"
            title="关闭提示"
            onClick={() => setToast("")}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {modal?.kind === "settings" && (
        <SettingsDialog
          onClose={closeModal}
          onError={onError}
          onBackups={() => {
            if (!current) {
              notify("请先打开工作副本");
              return;
            }
            setModal({ kind: "backups", paths: [] });
          }}
        />
      )}
      {modal?.kind === "checkout" && (
        <CheckoutDialog
          execute={execute}
          onClose={closeModal}
          onError={onError}
        />
      )}
      {modal?.kind === "help" && (
        <Dialog title="关于 SVNX" onClose={closeModal}>
          <div className="help-brand">
            <img src="./brand.png" alt="SVNX" className="app-icon" />
            <strong>svnx</strong>
            <span>{version}</span>
          </div>
          <p className="modal-caption">
            Windows 优先的 Subversion
            客户端。支持本地变更、提交、更新、历史、差异、属性、锁和冲突处理。
          </p>
          <div className="help-shortcuts">
            <span>
              刷新状态<kbd>F5</kbd>
            </span>
            <span>
              提交变更<kbd>Ctrl + Enter</kbd>
            </span>
            <span>
              偏好设置<kbd>Ctrl + ,</kbd>
            </span>
            <span>
              关闭弹窗<kbd>Esc</kbd>
            </span>
          </div>
          <p className="modal-note">
            工作副本记录可移除，本地目录不会删除。分支、标签和合并将在后续版本提供。
          </p>
          <footer>
            <button className="button primary" onClick={closeModal}>
              关闭
            </button>
          </footer>
        </Dialog>
      )}
      {modal &&
        current &&
        !["settings", "checkout", "help"].includes(modal.kind) && (
          <Operations
            key={`${current.id}:${modal.kind}:${modal.paths.join()}`}
            kind={modal.kind}
            initialRevision={modal.revision}
            workspace={current}
            paths={modal.paths}
            execute={execute}
            onClose={closeModal}
            onError={onError}
            onSelect={(f) => {
              setSelected(f);
              setChecked([f.path]);
              setView("changes");
              setComparison(null);
            }}
          />
        )}
      {state.challenges[0] && (
        <AuthDialog
          key={state.challenges[0].id}
          certificate={state.challenges[0].code === "CERTIFICATE"}
          details={state.challenges[0].message}
          onClose={state.challenges[0].cancel}
          onSubmit={async (credentials) => {
            try {
              await state.challenges[0].retry(credentials);
            } catch (e) {
              onError(e as Error);
              throw e;
            }
          }}
        />
      )}
    </div>
  );
}
