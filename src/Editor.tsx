import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution";
import "monaco-editor/esm/vs/basic-languages/css/css.contribution";
import "monaco-editor/esm/vs/basic-languages/html/html.contribution";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
import "monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { useEffect, useRef } from "react";
import type { Diff } from "./types";
(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
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
function language(path: string) {
  const ext = path.split(".").at(-1)?.toLowerCase();
  return (
    (
      {
        ts: "typescript",
        tsx: "typescript",
        js: "typescript",
        jsx: "typescript",
        css: "css",
        scss: "css",
        html: "html",
        vue: "html",
        md: "markdown",
        cs: "csharp",
        csx: "csharp",
        xml: "xml",
        csproj: "xml",
        resx: "xml",
        xaml: "xml",
        config: "xml",
      } as Record<string, string>
    )[ext || ""] || "plaintext"
  );
}
export default function Editor({
  file,
  dark,
  inline,
  ignoreWhitespace,
  direction,
}: {
  file: Diff;
  dark: boolean;
  inline: boolean;
  ignoreWhitespace: boolean;
  direction: { index: number; forward: boolean };
}) {
  const container = useRef<HTMLDivElement>(null),
    ref = useRef<monaco.editor.IStandaloneDiffEditor | null>(null),
    initialRevealPending = useRef(false),
    models = useRef<{
      original: monaco.editor.ITextModel;
      modified: monaco.editor.ITextModel;
    } | null>(null);
  useEffect(() => {
    const editor = monaco.editor.createDiffEditor(container.current!, {
      readOnly: true,
      renderSideBySide: !inline,
      useInlineViewWhenSpaceIsLimited: false,
      ignoreTrimWhitespace: ignoreWhitespace,
      fontSize: 14,
      lineHeight: 24,
      fontFamily: 'Consolas, "Cascadia Code", monospace',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      overviewRulerLanes: 0,
      padding: { top: 18 },
      wordWrap: "off",
      diffWordWrap: "off",
      renderIndicators: true,
      folding: false,
      lineNumbersMinChars: 3,
      glyphMargin: false,
      automaticLayout: false,
    });
    ref.current = editor;
    const diffListener = editor.onDidUpdateDiff(() => {
      if (!initialRevealPending.current || editor.getModel() !== models.current)
        return;
      const changes = editor.getLineChanges();
      if (!changes) return;
      initialRevealPending.current = false;
      if (!changes.length) return;
      const first = changes[0];
      const originalLine = Math.max(1, first.originalStartLineNumber);
      const modifiedLine = Math.max(1, first.modifiedStartLineNumber);
      editor.getOriginalEditor().revealLineInCenter(originalLine);
      const modified = editor.getModifiedEditor();
      modified.setPosition({ lineNumber: modifiedLine, column: 1 });
      modified.revealLineInCenter(modifiedLine);
    });
    const observer = new ResizeObserver(() => editor.layout());
    observer.observe(container.current!);
    return () => {
      observer.disconnect();
      diffListener.dispose();
      editor.setModel(null);
      models.current?.original.dispose();
      models.current?.modified.dispose();
      models.current = null;
      editor.dispose();
      ref.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ref.current) return;
    const previous = models.current;
    const next = {
      original: monaco.editor.createModel(file.before, language(file.path)),
      modified: monaco.editor.createModel(file.after, language(file.path)),
    };
    models.current = next;
    initialRevealPending.current = true;
    ref.current.setModel(next);
    previous?.original.dispose();
    previous?.modified.dispose();
  }, [file.path, file.before, file.after]);
  useEffect(() => {
    monaco.editor.setTheme(dark ? "svnx-dark" : "vs");
  }, [dark]);
  useEffect(() => {
    ref.current?.updateOptions({
      renderSideBySide: !inline,
      ignoreTrimWhitespace: ignoreWhitespace,
    });
  }, [inline, ignoreWhitespace]);
  useEffect(() => {
    if (!direction.index || !ref.current) return;
    const changes = ref.current.getLineChanges();
    if (!changes?.length) return;
    const editor = ref.current.getModifiedEditor(),
      current = editor.getPosition()?.lineNumber ?? 0;
    const line = direction.forward
      ? (changes.find((c) => c.modifiedStartLineNumber > current)
          ?.modifiedStartLineNumber ?? changes[0].modifiedStartLineNumber)
      : ([...changes].reverse().find((c) => c.modifiedStartLineNumber < current)
          ?.modifiedStartLineNumber ?? changes.at(-1)!.modifiedStartLineNumber);
    editor.setPosition({ lineNumber: Math.max(1, line), column: 1 });
    editor.revealLineInCenter(Math.max(1, line));
  }, [direction]);
  return (
    <div
      ref={container}
      style={{ height: "100%", width: "100%" }}
      aria-label="文件差异编辑器"
      data-language={language(file.path)}
    />
  );
}
