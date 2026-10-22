const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeUpdateResult } = require("../src/update-result.ts");

test("update result accepts older worker responses without a files field", () => {
  const result = normalizeUpdateResult({
    output:
      "Updating '.':\nU    中文.txt\n   C folder\nUpdated to revision 2.\n",
  });
  assert.deepEqual(result.files, [
    { path: "中文.txt", status: "U", conflict: false },
    { path: "folder", status: "C", conflict: true },
  ]);
});
test("empty and current update results do not crash", () => {
  for (const response of [null, undefined, {}, { output: "At revision 2." }]) {
    assert.deepEqual(normalizeUpdateResult(response).files, []);
  }
  const response = {
    output: "done",
    files: [{ path: "file", status: "A", conflict: false }],
  };
  assert.deepEqual(normalizeUpdateResult(response), response);
});
