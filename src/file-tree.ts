import type { FileEntry } from "./types";

export interface FileNode {
  path: string;
  file?: FileEntry;
  children: FileNode[];
  entries: FileEntry[];
}

// Build once per filtered list; collapsed directories stay in the model.
export function buildFileTree(files: FileEntry[]): FileNode[] {
  const root: FileNode = { path: "", children: [], entries: [] };
  const nodes = new Map<string, FileNode>();
  for (const file of files) {
    if (!file.path) {
      root.children.push({ path: "", file, children: [], entries: [file] });
      continue;
    }
    let parent = root;
    const parts = file.path.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      let node = nodes.get(current);
      if (!node) {
        node = { path: current, children: [], entries: [] };
        nodes.set(current, node);
        parent.children.push(node);
      }
      node.entries.push(file);
      parent = node;
    }
    parent.file = file;
  }
  const sort = (items: FileNode[]) => {
    items.sort(
      (a, b) =>
        Number(b.children.length > 0) - Number(a.children.length > 0) ||
        a.path.localeCompare(b.path, "zh-CN", { numeric: true }),
    );
    for (const node of items) sort(node.children);
  };
  sort(root.children);
  return root.children;
}

export function flattenFileTree(nodes: FileNode[], collapsed: Set<string>) {
  const rows: { node: FileNode; depth: number }[] = [];
  const visit = (items: FileNode[], depth: number) => {
    for (const node of items) {
      rows.push({ node, depth });
      if (!collapsed.has(node.path)) visit(node.children, depth + 1);
    }
  };
  visit(nodes, 0);
  return rows;
}
