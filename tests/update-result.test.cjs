const { test } = require("node:test");
const assert = require("node:assert/strict");
const { updateResult } = require("../electron/update-result.cjs");

test("update lists content, property, lock and tree conflicts without parsing summary lines", () => {
  const output =
    "Updating '.':\nA    新文件.txt\nU    folder/file with spaces.txt\n U   properties.txt\n   C tree\nC    conflict.txt\nU    conflict.txt\n  B  unlocked.txt\nUpdated to revision 12.\n";
  const result = updateResult(output);
  assert.equal(result.output, output);
  assert.equal(result.files.length, 6);
  assert.equal(
    result.files.find((file) => file.path === "properties.txt").status,
    "U",
  );
  assert.equal(
    result.files.find((file) => file.path === "tree").conflict,
    true,
  );
  assert.equal(
    result.files.find((file) => file.path === "conflict.txt").conflict,
    true,
  );
  assert.equal(
    result.files.find((file) => file.path === "unlocked.txt").status,
    "B",
  );
});
test("up-to-date output has no changed files", () => {
  assert.deepEqual(updateResult("Updating '.':\nAt revision 12.\n").files, []);
});
