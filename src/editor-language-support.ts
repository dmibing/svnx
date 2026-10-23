import "monaco-editor/esm/vs/basic-languages/vb/vb.contribution";
import "monaco-editor/esm/vs/basic-languages/fsharp/fsharp.contribution";
import "monaco-editor/esm/vs/basic-languages/razor/razor.contribution";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";
import "monaco-editor/esm/vs/basic-languages/less/less.contribution";
import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution";
import "monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution";
import "monaco-editor/esm/vs/basic-languages/bat/bat.contribution";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
import "monaco-editor/esm/vs/basic-languages/graphql/graphql.contribution";
import "monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution";
import "monaco-editor/esm/vs/basic-languages/mdx/mdx.contribution";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution";
import "monaco-editor/esm/vs/basic-languages/css/css.contribution";
import "monaco-editor/esm/vs/basic-languages/html/html.contribution";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";
import "monaco-editor/esm/vs/basic-languages/scss/scss.contribution";
import {
  conf as htmlConfiguration,
  language as htmlLanguage,
} from "monaco-editor/esm/vs/basic-languages/html/html";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
import "monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution";
import "monaco-editor/esm/vs/language/json/monaco.contribution";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: (_moduleId: string, label: string) =>
    label === "json" ? new JsonWorker() : new EditorWorker(),
};
monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
  validate: false,
  enableSchemaRequest: false,
});
monaco.editor.defineTheme("svnx-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#171717",
    "editor.foreground": "#E8E8E8",
    "editorGutter.background": "#171717",
    "editorLineNumber.foreground": "#999999",
    "editorLineNumber.activeForeground": "#DDDDDD",
    "editor.selectionBackground": "#30466D",
    "editor.inactiveSelectionBackground": "#2C3440",
    "editor.lineHighlightBackground": "#202020",
    "diffEditor.insertedTextBackground": "#365B3D66",
    "diffEditor.removedTextBackground": "#713D3D66",
    "diffEditor.insertedLineBackground": "#203928",
    "diffEditor.removedLineBackground": "#422A2A",
    "diffEditorGutter.insertedLineBackground": "#304E37",
    "diffEditorGutter.removedLineBackground": "#633A3A",
    "diffEditor.diagonalFill": "#353535",
    "editorWidget.background": "#202020",
    "scrollbarSlider.background": "#68686855",
    "scrollbarSlider.hoverBackground": "#88888888",
  },
});
monaco.languages.register({ id: "vue", extensions: [".vue"] });
monaco.languages.setLanguageConfiguration("vue", htmlConfiguration);
monaco.languages.setMonarchTokensProvider("vue", {
  ...htmlLanguage,
  tokenizer: {
    ...htmlLanguage.tokenizer,
    root: [
      [
        /<script\b[^>]*>/,
        { token: "tag", next: "@vueScript", nextEmbedded: "typescript" },
      ],
      [
        /<style\b[^>]*\blang\s*=\s*["']scss["'][^>]*>/,
        { token: "tag", next: "@vueStyle", nextEmbedded: "scss" },
      ],
      [
        /<style\b[^>]*>/,
        { token: "tag", next: "@vueStyle", nextEmbedded: "css" },
      ],
      [
        /\{\{/,
        {
          token: "delimiter",
          next: "@vueExpression",
          nextEmbedded: "typescript",
        },
      ],
      ...htmlLanguage.tokenizer.root,
    ],
    vueScript: [
      [
        /<\/script\s*>/,
        { token: "@rematch", next: "@pop", nextEmbedded: "@pop" },
      ],
      [/[^<]+/, ""],
      [/</, ""],
    ],
    vueStyle: [
      [
        /<\/style\s*>/,
        { token: "@rematch", next: "@pop", nextEmbedded: "@pop" },
      ],
      [/[^<]+/, ""],
      [/</, ""],
    ],
    vueExpression: [
      [/\}\}/, { token: "delimiter", next: "@pop", nextEmbedded: "@pop" }],
      [/[^}]+/, ""],
      [/}/, ""],
    ],
  },
});

// Embedded sections keep their own lexer while HTML remains responsible for markup.
const embeddedEnd = (end: RegExp): monaco.languages.IMonarchLanguageRule[] => [
  [end, { token: "@rematch", next: "@pop", nextEmbedded: "@pop" }],
  [/./, ""],
];
for (const id of ["aspnet", "t4", "svelte", "astro"]) {
  monaco.languages.register({ id });
  monaco.languages.setLanguageConfiguration(id, htmlConfiguration);
  const rules: monaco.languages.IMonarchLanguageRule[] =
    id === "aspnet"
      ? [
          [/<%@.*?%>/, "metatag"],
          [
            /<script\b[^>]*\brunat\s*=\s*["']server["'][^>]*>/,
            { token: "tag", next: "@serverScript", nextEmbedded: "csharp" },
          ],
          [
            /<%[=:#]?/,
            {
              token: "delimiter",
              next: "@serverBlock",
              nextEmbedded: "csharp",
            },
          ],
        ]
      : id === "t4"
        ? [
            [/<#@.*?#>/, "metatag"],
            [
              /<#[=+]?/,
              { token: "delimiter", next: "@t4Block", nextEmbedded: "csharp" },
            ],
          ]
        : [
            ...(id === "astro"
              ? ([
                  [
                    /^---\s*$/,
                    {
                      token: "delimiter",
                      next: "@frontmatter",
                      nextEmbedded: "typescript",
                    },
                  ],
                ] as monaco.languages.IMonarchLanguageRule[])
              : []),
            [
              /<script\b[^>]*>/,
              {
                token: "tag",
                next: "@componentScript",
                nextEmbedded: "typescript",
              },
            ],
            [
              /<style\b[^>]*\blang\s*=\s*["']scss["'][^>]*>/,
              { token: "tag", next: "@componentStyle", nextEmbedded: "scss" },
            ],
            [
              /<style\b[^>]*>/,
              { token: "tag", next: "@componentStyle", nextEmbedded: "css" },
            ],
            [
              /\{/,
              {
                token: "delimiter",
                next: "@componentExpression",
                nextEmbedded: "typescript",
              },
            ],
          ];
  monaco.languages.setMonarchTokensProvider(id, {
    ...htmlLanguage,
    tokenizer: {
      ...htmlLanguage.tokenizer,
      root: [...rules, ...htmlLanguage.tokenizer.root],
      serverScript: embeddedEnd(/<\/script\s*>/),
      serverBlock: embeddedEnd(/%>/),
      t4Block: embeddedEnd(/#>/),
      componentScript: embeddedEnd(/<\/script\s*>/),
      componentStyle: embeddedEnd(/<\/style\s*>/),
      componentExpression: embeddedEnd(/\}/),
      frontmatter: embeddedEnd(/^---\s*$/),
    },
  });
}
monaco.languages.register({ id: "solution" });
monaco.languages.setMonarchTokensProvider("solution", {
  tokenizer: {
    root: [
      [/^#.*$/, "comment"],
      [
        /\b(Project|EndProject|Global|EndGlobal|GlobalSection|EndGlobalSection|ProjectSection|EndProjectSection)\b/,
        "keyword",
      ],
      [/"[^"\r\n]*"/, "string"],
      [/\{[0-9A-Fa-f-]+\}/, "number.hex"],
      [/\b\d+(?:\.\d+)*\b/, "number"],
      [/[=(),]/, "delimiter"],
    ],
  },
});
