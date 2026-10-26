export interface ConflictSection {
  start: number;
  end: number;
  raw: string;
  local: string;
  remote: string;
  base?: string;
}
export function conflictSections(text: string): ConflictSection[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const sections: ConflictSection[] = [];
  let offset = 0;
  for (let index = 0; index < lines.length; index++) {
    const start = offset;
    if (!/^<<<<<<<(?:\s|$)/.test(lines[index])) {
      offset += lines[index].length;
      continue;
    }
    const begin = index;
    let cursor = index + 1;
    while (
      cursor < lines.length &&
      !/^(\|{7}|={7})(?:\s|$)/.test(lines[cursor])
    )
      cursor++;
    const local = lines.slice(index + 1, cursor).join("");
    let base: string | undefined;
    if (/^\|{7}/.test(lines[cursor] || "")) {
      const baseStart = ++cursor;
      while (cursor < lines.length && !/^={7}(?:\s|$)/.test(lines[cursor]))
        cursor++;
      base = lines.slice(baseStart, cursor).join("");
    }
    if (!/^={7}/.test(lines[cursor] || "")) break;
    const remoteStart = ++cursor;
    while (cursor < lines.length && !/^>{7}(?:\s|$)/.test(lines[cursor]))
      cursor++;
    if (cursor === lines.length) break;
    const raw = lines.slice(begin, cursor + 1).join("");
    sections.push({
      start,
      end: start + raw.length,
      raw,
      local,
      remote: lines.slice(remoteStart, cursor).join(""),
      base,
    });
    offset = start + raw.length;
    index = cursor;
  }
  return sections;
}
export const hasConflictMarkers = (text: string) =>
  /^(<{7}|={7}|>{7}|\|{7})/m.test(text);
export function acceptConflict(
  text: string,
  section: ConflictSection,
  choice: "local" | "remote" | "both" | "remoteFirst" | "base",
) {
  if (text.slice(section.start, section.end) !== section.raw) return text;
  const replacement =
    choice === "both"
      ? section.local + section.remote
      : choice === "remoteFirst"
        ? section.remote + section.local
        : (section[choice] ?? "");
  return text.slice(0, section.start) + replacement + text.slice(section.end);
}
