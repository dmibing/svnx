import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution";
import "monaco-editor/esm/vs/basic-languages/css/css.contribution";
import "monaco-editor/esm/vs/basic-languages/html/html.contribution";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { useEffect, useRef } from "react";
import type { Diff } from "./types";
(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
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
      fontSize: 12,
      lineHeight: 23,
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
    const observer = new ResizeObserver(() => editor.layout());
    observer.observe(container.current!);
    return () => {
      observer.disconnect();
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
    ref.current.setModel(next);
    models.current = next;
    previous?.original.dispose();
    previous?.modified.dispose();
  }, [file.path, file.before, file.after]);
  useEffect(() => {
    monaco.editor.setTheme(dark ? "vs-dark" : "vs");
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
    />
  );
}
