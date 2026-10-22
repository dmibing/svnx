export type Theme = "light" | "dark" | "system";
export type Status =
  | "modified"
  | "added"
  | "deleted"
  | "unversioned"
  | "conflicted"
  | "missing"
  | "replaced"
  | "ignored"
  | "obstructed"
  | "incomplete"
  | "normal";
export interface FileEntry {
  id: string;
  path: string;
  status: Status;
  props: string;
  revision: number;
  treeConflict: boolean;
  copied: boolean;
  movedFrom?: string;
  movedTo?: string;
  lock?: { owner: string; comment: string } | null;
}
export interface Workspace {
  id: string;
  name: string;
  path: string;
  wcRoot?: string;
  url: string;
  repositoryRoot: string;
  uuid: string;
  revision: number;
}
export interface Settings {
  autoCheckUpdates: boolean;
  updateCheckMinutes: number;
  theme: Theme;
  listWidth: number;
  svnPath: string;
  externalTool: string;
  locale: "zh-CN";
}
export interface Diff {
  path: string;
  before: string;
  after: string;
  encoding?: string;
  eol?: string;
  binary?: boolean;
  large?: boolean;
  directory?: boolean;
  properties?: string;
  oldBytes?: number;
  newBytes?: number;
  size?: number;
  additions?: number;
  deletions?: number;
}
export interface LogPath {
  path: string;
  action: string;
  kind: string;
  copyFrom?: string;
  copyRevision?: number;
}
export interface LogEntry {
  revision: number;
  author: string;
  date: string;
  message: string;
  paths: LogPath[];
}
export interface Plan {
  entries: FileEntry[];
  paths: string[];
  fingerprint: string;
  warnings: string[];
}
export interface Credentials {
  username: string;
  password: string;
  trust?: string[];
}
export interface Task {
  id: string;
  method: string;
  workspaceId?: string;
  date: string;
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  bytes?: number;
  error?: { code: string; message: string };
}
export interface Backup {
  id: string;
  date: string;
  reason: string;
  bytes: number;
  files: { path: string; directory?: boolean }[];
}
export interface Conflict {
  conflicts: Record<string, unknown>[];
  tree?: Record<string, unknown>;
  files: Record<string, { text: string; encoding: string }>;
  current: { text: string; encoding: string; binary?: boolean };
  fingerprint: string;
  kinds: string[];
}
export interface Envelope<T> {
  ok: boolean;
  data: T;
  error?: { code: string; message: string };
}
export interface SvnxBridge {
  bootstrap(): Promise<
    Envelope<{
      version: number;
      settings: Settings;
      workspaces: Workspace[];
      engine?: string;
      engineError?: string;
    }>
  >;
  run(request: {
    id: string;
    method: string;
    params: Record<string, unknown>;
  }): Promise<Envelope<unknown>>;
  cancel(id: string): Promise<Envelope<boolean>>;
  openWorkspace(): Promise<Envelope<Workspace | null>>;
  chooseCheckout(): Promise<Envelope<string | null>>;
  removeWorkspace(id: string): Promise<Envelope<boolean>>;
  settings(patch: Partial<Settings>): Promise<Envelope<Settings>>;
  chooseEngine(): Promise<Envelope<{ path: string; version: string } | null>>;
  chooseExternalTool(): Promise<Envelope<string | null>>;
  externalDiff(params: Record<string, unknown>): Promise<Envelope<boolean>>;
  reveal(params: {
    workspaceId?: string;
    path?: string;
    backups?: boolean;
  }): Promise<Envelope<boolean>>;
  onEvent(callback: (event: Record<string, unknown>) => void): () => void;
}
declare global {
  interface Window {
    svnx?: SvnxBridge;
  }
}
