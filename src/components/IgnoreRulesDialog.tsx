import { TextArea } from "@radix-ui/themes/components/text-area";
import { Theme } from "@radix-ui/themes/components/theme";
import "@radix-ui/themes/styles.css";
import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Select from "./Select";
import type { Execute } from "./Operations";
type Property = "svn:ignore" | "svn:global-ignores";
type Rules = {
  own: Record<Property, string>;
  inherited: { source: string; value: string }[];
  fingerprint: string;
};
type Preview = {
  matches: { path: string; directory: boolean }[];
  scanned: number;
  truncated: boolean;
  limit: number;
};
export default function IgnoreRulesDialog({
  execute,
  onClose,
  workspacePath,
  dark,
}: {
  execute: Execute;
  onClose: () => void;
  workspacePath: string;
  dark: boolean;
}) {
  const [directory, setDirectory] = useState("");
  const [nodes, setNodes] = useState<
    { name: string; path: string; directory: boolean }[]
  >([]);
  const [data, setData] = useState<Rules | null>(null);
  const [property, setProperty] = useState<Property>("svn:ignore");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [discard, setDiscard] = useState(false);
  const sequence = useRef(0);
  const dirty = !!data && value !== data.own[property];
  const load = async (dir: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    setPreview(null);
    setData(null);
    try {
      const [rules, children] = await Promise.all([
        execute("ignoreRules", { directory: dir }),
        execute("tree", { path: dir }),
      ]);
      setDirectory(dir);
      setData(rules as Rules);
      setValue((rules as Rules).own[property]);
      setNodes(children as typeof nodes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load("");
    return () => {
      sequence.current++;
    };
  }, []);
  useEffect(() => {
    sequence.current++;
    setPreview(null);
  }, [directory, property, value]);
  const action = async (save: boolean) => {
    if (!data) return;
    const generation = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const result = await execute(save ? "saveIgnoreRules" : "ignorePreview", {
        directory,
        property,
        value,
        ...(save ? { fingerprint: data.fingerprint } : {}),
      });
      if (generation !== sequence.current) return;
      if (save) {
        setData(result as Rules);
        setValue((result as Rules).own[property]);
        setMessage("已保存为目录属性变更，需要提交后才会共享到仓库。");
      } else setPreview(result as Preview);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="忽略规则"
      subtitle="以文本编辑 SVN 目录属性；每行一条规则，保存后仍需手动提交。"
      wide
      className="ignore-rules-modal"
      busy={busy}
      onClose={() => (dirty ? setDiscard(true) : onClose())}
    >
      {error && (
        <p role="alert" className="warning-box">
          {error}
        </p>
      )}
      {discard && (
        <div className="warning-box">
          有未保存的修改。
          <button className="button" onClick={onClose}>
            放弃并关闭
          </button>
          <button className="button" onClick={() => setDiscard(false)}>
            继续编辑
          </button>
        </div>
      )}
      <div className="ignore-layout">
        <div className="ignore-directories">
          <strong>选择目录</strong>
          <p className="break-path">{directory || "当前工作副本"}</p>
          <button
            className="button"
            disabled={busy || dirty || !directory}
            onClick={() =>
              void load(directory.split("/").slice(0, -1).join("/"))
            }
          >
            上级目录
          </button>
          {dirty && (
            <p className="modal-note">
              先保存或放弃修改，再切换目录或作用范围。
            </p>
          )}
          {nodes
            .filter((n) => n.directory)
            .map((n) => (
              <button
                className="ignore-directory"
                key={n.path}
                disabled={busy || dirty}
                onClick={() => void load(n.path)}
              >
                {n.name}
              </button>
            ))}
        </div>
        <div className="ignore-editor">
          <label className="field-label">作用范围</label>
          <Select
            label="忽略规则作用范围"
            className="select-full"
            value={property}
            disabled={busy || dirty || !data}
            options={[
              { value: "svn:ignore", label: "仅此目录" },
              { value: "svn:global-ignores", label: "此目录及子目录" },
            ]}
            onValueChange={(p) => {
              setProperty(p as Property);
              setValue(data!.own[p as Property]);
            }}
          />
          <p className="modal-note">
            {property} · 按文件名匹配，支持 *、?、[abc]；不支持 Git 的路径、!
            反向排除或 # 注释语法。已跟踪文件不受影响。
          </p>
          {property === "svn:global-ignores" && (
            <p className="modal-note">
              此属性按空白分隔规则，文件名中包含空格时请使用仅此目录规则。
            </p>
          )}
          <Theme
            className="ignore-input-theme"
            appearance={dark ? "dark" : "light"}
            accentColor="blue"
            grayColor="gray"
            hasBackground={false}
          >
            <TextArea
              aria-label="忽略规则内容"
              className="ignore-framework-textarea"
              size="2"
              variant="surface"
              radius="medium"
              value={value}
              disabled={busy || !data}
              spellCheck={false}
              onChange={(e) => {
                setValue(e.target.value);
                setMessage("");
              }}
              placeholder={"bin\nobj\nnode_modules\n*.user"}
            />
          </Theme>
          <div className="ignore-editor-actions">
            <button
              className="button"
              disabled={busy || !data}
              onClick={() => void action(false)}
            >
              预览匹配文件
            </button>
            <button
              className="button"
              disabled={busy || !dirty}
              onClick={() => setValue(data!.own[property])}
            >
              放弃修改
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => void load(directory)}
            >
              重新加载规则
            </button>
          </div>
          {preview && (
            <div className="ignore-preview" aria-label="忽略规则预览">
              <strong>匹配当前编辑内容：{preview.matches.length} 个路径</strong>
              <p className="modal-note">
                只预览未跟踪和已忽略内容；匹配目录时包含其子内容，不重复展开。
                {preview.truncated
                  ? `扫描达到 ${preview.limit} 项上限，结果不完整。`
                  : ""}
              </p>
              {preview.matches.map((m) => (
                <div key={m.path}>
                  {m.path}
                  {m.directory ? "/" : ""}
                </div>
              ))}
            </div>
          )}
          <details>
            <summary>
              继承的规则（只读，{data?.inherited.length || 0} 个来源）
            </summary>
            {data?.inherited.map((p) => (
              <div key={p.source}>
                <strong className="break-path">{p.source}</strong>
                {(p.source.replaceAll("\\", "/").toLowerCase() ===
                  workspacePath.replaceAll("\\", "/").toLowerCase() ||
                  p.source
                    .replaceAll("\\", "/")
                    .toLowerCase()
                    .startsWith(
                      workspacePath.replaceAll("\\", "/").toLowerCase() + "/",
                    )) && (
                  <button
                    className="button"
                    disabled={busy || dirty}
                    onClick={() =>
                      void load(
                        p.source
                          .replaceAll("\\", "/")
                          .slice(workspacePath.length)
                          .replace(/^\//, ""),
                      )
                    }
                  >
                    定位来源目录
                  </button>
                )}
                <pre>{p.value}</pre>
              </div>
            ))}
            <p className="modal-note">
              继承规则来自上级目录，需在来源目录编辑。此处不修改本机全局配置。
            </p>
          </details>
          {message && <p role="status">{message}</p>}
        </div>
      </div>
      <div className="modal-footer">
        <span className="modal-note">
          清空内容并保存会删除此目录上的对应属性，不会删除本地文件。
        </span>
        <button
          className="button primary"
          disabled={busy || !dirty}
          onClick={() => void action(true)}
        >
          {busy ? "处理中…" : "保存忽略规则"}
        </button>
      </div>
    </Dialog>
  );
}
