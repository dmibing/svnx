const extensions: Record<string, string> = {
  cs: "csharp",
  csx: "csharp",
  cake: "csharp",
  vb: "vb",
  vbs: "vb",
  fs: "fsharp",
  fsx: "fsharp",
  fsi: "fsharp",
  razor: "razor",
  cshtml: "razor",
  aspx: "aspnet",
  ascx: "aspnet",
  asax: "aspnet",
  asmx: "aspnet",
  ashx: "aspnet",
  tt: "t4",
  ttinclude: "t4",
  sln: "solution",
  slnf: "json",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  html: "html",
  htm: "html",
  svg: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  json: "json",
  jsonc: "json",
  map: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  markdown: "markdown",
  mdx: "mdx",
  graphql: "graphql",
  gql: "graphql",
  ini: "ini",
  editorconfig: "ini",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  bat: "bat",
  cmd: "bat",
  sh: "shell",
  bash: "shell",
  sql: "sql",
};
for (const ext of [
  "xml",
  "config",
  "csproj",
  "vbproj",
  "fsproj",
  "esproj",
  "shproj",
  "njsproj",
  "vcxproj",
  "vcxproj.filters",
  "slnx",
  "proj",
  "props",
  "targets",
  "resx",
  "resw",
  "xaml",
  "axaml",
  "xsd",
  "xsl",
  "xslt",
  "settings",
  "nuspec",
  "pubxml",
  "pubxml.user",
  "csproj.user",
  "vbproj.user",
  "fsproj.user",
  "runsettings",
  "ruleset",
  "vsixmanifest",
  "wxs",
  "wxi",
  "wxl",
])
  extensions[ext] = "xml";
const jsonNames = new Set([
  ".babelrc",
  ".eslintrc",
  ".prettierrc",
  ".stylelintrc",
  ".swcrc",
  ".releaserc",
]);

export function editorLanguage(filePath: string, content = "") {
  const name =
    filePath.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() || "";
  if (
    name === ".env" ||
    name.startsWith(".env.") ||
    [".npmrc", ".yarnrc", ".editorconfig", "nuget.config"].includes(name)
  )
    return name === "nuget.config" ? "xml" : "ini";
  if (name === "dockerfile" || name.startsWith("dockerfile."))
    return "dockerfile";
  if (jsonNames.has(name))
    return content.trimStart().startsWith("{") || !content.trim()
      ? "json"
      : "yaml";
  const parts = name.split(".");
  for (let i = 1; i < parts.length; i++) {
    const found = extensions[parts.slice(i).join(".")];
    if (found) return found;
  }
  return "plaintext";
}
