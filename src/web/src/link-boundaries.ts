// Bare URLs have no explicit boundary. Treat adjacent prose/Markdown as text;
// explicit [labels](destinations) and <autolinks> retain their authored URL.
export function bareUrlEnd(value: string): number {
  const boundary = value.search(
    /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]|\*\*/u,
  );
  let end = boundary < 0 ? value.length : boundary;
  while (end && /[.,;:!?*]/.test(value[end - 1])) end--;
  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ]) {
    while (
      value[end - 1] === close &&
      value.slice(0, end).split(close).length >
        value.slice(0, end).split(open).length
    )
      end--;
  }
  return end;
}

export function platformName(href: string): "Figma" | "GitHub" | undefined {
  try {
    const url = new URL(href);
    if (!["http:", "https:"].includes(url.protocol)) return;
    if (["figma.com", "www.figma.com"].includes(url.hostname)) return "Figma";
    if (["github.com", "www.github.com"].includes(url.hostname))
      return "GitHub";
  } catch {
    /* Incomplete URLs remain editable plain text. */
  }
}

export function platformLinks(text: string) {
  const urls = new Set<string>();
  for (const match of text.matchAll(
    /```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s<>`]+/gi,
  )) {
    const href = match[0].slice(0, bareUrlEnd(match[0]));
    if (platformName(href)) urls.add(href);
  }
  return [...urls];
}
type Node = {
  type: string;
  url?: string;
  value?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};
export function remarkLinkBoundaries() {
  return (tree: Node, file: { value: unknown }) => {
    const source = String(file.value);
    function visit(parent: Node) {
      if (!parent.children) return;
      parent.children = parent.children.flatMap((node): Node[] => {
        if (
          node.type === "link" &&
          node.url &&
          /^https?:\/\//i.test(node.url)
        ) {
          const raw = source.slice(
            node.position?.start.offset,
            node.position?.end.offset,
          );
          if (
            raw === node.url &&
            node.children?.length === 1 &&
            node.children[0].type === "text"
          ) {
            const end = bareUrlEnd(node.url);
            if (end < node.url.length) {
              const tail = node.url.slice(end);
              node.url = node.url.slice(0, end);
              node.children[0].value = node.url;
              return end
                ? [node, { type: "text", value: tail }]
                : [{ type: "text", value: raw }];
            }
          }
        }
        if (node.type !== "link") visit(node);
        return [node];
      });
    }
    visit(tree);
  };
}
