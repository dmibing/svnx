function updateResult(output) {
  const files = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = /^([ADUCGER ])([ADUCGER ])([B ])([C ])\s+(.+)$/.exec(line);
    if (!match || !match.slice(1, 5).join("").trim()) continue;
    const [, content, properties, lock, treeConflict, file] = match;
    const previous = files.get(file);
    const conflict =
      previous?.conflict || [content, properties, treeConflict].includes("C");
    files.set(file, {
      path: file,
      status: conflict
        ? "C"
        : content.trim() || properties.trim() || lock.trim(),
      conflict,
    });
  }
  return { output, files: [...files.values()] };
}
module.exports = { updateResult };
