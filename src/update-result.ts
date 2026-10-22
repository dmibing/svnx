export interface UpdateResult {
  output: string;
  files: { path: string; status: string; conflict: boolean }[];
}

export function normalizeUpdateResult(response: unknown): UpdateResult {
  const result = response as Partial<UpdateResult> | null;
  const output = typeof result?.output === "string" ? result.output : "";
  if (Array.isArray(result?.files)) return { output, files: result.files };
  // An existing Electron worker can still return the earlier output-only format.
  const files = new Map<string, UpdateResult["files"][number]>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^([ADUCGER ])([ADUCGER ])([B ])([C ])\s+(.+)$/.exec(line);
    if (!match || !match.slice(1, 5).join("").trim()) continue;
    const [, content, properties, lock, tree, path] = match;
    const conflict =
      !!files.get(path)?.conflict || [content, properties, tree].includes("C");
    files.set(path, {
      path,
      status: conflict
        ? "C"
        : content.trim() || properties.trim() || lock.trim(),
      conflict,
    });
  }
  return { output, files: [...files.values()] };
}
