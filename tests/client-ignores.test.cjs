const { test } = require("node:test");
const assert = require("node:assert/strict");
const { iniIgnores, ignoreMatcher } = require("../electron/client-ignores.cjs");
test("SVN ignore configuration preserves empty overrides, continuation, comments and literal glob semantics", () => {
  assert.equal(
    iniIgnores(
      "[miscellany]\n# global-ignores = *.wrong\nglobal-ignores = *.cache\n  __pycache__ #*#\n[other]\nglobal-ignores = *.wrong\n",
    ),
    "*.cache __pycache__ #*#",
  );
  assert.equal(iniIgnores("[miscellany]\nglobal-ignores =\n"), "");
  assert.equal(iniIgnores("[miscellany]\n# global-ignores = *.o\n"), undefined);
  const ignore = ignoreMatcher(["*.cache", "#*#", ".mimosa", "[Tt]humbs.db"]);
  assert.ok(ignore(".hidden.cache"));
  assert.ok(ignore("#draft#"));
  assert.ok(ignore(".mimosa"));
  assert.ok(ignore("Thumbs.db"));
  assert.ok(!ignore("main.cs"));
});
