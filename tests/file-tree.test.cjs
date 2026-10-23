const test = require("node:test");
const assert = require("node:assert/strict");
test("file tree merges directory properties, retains root, and collapses without dropping selection targets", async () => {
  const { buildFileTree, flattenFileTree } =
    await import("../src/file-tree.ts");
  const files = ["src/nested/b.cs", "", "src/a.vue", "src", "README.md"].map(
    (path) => ({ path }),
  );
  const tree = buildFileTree(files);
  const source = tree.find((node) => node.path === "src");
  assert.equal(source.file.path, "src");
  assert.deepEqual(source.entries.map((file) => file.path).sort(), [
    "src",
    "src/a.vue",
    "src/nested/b.cs",
  ]);
  assert.equal(flattenFileTree(tree, new Set()).length, 6);
  const collapsed = flattenFileTree(tree, new Set(["src"]));
  assert.equal(collapsed.length, 3);
  assert.equal(source.entries.length, 3);
  assert.equal(tree.filter((node) => node.path === "").length, 1);
});
