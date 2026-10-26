import { useEffect, useState } from "react";
import {
  Loader2,
  FolderOpen,
  Check,
  AlertTriangle,
  ArrowUpFromLine,
} from "lucide-react";
import Dialog from "./Dialog";
import Select from "./Select";
import { normalizeUpdateResult } from "../update-result";
import { Badge } from "./FilesPanel";
import type { Workspace, FileEntry, Plan, Conflict, Backup } from "../types";
import { bridge, unwrap } from "../client";
export type Execute = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;
export const titles: Record<string, string> = {
  add: "添加到版本控制",
  commit: "提交变更",
  revert: "还原本地修改",
  delete: "删除文件",
  deleteDirect: "直接删除（不备份）",
  untrack: "停止跟踪（保留本地文件）",
  untrackAndIgnore: "停止跟踪并忽略（保留本地文件）",
  move: "移动／重命名",
  update: "更新工作副本",
  ignore: "设置忽略",
  properties: "SVN 属性",
  conflict: "解决冲突",
  browse: "浏览工作副本",
  backups: "还原备份",
  remove: "移除工作副本记录",
  lock: "加锁",
  unlock: "解锁",
  cleanup: "清理工作副本",
};
export default function Operations({
  kind,
  initialRevision = "HEAD",
  workspace,
  paths,
  execute,
  onClose,
  onError,
  onSelect,
}: {
  kind: string;
  initialRevision?: string;
  workspace: Workspace;
  paths: string[];
  execute: Execute;
  onClose: () => void;
  onError: (e: Error) => void;
  onSelect: (file: FileEntry) => void;
}) {
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [plan, setPlan] = useState<Plan | null>(null),
    [message, setMessage] = useState(""),
    [value, setValue] = useState(""),
    [name, setName] = useState(""),
    [revision, setRevision] = useState(initialRevision),
    [properties, setProperties] = useState<{ name: string; value: string }[]>(
      [],
    ),
    [conflict, setConflict] = useState<Conflict | null>(null),
    [result, setResult] = useState(""),
    [accept, setAccept] = useState("working"),
    [conflictKind, setConflictKind] = useState("text"),
    [treeConfirmed, setTreeConfirmed] = useState(false),
    [backups, setBackups] = useState<Backup[]>([]),
    [directory, setDirectory] = useState(""),
    [nodes, setNodes] = useState<
      { name: string; path: string; directory: boolean }[]
    >([]),
    [selectedPaths, setSelectedPaths] = useState(paths),
    [keepLocks, setKeepLocks] = useState(false),
    [commitResult, setCommitResult] = useState<{
      output: string;
      paths: string[];
    } | null>(null),
    [updateResult, setUpdateResult] = useState<{
      output: string;
      files: { path: string; status: string; conflict: boolean }[];
    } | null>(null);
  const first = paths[0] || "";
  const [commitIssue, setCommitIssue] = useState<{
    code?: string;
    message: string;
  } | null>(null);
  const [commitNotice, setCommitNotice] = useState("");
  const recheckCommit = async (sync: boolean) => {
    if (!plan || busy) return;
    setBusy(true);
    setCommitNotice(
      sync
        ? "正在拉取所选路径并重新检查，不会自动提交…"
        : "正在重新核对提交范围…",
    );
    try {
      if (sync)
        await execute("syncCommit", { paths, fingerprint: plan.fingerprint });
      const next = (await execute("commitPlan", { paths })) as Plan;
      setPlan(next);
      setCommitIssue(null);
      setCommitNotice(
        sync
          ? "所选路径已拉取并重新检查。请核对提交范围后再次确认提交。"
          : "提交范围已重新检查，提交说明已保留。请核对后再次提交。",
      );
    } catch (error) {
      setCommitNotice("");
      setCommitIssue(error as Error & { code?: string });
    } finally {
      setBusy(false);
    }
  };
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      const response = await action();
      if (kind === "commit") {
        setCommitResult(response as { output: string; paths: string[] });
      } else if (kind === "update") {
        setUpdateResult(normalizeUpdateResult(response));
      } else {
        onClose();
      }
    } catch (e) {
      if (kind === "commit") setCommitIssue(e as Error & { code?: string });
      else onError(e as Error);
    } finally {
      setBusy(false);
    }
  };
  const loadDirectory = async (dir: string) => {
    setLoading(true);
    try {
      setNodes((await execute("tree", { path: dir })) as typeof nodes);
      setDirectory(dir);
    } catch (e) {
      onError(e as Error);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let alive = true;
    const init = async () => {
      try {
        if (kind === "commit" || kind === "revert") {
          const p = await execute(
            kind === "commit" ? "commitPlan" : "revertPlan",
            { paths },
          );
          if (alive) setPlan(p as Plan);
        } else if (kind === "properties") {
          const p = await execute("properties", { path: first });
          if (alive) setProperties(p as typeof properties);
        } else if (kind === "conflict") {
          const data = (await execute("conflict", { path: first })) as Conflict;
          if (alive) {
            setConflict(data);
            setResult(data.current.text);
            setConflictKind(data.kinds[0] || "text");
          }
        } else if (kind === "backups") {
          const b = (await execute("backups")) as Backup[];
          if (alive) setBackups(b);
        } else if (kind === "browse") {
          await loadDirectory("");
        } else if (kind === "ignore") {
          setValue(paths.map((p) => p.split("/").at(-1)).join("\n"));
        } else if (kind === "move") {
          setValue(first);
        }
      } catch (e) {
        onError(e as Error);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void init();
    return () => {
      alive = false;
    };
  }, [kind, workspace.id, first]);
  if (updateResult) {
    const conflicts = updateResult.files.filter((file) => file.conflict).length;
    const statusLabels: Record<string, string> = {
      A: "新增",
      D: "删除",
      U: "更新",
      G: "合并",
      C: "冲突",
      E: "已存在",
      R: "替换",
      B: "锁已解除",
    };
    return (
      <Dialog title="更新结果" subtitle={workspace.name} onClose={onClose} wide>
        <div className={conflicts ? "warning-box" : "commit-success-summary"}>
          {conflicts ? <AlertTriangle size={22} /> : <Check size={22} />}
          <div>
            <strong>
              {conflicts
                ? `更新完成，${conflicts} 个路径需要解决冲突`
                : "更新完成"}
            </strong>
            <p>
              {updateResult.files.length
                ? `本次涉及 ${updateResult.files.length} 个路径。`
                : "没有文件变更。"}
            </p>
          </div>
        </div>
        {!!updateResult.files.length && (
          <>
            <h3 className="field-label">本次更新清单</h3>
            <div className="commit-files">
              {updateResult.files.map((file) => (
                <div className="plan-file" key={file.path}>
                  <span
                    className={`badge ${file.conflict ? "conflict" : file.status === "A" ? "added" : file.status === "D" ? "deleted" : "modified"}`}
                  >
                    {file.status}
                  </span>
                  <span className="update-result-status">
                    {statusLabels[file.status] || file.status}
                  </span>
                  <span>{file.path}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <footer>
          <button className="button primary" onClick={onClose}>
            完成
          </button>
        </footer>
      </Dialog>
    );
  }
  if (commitResult) {
    return (
      <Dialog title="提交成功" subtitle={workspace.name} onClose={onClose} wide>
        <div className="commit-success-summary">
          <Check size={22} />
          <div>
            <strong>已成功提交 {commitResult.paths.length} 个路径</strong>
            <p>以下变更已提交到 SVN 仓库。</p>
          </div>
        </div>
        <h3 className="field-label">提交说明</h3>
        <p className="commit-success-message">{message}</p>
        <h3 className="field-label">本次提交清单</h3>
        <div className="commit-files">
          {commitResult.paths.map((path) => {
            const entry = plan?.entries.find((file) => file.path === path);
            return (
              <div className="plan-file" key={path}>
                {entry ? <Badge file={entry} /> : <Check size={14} />}
                <span>{path || "工作副本根目录"}</span>
              </div>
            );
          })}
        </div>
        <footer>
          <button className="button primary" onClick={onClose}>
            完成
          </button>
        </footer>
      </Dialog>
    );
  }
  const footer = (
    action: () => Promise<unknown>,
    label: string,
    disabled = false,
    danger = false,
  ) => (
    <footer>
      <button className="button" disabled={busy} onClick={onClose}>
        取消
      </button>
      <button
        className={`button ${danger ? "danger" : "primary"}`}
        disabled={busy || loading || disabled}
        onClick={() => void act(action)}
      >
        {busy && <Loader2 className="spin" size={14} />} {label}
      </button>
    </footer>
  );
  return (
    <Dialog
      title={titles[kind] || kind}
      subtitle={workspace.name}
      wide={["commit", "revert", "conflict", "properties", "browse"].includes(
        kind,
      )}
      onClose={onClose}
      busy={busy}
    >
      {loading && <p className="modal-caption">正在读取最新状态…</p>}
      {kind === "commit" && plan && (
        <>
          {commitIssue && (
            <div className="commit-recovery" role="alert">
              <strong>
                {commitIssue.code === "OUT_OF_DATE"
                  ? "所选路径的基础版本已过期"
                  : "提交未完成"}
              </strong>
              <p>
                {commitIssue.code === "OUT_OF_DATE"
                  ? "即使没有其他人提交，目录基础版本也可能落后。可以只拉取本次提交涉及的路径：目录不递归，文件仍可能合并远端变更；有冲突时会停止提交。提交说明会保留，不会自动重试提交。"
                  : "提交说明已保留。请检查错误并重新核对；连接中断时请先确认历史中是否已经提交成功。"}
              </p>
              <details>
                <summary>查看 SVN 详情</summary>
                <pre>{commitIssue.message}</pre>
              </details>
              <div className="empty-actions">
                {commitIssue.code === "OUT_OF_DATE" && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void recheckCommit(true)}
                  >
                    拉取所选路径并重新检查
                  </button>
                )}
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void recheckCommit(false)}
                >
                  重新核对提交范围
                </button>
              </div>
            </div>
          )}
          {commitNotice && (
            <p className="modal-note" role="status">
              {commitNotice}
            </p>
          )}
          <p className="modal-caption">
            仅提交以下路径。新增父目录会作为依赖列出；未列出的文件不会自动加入。
          </p>
          <div className="commit-files">
            {plan.entries.map((f) => (
              <div className="plan-file" key={f.id}>
                <Badge file={f} />
                <span>{f.path || "工作副本根目录"}</span>
              </div>
            ))}
          </div>
          {plan.warnings.map((w) => (
            <p className="inline-warning" key={w}>
              {w}
            </p>
          ))}
          <label className="field-label" htmlFor="message">
            提交说明
          </label>
          <textarea
            id="message"
            rows={4}
            placeholder="描述这次修改的内容与原因…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <label className="check-label">
            <input
              type="checkbox"
              checked={keepLocks}
              onChange={(e) => setKeepLocks(e.target.checked)}
            />
            提交后保留文件锁
          </label>
          <div className="modal-note">
            提交前会重新核对文件状态。提交中断后，请先核对历史再重试。
          </div>
          {footer(
            () =>
              execute("commit", {
                paths,
                fingerprint: plan.fingerprint,
                message,
                keepLocks,
              }),
            `提交 ${plan.paths.length} 个路径`,
            !message.trim() || !plan.paths.length || !!commitIssue,
          )}
        </>
      )}
      {kind === "revert" && plan && (
        <>
          <div className="warning-box">
            <AlertTriangle size={20} />
            <div>
              <strong>还原将丢弃下列路径的未提交修改。</strong>
              <p>
                执行前备份现有文件内容。未跟踪文件不会被删除；新增项只取消版本控制调度。
              </p>
            </div>
          </div>
          <div className="revert-paths">
            {plan.entries.map((f) => (
              <div key={f.id}>
                <Badge file={f} />
                {f.path || "工作副本根目录"}
              </div>
            ))}
          </div>
          {footer(
            () => execute("revert", { paths, fingerprint: plan.fingerprint }),
            "备份并还原",
            !plan.paths.length,
            true,
          )}
        </>
      )}
      {kind === "add" && (
        <>
          <p className="modal-caption">
            添加以下路径。选择目录时，包含其全部未忽略的子文件和子目录；添加后需要提交才会上传到仓库。
          </p>
          <pre className="path-preview">{paths.join("\n")}</pre>
          {footer(() => execute("add", { paths }), "添加", !paths.length)}
        </>
      )}
      {["untrack", "untrackAndIgnore"].includes(kind) && (
        <>
          <div className="warning-box">
            <AlertTriangle size={18} />
            <div>
              <strong>保留本地内容，标记为从仓库删除</strong>
              <p>
                目录操作包含子目录。执行后会产生待提交的删除记录；提交后，其他成员拉取时会同步移除这些路径。不会自动提交。
                {kind === "untrackAndIgnore"
                  ? "同时在各自父目录添加忽略规则；提交删除记录和目录属性后完成共享。"
                  : "不会自动添加忽略规则。"}
              </p>
            </div>
          </div>
          <pre className="path-preview">{paths.join("\n")}</pre>
          {footer(
            () => execute(kind, { paths }),
            kind === "untrackAndIgnore"
              ? "停止跟踪并添加忽略"
              : "停止跟踪并保留本地文件",
            !paths.length,
            true,
          )}
        </>
      )}
      {(kind === "delete" || kind === "deleteDirect") && (
        <>
          <div className="warning-box">
            <AlertTriangle size={20} />
            <div>
              <strong>删除本地内容并标记为待提交删除。</strong>
              <p>
                {kind === "deleteDirect"
                  ? "不创建备份，未提交的本地内容将被删除。目录操作包含子目录；删除需要提交后才会影响远端。"
                  : "目录操作包含子目录。先备份现有内容，再执行删除；删除需要提交后才会影响远端。"}
              </p>
            </div>
          </div>
          <pre className="path-preview">{paths.join("\n")}</pre>
          {footer(
            () => execute("delete", { paths, backup: kind !== "deleteDirect" }),
            kind === "deleteDirect" ? "直接删除" : "备份并删除",
            !paths.length,
            true,
          )}
        </>
      )}
      {kind === "move" && (
        <>
          <p className="modal-caption">
            源路径：{first}。移动保留 SVN 历史；提交时需要同时选择源和目标。
          </p>
          <label className="field-label" htmlFor="destination">
            目标路径（相对工作副本根目录）
          </label>
          <input
            className="text-input"
            id="destination"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          {footer(
            () => execute("move", { path: first, destination: value }),
            "移动",
            !value.trim() || value === first || paths.length !== 1,
          )}
        </>
      )}
      {kind === "update" && (
        <>
          {initialRevision !== "HEAD" && (
            <p className="modal-note">
              还原到 r{initialRevision}
              ：将下列本地范围更新到历史版本，不修改服务器历史，也不会自动提交。本地未提交修改会参与合并，可能产生冲突；请先提交或备份需要保留的修改。
            </p>
          )}
          <p className="modal-caption">
            更新范围：
            {paths.length === 1 && !first ? "整个工作副本" : paths.join("、")}
            。遇到冲突时保留冲突，等待人工处理。
          </p>
          <label className="field-label" htmlFor="update-revision">
            目标版本
          </label>
          <input
            id="update-revision"
            className="text-input"
            value={revision}
            onChange={(e) => setRevision(e.target.value.toUpperCase())}
          />
          <div className="modal-note">输入 HEAD 或非负版本号。</div>
          {footer(
            () => execute("update", { paths, revision }),
            "更新",
            !/^(HEAD|\d+)$/.test(revision),
          )}
        </>
      )}
      {kind === "ignore" && (
        <>
          <p className="modal-caption">
            只修改所在目录的
            svn:ignore，不删除本地文件。已纳入版本控制的文件不受忽略规则影响。
          </p>
          <label className="field-label">每行一个名称或通配符</label>
          <textarea
            rows={5}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          {footer(
            async () => {
              const parents = [
                ...new Set(
                  paths.map((p) => p.split("/").slice(0, -1).join("/")),
                ),
              ];
              if (parents.length !== 1)
                throw new Error("一次只能设置同一父目录下的忽略规则");
              return execute("ignore", {
                directory: parents[0],
                patterns: value.split(/\r?\n/).filter(Boolean),
              });
            },
            "保存忽略规则",
            !value.trim(),
          )}
        </>
      )}
      {kind === "properties" && (
        <>
          <p className="modal-caption">
            路径：{first || "工作副本根目录"}。属性修改也需要提交。
          </p>
          <div className="property-list">
            {properties.map((p) => (
              <button
                key={p.name}
                onClick={() => {
                  setName(p.name);
                  setValue(p.value);
                }}
              >
                <strong>{p.name}</strong>
                <span>{p.value.slice(0, 160)}</span>
              </button>
            ))}
            {!properties.length && (
              <p className="muted-caption">没有已设置的属性。</p>
            )}
          </div>
          <label className="field-label" htmlFor="property-name">
            属性名称
          </label>
          <input
            className="text-input"
            id="property-name"
            placeholder="svn:ignore"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="field-label" htmlFor="property-value">
            属性值
          </label>
          <textarea
            id="property-value"
            rows={5}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <footer>
            <button
              className="button danger"
              disabled={busy || !name.trim()}
              onClick={() =>
                void act(() =>
                  execute("setProperty", { path: first, name, value: null }),
                )
              }
            >
              删除此属性
            </button>
            <button className="button" onClick={onClose}>
              关闭
            </button>
            <button
              className="button primary"
              disabled={busy || !name.trim()}
              onClick={() =>
                void act(() =>
                  execute("setProperty", { path: first, name, value }),
                )
              }
            >
              保存属性
            </button>
          </footer>
        </>
      )}
      {kind === "conflict" && conflict && (
        <>
          <p className="modal-caption">
            {first} · 先核对冲突来源，再保存并标记解决。
          </p>
          <div className="conflict-choices">
            {conflict.kinds.map((k) => (
              <button
                key={k}
                className={`button ${conflictKind === k ? "primary" : ""}`}
                onClick={() => {
                  setConflictKind(k);
                  setAccept("working");
                }}
              >
                {{ text: "文本冲突", property: "属性冲突", tree: "树冲突" }[
                  k
                ] || k}
              </button>
            ))}
          </div>
          {conflictKind === "text" && !conflict.current.binary ? (
            <>
              <div className="conflict-choices">
                <button
                  className="button"
                  onClick={() => {
                    setResult(
                      conflict.files["prev-wc-file"]?.text ||
                        conflict.current.text,
                    );
                    setAccept("working");
                  }}
                >
                  载入本地内容
                </button>
                <button
                  className="button"
                  onClick={() => {
                    setResult(conflict.files["cur-base-file"]?.text || "");
                    setAccept("working");
                  }}
                >
                  载入远端内容
                </button>
                <button
                  className="button"
                  onClick={() => {
                    setResult(conflict.files["prev-base-file"]?.text || "");
                    setAccept("working");
                  }}
                >
                  载入 BASE
                </button>
              </div>
              <textarea
                className="code-textarea"
                rows={13}
                aria-label="合并结果"
                value={result}
                onChange={(e) => setResult(e.target.value)}
              />
              <div className="modal-note">
                保存时保留原文件编码和换行。仅点击下方按钮才会标记解决。
              </div>
            </>
          ) : conflictKind === "tree" ? (
            <>
              <div className="warning-box">
                <AlertTriangle size={20} />
                <div>
                  <strong>需要先修复目录结构。</strong>
                  <p>
                    核对下方本地与远端变更，使用文件操作、添加、删除、移动或外部
                    SVN 工具修复结构。确认后才标记当前结构为已解决。
                  </p>
                </div>
              </div>
              <pre className="conflict-description">
                {JSON.stringify(conflict.tree, null, 2)}
              </pre>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={treeConfirmed}
                  onChange={(e) => setTreeConfirmed(e.target.checked)}
                />
                我已修复目录结构并核对结果
              </label>
            </>
          ) : (
            <>
              <pre className="conflict-description">
                {conflict.files["prop-file"]?.text ||
                  "请核对 SVN 属性或二进制文件的本地与远端版本。"}
              </pre>
              <label className="field-label">解决策略</label>
              <Select
                label="解决策略"
                className="select-full"
                value={accept}
                onValueChange={setAccept}
                options={[
                  { value: "working", label: "保留当前工作副本内容" },
                  { value: "mine-full", label: "使用本地内容" },
                  { value: "theirs-full", label: "使用远端内容" },
                  { value: "base", label: "使用 BASE" },
                ]}
              />
            </>
          )}
          {footer(
            () =>
              execute("resolve", {
                path: first,
                fingerprint: conflict.fingerprint,
                kind: conflictKind,
                accept,
                ...(conflictKind === "text" && !conflict.current.binary
                  ? { content: result }
                  : {}),
              }),
            "备份并标记解决",
            conflictKind === "tree"
              ? !treeConfirmed
              : conflictKind === "text" && !conflict.current.binary
                ? /^(<{7}|={7}|>{7})/m.test(result)
                : false,
          )}
        </>
      )}
      {kind === "browse" && (
        <>
          <div className="browse-toolbar">
            <button
              className="button"
              disabled={!directory || loading}
              onClick={() =>
                void loadDirectory(directory.split("/").slice(0, -1).join("/"))
              }
            >
              上一级
            </button>
            <span>{directory || "工作副本根目录"}</span>
            <button
              className="button"
              onClick={() => {
                onSelect({
                  id: directory || ".",
                  path: directory,
                  status: "normal",
                  props: "none",
                  revision: workspace.revision,
                  treeConflict: false,
                  copied: false,
                });
                onClose();
              }}
            >
              选择当前目录
            </button>
          </div>
          <div className="browse-list">
            {nodes.map((n) => (
              <button
                key={n.path}
                onClick={() => {
                  if (n.directory) void loadDirectory(n.path);
                  else {
                    onSelect({
                      id: n.path,
                      path: n.path,
                      status: "normal",
                      props: "none",
                      revision: workspace.revision,
                      treeConflict: false,
                      copied: false,
                    });
                    onClose();
                  }
                }}
              >
                <FolderOpen size={15} />
                <span>{n.name}</span>
                {n.directory && <span>目录 →</span>}
              </button>
            ))}
          </div>
          <p className="modal-note">
            选择文件后可查看差异、历史、属性或进行文件操作。
          </p>
        </>
      )}
      {kind === "backups" && (
        <>
          <p className="modal-caption">
            备份只恢复文件内容，不改变 SVN 调度状态。恢复前会再次备份当前内容。
          </p>
          <div className="backup-list">
            {backups.map((b) => (
              <label key={b.id}>
                <input
                  type="radio"
                  name="backup"
                  checked={value === b.id}
                  onChange={() => setValue(b.id)}
                />
                <span>
                  <strong>{b.reason}</strong>
                  <small>
                    {new Date(b.date).toLocaleString("zh-CN")} ·{" "}
                    {b.files.length} 项 · {(b.bytes / 1024).toFixed(1)} KB
                  </small>
                </span>
              </label>
            ))}
            {!backups.length && <p>暂无备份。</p>}
          </div>
          <button
            className="button"
            onClick={() =>
              void bridge()
                .reveal({ backups: true })
                .then(unwrap)
                .catch(onError)
            }
          >
            打开备份目录
          </button>
          {footer(
            () => execute("restoreBackup", { backupId: value }),
            "恢复所选备份",
            !value,
          )}
        </>
      )}
      {kind === "remove" && (
        <>
          <p className="modal-caption">
            仅从侧栏移除 {workspace.name} 的记录。本地目录和 SVN
            仓库均不会被删除。
          </p>
          {footer(
            () => bridge().removeWorkspace(workspace.id).then(unwrap),
            "移除记录",
            false,
            true,
          )}
        </>
      )}
      {kind === "lock" && (
        <>
          <p className="modal-caption">
            加锁以下文件，避免其他用户同时提交；不会强制抢占已有锁。
          </p>
          <pre className="path-preview">{paths.join("\n")}</pre>
          <textarea
            placeholder="加锁说明（可选）"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          {footer(
            () => execute("lock", { paths, message }),
            "加锁",
            !paths.length,
          )}
        </>
      )}
      {kind === "unlock" && (
        <>
          <p className="modal-caption">
            释放所选文件的锁，不强制移除他人持有的锁。
          </p>
          <pre className="path-preview">{paths.join("\n")}</pre>
          {footer(() => execute("unlock", { paths }), "解锁", !paths.length)}
        </>
      )}
      {kind === "cleanup" && (
        <>
          <p className="modal-caption">
            清理工作副本管理锁与中断任务遗留的状态。请确认没有其他 SVN
            客户端正在修改此目录。本操作不删除未跟踪或忽略的文件。
          </p>
          {footer(() => execute("cleanup"), "清理工作副本")}
        </>
      )}
    </Dialog>
  );
}
