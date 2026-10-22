const { z } = require("zod");
const relative = z
  .string()
  .max(32768)
  .refine(
    (v) =>
      !v.includes("\0") &&
      !v.includes("\n") &&
      !v.includes("\r") &&
      !/^[a-z]:|^[\\/]|(^|[\\/])\.\.([\\/]|$)|(^|[\\/])\.svn([\\/]|$)/i.test(v),
    "路径必须在工作副本内，且不能指向 .svn",
  );
const revision = z.string().regex(/^(HEAD|BASE|COMMITTED|PREV|\d+)$/);
const root = { workspaceId: z.string().min(1).max(100) };
const targets = { ...root, paths: z.array(relative).min(1).max(20000) };
const credentials = z
  .object({
    username: z.string().max(300),
    password: z.string().max(4096),
    trust: z
      .array(
        z.enum([
          "unknown-ca",
          "cn-mismatch",
          "expired",
          "not-yet-valid",
          "other",
        ]),
      )
      .max(5)
      .optional(),
  })
  .optional();
const schemas = {
  info: z.object(root),
  status: z.object({ ...root, showIgnored: z.boolean().optional() }),
  incoming: z.object(root),
  tree: z.object({ ...root, path: relative.default("") }),
  diff: z.object({
    ...root,
    credentials,
    path: relative,
    oldRevision: revision.optional(),
    newRevision: revision.optional(),
    repositoryPath: z.string().max(32768).optional(),
    peg: z.number().int().nonnegative().optional(),
    loadLarge: z.boolean().optional(),
    encoding: z
      .enum(["auto", "utf-8", "gb18030", "utf-16le", "utf-16be"])
      .default("auto"),
  }),
  log: z.object({
    ...root,
    path: relative.default(""),
    start: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(100).default(100),
    credentials,
  }),
  commitPlan: z.object(targets),
  commit: z.object({
    ...targets,
    fingerprint: z.string().length(64),
    message: z.string().trim().min(1).max(100000),
    keepLocks: z.boolean().optional(),
    credentials,
  }),
  revertPlan: z.object(targets),
  revert: z.object({ ...targets, fingerprint: z.string().length(64) }),
  update: z.object({
    ...targets,
    revision: revision.default("HEAD"),
    credentials,
  }),
  add: z.object(targets),
  delete: z.object(targets),
  move: z.object({ ...root, path: relative, destination: relative }),
  ignore: z.object({
    ...root,
    directory: relative.default(""),
    patterns: z
      .array(
        z
          .string()
          .min(1)
          .max(1000)
          .refine((s) => !/[\r\n]/.test(s)),
      )
      .max(1000),
  }),
  properties: z.object({ ...root, path: relative }),
  setProperty: z.object({
    ...root,
    path: relative,
    name: z
      .string()
      .min(1)
      .max(300)
      .regex(/^[\w:.-]+$/),
    value: z.string().max(1000000).nullable(),
  }),
  cleanup: z.object(root),
  lock: z.object({
    ...targets,
    message: z.string().max(10000).default(""),
    credentials,
  }),
  unlock: z.object({ ...targets, credentials }),
  conflict: z.object({ ...root, path: relative }),
  resolve: z.object({
    ...root,
    path: relative,
    accept: z.enum(["working", "mine-full", "theirs-full", "base"]),
    content: z.string().max(10000000).optional(),
    encoding: z.string().optional(),
    fingerprint: z.string().length(64),
    kind: z.enum(["text", "property", "tree"]),
  }),
  backups: z.object(root),
  restoreBackup: z.object({
    ...root,
    backupId: z.string().regex(/^[a-f0-9-]{36}$/),
  }),
};
module.exports = { schemas, relative, revision };
