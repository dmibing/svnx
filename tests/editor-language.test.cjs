const test = require("node:test");
const assert = require("node:assert/strict");
test(".NET and JavaScript ecosystem file mappings", async () => {
  const { editorLanguage } = await import("../src/editor-language.ts");
  const { highlightFixtures } = await import("./highlight-fixtures.mjs");
  for (const [name, expected, content] of highlightFixtures) {
    assert.equal(editorLanguage(name, content), expected, name);
    assert.equal(
      editorLanguage(`C:\\source\\${name.toUpperCase()}`, content),
      expected,
      name,
    );
  }
  for (const name of [
    "app.csproj.user",
    "app.pubxml.user",
    "a.fsproj",
    "a.vbproj",
    "a.slnx",
    "a.resx",
    "a.targets",
    "a.nuspec",
    "NuGet.Config",
  ])
    assert.equal(editorLanguage(name), "xml", name);
  assert.equal(editorLanguage("src/@types/node.d.ts"), "typescript");
  assert.equal(editorLanguage(".prettierrc", '{"semi":false}'), "json");
  assert.equal(editorLanguage(".prettierrc", "semi: false"), "yaml");
  assert.equal(editorLanguage("example.unknown"), "plaintext");
  assert.equal(editorLanguage("file.dll"), "plaintext");
});
