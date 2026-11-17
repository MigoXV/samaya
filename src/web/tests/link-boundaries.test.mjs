import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkLinkBoundaries, bareUrlEnd } from "../src/link-boundaries.ts";
const render = (text) =>
  renderToStaticMarkup(
    createElement(Markdown, {
      remarkPlugins: [remarkGfm, remarkLinkBoundaries],
      children: text,
    }),
  );
test("bare URLs stop before Chinese prose and markdown stars", () => {
  for (const tail of ["这是型号Qwen3", "**型号Qwen3", "。后续正文", "，完成"]) {
    const html = render("https://example.com/page" + tail);
    assert.ok(html.includes('href="https://example.com/page"'), html);
    assert.ok(html.includes(tail), html);
  }
});
test("explicit Unicode paths, query and hash and code remain intact", () => {
  assert.ok(
    render("[报告](https://example.com/报告?model=Qwen3&v=2#result)").includes(
      'href="https://example.com/%E6%8A%A5%E5%91%8A?model=Qwen3&amp;v=2#result"',
    ),
  );
  assert.ok(
    render("`https://example.com/page型号`").includes(
      "<code>https://example.com/page型号</code>",
    ),
  );
  assert.equal(
    bareUrlEnd("https://example.com/a_(b)"),
    "https://example.com/a_(b)".length,
  );
  assert.equal(
    "https://example.com/a_(b))".slice(
      0,
      bareUrlEnd("https://example.com/a_(b))"),
    ),
    "https://example.com/a_(b)",
  );
  assert.ok(
    render("![图片](/workspace/图片.png)").includes(
      'src="/workspace/%E5%9B%BE%E7%89%87.png"',
    ),
  );
});

test("composer recognizes the exact Figma URL and keeps all parameters", async () => {
  const { platformLinks } = await import("../src/link-boundaries.ts");
  const url =
    "https://www.figma.com/design/ipSZImft4DhXLzvSNAB4Cg/mina---top-bar?node-id=2966-311&p=f&t=MzQ8uiH6H2nNbu9o-0";
  assert.deepEqual(platformLinks(url + "\n好像并没有"), [url]);
  assert.deepEqual(platformLinks(url + "\n" + url), [url]);
  assert.deepEqual(
    platformLinks("https://figma.com.evil.example/design/a"),
    [],
  );
  assert.deepEqual(platformLinks("`" + url + "`"), []);
  assert.deepEqual(platformLinks("没有链接"), []);
});
