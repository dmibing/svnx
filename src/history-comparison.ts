import type { LogEntry, LogPath } from "./types";
import type { Comparison } from "./components/DiffView";

// Keep navigation context separate from the SVN diff request.
export interface HistoryComparison {
  commit: LogEntry;
  file: Comparison;
}

export function compareHistoryFile(
  commit: LogEntry,
  path: LogPath,
  oldRevision = String(Math.max(0, commit.revision - 1)),
  newRevision = String(commit.revision),
): HistoryComparison {
  return {
    commit,
    file: {
      path: path.path.replace(/^\//, ""),
      repositoryPath: path.path,
      oldRevision,
      newRevision,
      peg:
        path.action === "D"
          ? Math.max(0, commit.revision - 1)
          : commit.revision,
    },
  };
}
