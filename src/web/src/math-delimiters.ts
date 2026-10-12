import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse);
type SourceNode = {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: SourceNode[];
  data?: { hProperties?: { className?: string[] } };
};

// Parse Markdown first so examples, URLs and literal HTML keep their source.
export function normalizeMathDelimiters(source: string): string {
  if (
    !source.includes("$$") &&
    !source.includes("\\[") &&
    !source.includes("\\(")
  )
    return source;
  const protectedRanges: [number, number][] = [];
  function collect(node: SourceNode) {
    if (
      ["code", "inlineCode", "html", "link", "image", "definition"].includes(
        node.type,
      )
    ) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined)
        protectedRanges.push([start, end]);
    } else node.children?.forEach(collect);
  }
  collect(parser.parse(source));
  const protectedEnd = (offset: number) =>
    protectedRanges.find(
      ([start, end]) => start <= offset && offset < end,
    )?.[1];
  function escaped(offset: number) {
    let slashes = 0;
    while (offset > 0 && source[--offset] === "\\") slashes++;
    return slashes % 2 === 1;
  }
  function closing(delimiter: string, from: number) {
    let offset = source.indexOf(delimiter, from);
    while (offset !== -1) {
      if (!escaped(offset) && protectedEnd(offset) === undefined) return offset;
      offset = source.indexOf(delimiter, offset + delimiter.length);
    }
    return -1;
  }

  let output = "";
  let cursor = 0;
  for (let i = 0; i < source.length;) {
    const end = protectedEnd(i);
    if (end !== undefined) {
      i = end;
      continue;
    }
    if (escaped(i)) {
      i++;
      continue;
    }
    const opening = source.slice(i, i + 2);
    const display = opening === "\\[" || opening === "$$";
    const inline = opening === "\\(";
    if (display || inline) {
      const close = opening === "\\[" ? "\\]" : inline ? "\\)" : "$$";
      const last = closing(close, i + 2);
      if (last !== -1) {
        const content = source.slice(i + 2, last);
        output += source.slice(cursor, i);
        // Keep native dollar blocks intact, including list/quote indentation.
        // Bracket math uses text math syntax; the plugin below sets display mode.
        output +=
          opening === "$$"
            ? source.slice(i, last + 2)
            : display
              ? `$$${content.trim().replace(/\r?\n/g, " ")}$$`
              : `$${content}$`;
        i = last + 2;
        cursor = i;
        continue;
      }
      // remark-math accepts an unclosed $$ fence. Keep partial streams literal.
      if (opening === "$$") {
        output += source.slice(cursor, i) + "\\$\\$";
        cursor = i + 2;
      }
      i += 2;
      continue;
    }
    if (source[i] === "$") {
      // Leave existing inline math alone, including any delimiters inside it.
      const last = closing("$", i + 1);
      if (last !== -1 && !source.slice(i + 1, last).includes("\n")) {
        i = last + 1;
        continue;
      }
    }
    i++;
  }
  return output + source.slice(cursor);
}

// remark-math treats same-line $$ as inline math. Preserve the surrounding
// Markdown structure while rendering these nodes as display equations.
export function remarkDisplayMath() {
  return (tree: SourceNode, file: { value: unknown }) => {
    const source = String(file.value);
    function visit(node: SourceNode) {
      const offset = node.position?.start.offset;
      if (
        node.type === "inlineMath" &&
        offset !== undefined &&
        source.slice(offset, offset + 2) === "$$"
      ) {
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            className: ["language-math", "math-display"],
          },
        };
      }
      node.children?.forEach(visit);
    }
    visit(tree);
  };
}
