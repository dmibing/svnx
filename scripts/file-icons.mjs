import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const packageRoot = path.dirname(
  require.resolve("material-icon-theme/package.json"),
);
const manifest = JSON.parse(
  await fs.readFile(path.join(packageRoot, "dist/material-icons.json"), "utf8"),
);
const output = new URL("../public/file-icons/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const ids = new Set();
const mappings = {};
for (const theme of ["dark", "light"]) {
  mappings[theme] = {};
  for (const kind of ["fileNames", "fileExtensions"]) {
    const values = {
      ...manifest[kind],
      ...(theme === "light" ? manifest.light[kind] : {}),
    };
    mappings[theme][kind] = values;
    Object.values(values).forEach((id) => ids.add(id));
  }
}
for (const id of ids) {
  const source = path.resolve(
    packageRoot,
    "dist",
    manifest.iconDefinitions[id].iconPath,
  );
  await fs.copyFile(source, new URL(`${id}.svg`, output));
}
await fs.copyFile(
  path.join(packageRoot, "LICENSE"),
  new URL("LICENSE.txt", output),
);
await fs.mkdir(new URL("../src/generated/", import.meta.url), {
  recursive: true,
});
await fs.writeFile(
  new URL("../src/generated/file-icons.json", import.meta.url),
  JSON.stringify(mappings),
);
console.log(`Generated ${ids.size} local file icons`);
