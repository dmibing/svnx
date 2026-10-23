const test = require("node:test");
const assert = require("node:assert/strict");

test("untracked files are separate from versioned changes and commit candidates", async () => {
  const { filterFiles, isVersionedChange, isCommittable } =
    await import("../src/file-filter.ts");
  const files = [
    "modified",
    "added",
    "deleted",
    "unversioned",
    "ignored",
    "conflicted",
    "normal",
  ].map((status) => ({ path: status, status }));
  assert.equal(files.filter(isVersionedChange).length, 4);
  assert.deepEqual(
    files.filter(isCommittable).map((f) => f.status),
    ["modified", "added", "deleted"],
  );
  assert.deepEqual(
    filterFiles(files, "", "unversioned").map((f) => f.status),
    ["unversioned"],
  );
  assert.equal(
    filterFiles(files, "", "all").some((f) => f.status === "unversioned"),
    false,
  );
  assert.equal(
    isCommittable({ status: "modified", treeConflict: true }),
    false,
  );
  assert.equal(
    isCommittable({ status: "modified", props: "conflicted" }),
    false,
  );
});
