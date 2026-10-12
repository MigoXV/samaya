import { useMemo } from "react";
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMathDelimiters, remarkDisplayMath } from "./math-delimiters";
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
const components = { pre: MarkdownPre, table: MarkdownTable };
const remarkPlugins = [remarkGfm, remarkMath, remarkDisplayMath];
const rehypePlugins = [rehypeKatex];

export function MarkdownContent({ text }: { text: string }) {
  const content = useMemo(() => normalizeMathDelimiters(text), [text]);
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {content}
      </Markdown>
    </div>
  );
}
