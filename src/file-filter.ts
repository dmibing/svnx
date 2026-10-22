import type { FileEntry } from "./types";

export function filterFiles(files: FileEntry[], query: string, filter: string) {
  const search = query.toLowerCase();
  return files.filter(
    (file) =>
      file.path.toLowerCase().includes(search) &&
      (filter === "all" ||
        (filter === "conflicted" &&
          (file.treeConflict || file.props === "conflicted")) ||
        file.status === filter),
  );
}
