import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { useEffect, useRef } from "react";
import type { Diff } from "./types";
import { editorLanguage } from "./editor-language";
import "./editor-language-support";
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
      fontFamily: 'Consolas, "Cascadia Code", "Microsoft YaHei UI", monospace',
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
      original: monaco.editor.createModel(
        file.before,
        editorLanguage(file.path, file.after || file.before),
      ),
      modified: monaco.editor.createModel(
        file.after,
        editorLanguage(file.path, file.after || file.before),
      ),
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
      data-language={editorLanguage(file.path, file.after || file.before)}
    />
  );
}
