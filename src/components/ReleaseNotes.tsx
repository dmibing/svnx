import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

export default function ReleaseNotes({ notes }: { notes: string }) {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(
        marked.parse(notes, { async: false, gfm: true, breaks: true }),
        {
          // Release feeds may contain either Markdown or HTML. Only display content;
          // never load remote media or accept navigation, events, styles or embeds.
          ALLOWED_TAGS: [
            "p",
            "br",
            "ul",
            "ol",
            "li",
            "strong",
            "b",
            "em",
            "i",
            "del",
            "s",
            "code",
            "pre",
            "blockquote",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "hr",
            "table",
            "thead",
            "tbody",
            "tr",
            "th",
            "td",
          ],
          ALLOWED_ATTR: [],
          ALLOW_DATA_ATTR: false,
          ALLOW_ARIA_ATTR: false,
        },
      ),
    [notes],
  );
  return (
    <div
      className="software-update-notes"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
