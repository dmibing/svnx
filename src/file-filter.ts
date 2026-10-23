import type { FileEntry } from "./types";

export const isVersionedChange = (file: FileEntry) =>
  !["unversioned", "ignored", "normal", "none", "external"].includes(
    file.status,
  ) ||
  file.props === "modified" ||
  file.props === "conflicted" ||
  file.treeConflict;

export const isCommittable = (file: FileEntry) =>
  ["modified", "added", "deleted", "replaced"].includes(file.status) &&
  !file.treeConflict &&
  file.props !== "conflicted";

export function filterFiles(files: FileEntry[], query: string, filter: string) {
  const search = query.toLowerCase();
  return files.filter(
    (file) =>
      file.path.toLowerCase().includes(search) &&
      ((filter === "all" && file.status !== "unversioned") ||
        (filter === "modified" && file.status === "added") ||
        (filter === "conflicted" &&
          (file.treeConflict || file.props === "conflicted")) ||
        file.status === filter),
  );
}
