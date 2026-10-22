import { create } from "zustand";
import type { Envelope, Settings, Workspace, FileEntry, Task } from "./types";
const hiddenTasks = new Set([
  "status",
  "info",
  "tree",
  "diff",
  "log",
  "properties",
  "conflict",
  "backups",
  "commitPlan",
  "revertPlan",
]);
export function unwrap<T>(result: Envelope<T>): T {
  if (!result.ok)
    throw Object.assign(
      new Error(result.error?.message || "操作失败"),
      result.error,
    );
  return result.data;
}
export const bridge = () => {
  if (!window.svnx)
    throw new Error("请通过 Electron 桌面客户端使用真实 SVN 功能。");
  return window.svnx;
};
const pending = new Map<string, Promise<unknown>>();
export interface Challenge {
  id: string;
  code: string;
  message: string;
  retry: (credentials: import("./types").Credentials) => Promise<void>;
  cancel: () => void;
}
export async function run<T = unknown>(
  method: string,
  params: Record<string, unknown>,
  options: { id?: string; dedupe?: boolean } = {},
): Promise<T> {
  const key = JSON.stringify([method, params]);
  if (options.dedupe && pending.has(key)) return pending.get(key) as Promise<T>;
  const promise = bridge()
    .run({ id: options.id || crypto.randomUUID(), method, params })
    .then(async (response) => {
      if (response.ok) return response.data as T;
      if (!["AUTH", "CERTIFICATE"].includes(response.error?.code || ""))
        return unwrap(response) as T;
      return new Promise<T>((resolve, reject) => {
        const id = crypto.randomUUID();
        const finish = () => {
          const state = useClient.getState();
          state.set({
            challenges: state.challenges.filter((c) => c.id !== id),
          });
        };
        const challenge: Challenge = {
          id,
          code: response.error!.code,
          message: response.error!.message,
          retry: async (credentials) => {
            const value = unwrap(
              await bridge().run({
                id: crypto.randomUUID(),
                method,
                params: { ...params, credentials },
              }),
            ) as T;
            finish();
            resolve(value);
          },
          cancel: () => {
            finish();
            reject(
              Object.assign(new Error("已取消认证"), { code: "CANCELLED" }),
            );
          },
        };
        const state = useClient.getState();
        state.set({ challenges: [...state.challenges, challenge] });
      });
    });
  if (options.dedupe) {
    pending.set(key, promise);
    void promise.finally(() => pending.delete(key)).catch(() => {});
  }
  return promise;
}
interface State {
  settings: Settings;
  workspaces: Workspace[];
  selectedId: string;
  files: Record<string, FileEntry[]>;
  tasks: Task[];
  challenges: Challenge[];
  engine: string;
  engineError: string;
  booted: boolean;
  set: (patch: Partial<State>) => void;
  refresh: (id: string) => Promise<void>;
  initialize: () => Promise<void>;
}
export const useClient = create<State>((set, get) => ({
  settings: {
    theme: "system",
    listWidth: 330,
    svnPath: "svn",
    externalTool: "",
    locale: "zh-CN",
  },
  workspaces: [],
  selectedId: "",
  files: {},
  tasks: [],
  challenges: [],
  engine: "",
  engineError: "",
  booted: false,
  set: (patch) => set(patch),
  refresh: async (id) => {
    const entries = await run<FileEntry[]>(
      "status",
      { workspaceId: id },
      { dedupe: true },
    );
    set((s) => ({ files: { ...s.files, [id]: entries } }));
    const info = await run<Partial<Workspace>>(
      "info",
      { workspaceId: id },
      { dedupe: true },
    );
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === id ? { ...w, ...info } : w,
      ),
    }));
  },
  initialize: async () => {
    if (!window.svnx) {
      set({ booted: true });
      return;
    }
    const data = unwrap(await bridge().bootstrap());
    set({
      ...data,
      engine: data.engine || "",
      engineError: data.engineError || "",
      selectedId: data.workspaces[0]?.id || "",
      booted: true,
    });
  },
}));
export function listen() {
  return bridge().onEvent((event) => {
    const state = useClient.getState();
    if (event.type === "workspaces") {
      const workspaces = event.workspaces as Workspace[];
      state.set({
        workspaces,
        selectedId: workspaces.some((w) => w.id === state.selectedId)
          ? state.selectedId
          : workspaces.at(-1)?.id || "",
      });
    } else if (event.type === "task") {
      const old = state.tasks.find((t) => t.id === event.id);
      if (hiddenTasks.has(String(event.method)) || (!event.method && !old))
        return;
      const next = { ...old, ...event } as unknown as Task;
      state.set({
        tasks: [...state.tasks.filter((t) => t.id !== next.id), next].slice(
          -100,
        ),
      });
    } else if (event.type === "progress") {
      state.set({
        tasks: state.tasks.map((t) =>
          t.id === event.id
            ? { ...t, bytes: (t.bytes || 0) + Number(event.bytes) }
            : t,
        ),
      });
    } else if (event.type === "changed" || event.type === "activated") {
      const id = String(event.workspaceId || state.selectedId);
      if (id && state.engine) void state.refresh(id).catch(() => {});
    } else if (event.type === "service-error") {
      state.set({ engineError: String(event.message) });
    }
  });
}
