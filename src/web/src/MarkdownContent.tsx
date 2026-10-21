import { useMemo } from "react";
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMathDelimiters, remarkDisplayMath } from "./math-delimiters";
import { FileLink } from "./FileLink";
import { FileLinkThread, markdownUrlTransform } from "./file-links";
import "katex/dist/katex.min.css";

function MarkdownPre({ children }: { children?: ReactNode }) {
  return (
    <pre tabIndex={0} aria-label="代码">
      {children}
    </pre>
  );
}
function MarkdownTable({ children }: { children?: ReactNode }) {
  return <table tabIndex={0}>{children}</table>;
}
const components = { pre: MarkdownPre, table: MarkdownTable, a: FileLink };
const remarkPlugins = [remarkGfm, remarkMath, remarkDisplayMath];
const rehypePlugins = [rehypeKatex];

export function MarkdownContent({
  text,
  threadId,
}: {
  text: string;
  threadId?: string;
}) {
  const content = useMemo(() => normalizeMathDelimiters(text), [text]);
  return (
    <div className="markdown">
      <FileLinkThread.Provider value={threadId}>
        <Markdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={components}
          urlTransform={markdownUrlTransform}
        >
          {content}
        </Markdown>
      </FileLinkThread.Provider>
    </div>
  );
}
