const test = require("node:test");
const assert = require("node:assert/strict");
test("merge choices preserve context, CRLF, diff3 base and unrelated blocks", async () => {
  const { conflictSections, acceptConflict, hasConflictMarkers } =
    await import("../src/conflict-sections.ts");
  const block =
    "<<<<<<< .mine\r\nlocal\r\n||||||| .r1\r\nbase\r\n=======\r\nremote\r\n>>>>>>> .r2\r\n";
  const text = `prefix\r\n${block}middle\r\n${block}tail`;
  const sections = conflictSections(text);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].base, "base\r\n");
  const next = acceptConflict(text, sections[0], "local");
  assert.equal(next, `prefix\r\nlocal\r\nmiddle\r\n${block}tail`);
  const final = acceptConflict(next, conflictSections(next)[0], "remote");
  assert.equal(final, "prefix\r\nlocal\r\nmiddle\r\nremote\r\ntail");
  assert.equal(hasConflictMarkers(final), false);
  assert.equal(
    acceptConflict(text, sections[0], "both"),
    `prefix\r\nlocal\r\nremote\r\nmiddle\r\n${block}tail`,
  );
  assert.equal(
    acceptConflict(text, sections[0], "remoteFirst"),
    `prefix\r\nremote\r\nlocal\r\nmiddle\r\n${block}tail`,
  );
  assert.equal(
    acceptConflict("edited" + text, sections[0], "local"),
    "edited" + text,
  );
  assert.equal(conflictSections("<<<<<<< .mine\nincomplete").length, 0);
  assert.equal(hasConflictMarkers("||||||| .r1\nbase"), true);
  assert.equal(
    conflictSections("<<<<<<< .mine\na\n=======\nb\n>>>>>>> .r2").length,
    1,
  );
});
