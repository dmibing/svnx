import { useState } from "react";
import { Sun, Moon, Monitor, Check, Loader2, FolderOpen } from "lucide-react";
import Dialog from "./Dialog";
import Select from "./Select";
import SoftwareUpdate from "./SoftwareUpdate";
import { bridge, unwrap, useClient } from "../client";
import type { Credentials, Settings, Workspace } from "../types";
import type { Execute } from "./Operations";
export function SettingsDialog({
  onClose,
  onError,
  onBackups,
}: {
  onClose: () => void;
  onError: (e: Error) => void;
  onBackups: () => void;
}) {
  const { settings, engine, engineError, set } = useClient();
  const [b, setBusy] = useState(false);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e as Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="偏好设置"
      onClose={onClose}
      busy={b}
      className="settings-modal"
    >
      <div className="settings-grid">
        <div className="settings-section">
          <h3>外观</h3>
          <p>选择工作空间的配色方案。</p>
          <div className="theme-options">
            {(
              [
                { id: "light", name: "浅色", icon: Sun },
                { id: "dark", name: "深色", icon: Moon },
                { id: "system", name: "跟随系统", icon: Monitor },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                className={settings.theme === t.id ? "chosen" : ""}
                onClick={() =>
                  void action(async () => {
                    const next = unwrap(
                      await bridge().settings({ theme: t.id }),
                    );
                    set({ settings: next });
                  })
                }
              >
                <t.icon size={22} />
                <span>{t.name}</span>
                {settings.theme === t.id && <Check size={13} />}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-section">
          <h3>SVN 命令行引擎</h3>
          <p className="break-path">
            {settings.svnPath} · {engine || "未检测到"}
          </p>
          {engineError && <p className="inline-warning">{engineError}</p>}
          <button
            className="button"
            disabled={b}
            onClick={() =>
              void action(async () => {
                const next = unwrap(await bridge().chooseEngine());
                if (next)
                  set({
                    settings: { ...settings, svnPath: next.path },
                    engine: next.version,
                    engineError: "",
                  });
              })
            }
          >
            <FolderOpen size={14} />
            选择 SVN 1.14+ 可执行文件
          </button>
        </div>
        <div className="settings-section">
          <h3>外部差异工具</h3>
          <p className="break-path">
            {settings.externalTool ||
              "未配置。选择支持 old-file new-file 参数的工具，如 WinMerge。"}
          </p>
          <button
            className="button"
            disabled={b}
            onClick={() =>
              void action(async () => {
                const file = unwrap(await bridge().chooseExternalTool());
                if (file)
                  set({ settings: { ...settings, externalTool: file } });
              })
            }
          >
            选择差异工具
          </button>
        </div>
        <div className="settings-section">
          <h3>还原备份</h3>
          <p>
            每次最多 512 MB，每个工作副本最多 2
            GB。达到上限会停止操作；不会自动删除旧备份。
          </p>
          <button className="button" onClick={onBackups}>
            查看当前工作副本备份
          </button>
        </div>
      </div>
      <div className="settings-update-check">
        <div>
          <h3>猫咪摆件</h3>
          <p>
            蓝白英短会慢慢散步，偶尔追追小老鼠；点击互动，无声音。阅读代码时保持安静。
          </p>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={settings.statusCat ?? true}
            disabled={b}
            onChange={(event) => {
              const enabled = event.target.checked;
              void action(async () =>
                set({
                  settings: unwrap(
                    await bridge().settings({ statusCat: enabled }),
                  ),
                }),
              );
            }}
          />
          显示猫咪摆件
        </label>
      </div>
      <div className="settings-update-check">
        <div>
          <h3>远端更新检测</h3>
          <p>后台检测待更新路径，不会自动拉取文件。</p>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={settings.autoCheckUpdates ?? true}
            disabled={b}
            onChange={(event) => {
              const enabled = event.target.checked;
              void action(async () => {
                set({
                  settings: unwrap(
                    await bridge().settings({ autoCheckUpdates: enabled }),
                  ),
                });
              });
            }}
          />
          自动检测
        </label>
        <Select
          label="更新检测间隔"
          disabled={b || !(settings.autoCheckUpdates ?? true)}
          value={String(settings.updateCheckMinutes || 5)}
          onValueChange={(value) =>
            void action(async () => {
              set({
                settings: unwrap(
                  await bridge().settings({
                    updateCheckMinutes: Number(value),
                  }),
                ),
              });
            })
          }
          options={[1, 5, 10, 15, 30, 60].map((value) => ({
            value: String(value),
            label: `每 ${value} 分钟`,
          }))}
        />
      </div>
      <SoftwareUpdate />
      <p className="modal-note">
        界面语言：简体中文 · 设置自动保存；密码不写入设置。
      </p>
      <footer>
        <button className="button primary" onClick={onClose}>
          完成
        </button>
      </footer>
    </Dialog>
  );
}
export function CheckoutDialog({
  execute,
  onClose,
  onError,
}: {
  execute: Execute;
  onClose: () => void;
  onError: (e: Error) => void;
}) {
  const [url, setUrl] = useState(""),
    [directory, setDirectory] = useState(""),
    [revision, setRevision] = useState("HEAD"),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title="检出工作副本" onClose={onClose} busy={busy}>
      <p className="modal-caption">
        从 SVN
        仓库检出到本地空目录。中断后会保留已检出的内容，可打开目录并更新恢复。
      </p>
      <label className="field-label" htmlFor="checkout-url">
        仓库地址
      </label>
      <input
        id="checkout-url"
        className="text-input"
        placeholder="https://svn.example.com/project/trunk"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <label className="field-label">本地目录</label>
      <div className="choose-path">
        <span>{directory || "尚未选择"}</span>
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            void bridge()
              .chooseCheckout()
              .then(unwrap)
              .then((value) => {
                if (value) setDirectory(value);
              })
              .catch(onError)
          }
        >
          <FolderOpen size={14} />
          选择空目录
        </button>
      </div>
      <label className="field-label" htmlFor="checkout-revision">
        目标版本
      </label>
      <input
        id="checkout-revision"
        className="text-input"
        value={revision}
        onChange={(e) => setRevision(e.target.value.toUpperCase())}
      />
      <footer>
        <button className="button" disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          disabled={
            busy ||
            !directory ||
            !/^(https?|svn|svn\+ssh|file):\/\//.test(url) ||
            !/^(HEAD|\d+)$/.test(revision)
          }
          onClick={async () => {
            setBusy(true);
            try {
              const w = (await execute("checkout", {
                url,
                directory,
                revision,
              })) as Workspace;
              useClient.getState().set({ selectedId: w.id });
              onClose();
            } catch (e) {
              onError(e as Error);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="spin" size={14} />}开始检出
        </button>
      </footer>
    </Dialog>
  );
}
export function AuthDialog({
  certificate,
  details,
  onSubmit,
  onClose,
}: {
  certificate: boolean;
  details: string;
  onSubmit: (credentials: Credentials) => Promise<void>;
  onClose: () => void;
}) {
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [trust, setTrust] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  return (
    <Dialog
      title={certificate ? "核对服务器证书" : "SVN 认证"}
      onClose={onClose}
      busy={busy}
    >
      <p className="modal-caption">
        凭据仅用于此次重试，不写入日志或设置。已完成或结果不确定的提交不能直接重试，应先核对历史。
      </p>
      {certificate && (
        <>
          <pre className="certificate-details">{details}</pre>
          <p className="inline-warning">
            仅在核对服务器身份和证书后，勾选此次允许的验证例外。
          </p>
          {[
            ["unknown-ca", "未知签发机构"],
            ["cn-mismatch", "证书名称不匹配"],
            ["expired", "证书已过期"],
            ["not-yet-valid", "证书尚未生效"],
            ["other", "其他验证错误"],
          ].map(([id, label]) => (
            <label className="check-label" key={id}>
              <input
                type="checkbox"
                checked={trust.includes(id)}
                onChange={() =>
                  setTrust(
                    trust.includes(id)
                      ? trust.filter((t) => t !== id)
                      : [...trust, id],
                  )
                }
              />
              {label}
            </label>
          ))}
        </>
      )}
      <label className="field-label" htmlFor="auth-user">
        用户名
      </label>
      <input
        id="auth-user"
        autoComplete="username"
        className="text-input"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <label className="field-label" htmlFor="auth-password">
        密码（不保存）
      </label>
      <input
        id="auth-password"
        className="text-input"
        type="password"
        autoComplete="off"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <footer>
        <button className="button" disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          disabled={
            busy ||
            (certificate && !trust.length) ||
            (!certificate && !username.trim())
          }
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit({
                username,
                password,
                trust: certificate ? trust : undefined,
              });
              setPassword("");
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="spin" size={14} />}仅此次重试
        </button>
      </footer>
    </Dialog>
  );
}
