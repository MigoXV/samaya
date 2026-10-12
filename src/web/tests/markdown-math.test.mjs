import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  normalizeMathDelimiters,
  remarkDisplayMath,
} from "../src/math-delimiters.ts";

function render(text) {
  return renderToStaticMarkup(
    createElement(Markdown, {
      remarkPlugins: [remarkGfm, remarkMath, remarkDisplayMath],
      rehypePlugins: [rehypeKatex],
      children: normalizeMathDelimiters(text),
    }),
  );
}
const formulas = [
  String.raw`\mathcal F^{\mu\nu}=F^{\mu\nu}+i\widetilde F^{\mu\nu}.`,
  String.raw`\boxed{\partial_\mu\mathcal F^{\mu\nu}=J^\nu}.`,
  String.raw`\operatorname{Re}:\quad\partial_\mu F^{\mu\nu}=J^\nu,\qquad\operatorname{Im}:\quad\partial_\mu\widetilde F^{\mu\nu}=0.`,
];
test("三条实际公式支持单行、多行美元块和 LaTeX 方括号", () => {
  for (const formula of formulas) {
    for (const text of [
      `$$${formula}$$`,
      `$$\n${formula}\n$$`,
      `\\[${formula}\\]`,
      `\\[\n${formula}\n\\]`,
    ]) {
      const html = render(text);
      assert.match(html, /class="katex-display"/);
      assert.match(html, /<math/);
      assert.doesNotMatch(html, /katex-error/);
    }
  }
});
test("行内公式、正文与多个块公式可以混排", () => {
  const html = render(String.raw`正文 $x^2$ 与 \(y_1\)，然后 $$z=1$$ 继续。`);
  assert.equal((html.match(/class="katex"/g) || []).length, 3);
  assert.equal((html.match(/class="katex-display"/g) || []).length, 1);
  assert.match(html, /继续。/);
});
test("代码、链接、转义分隔符和普通方括号不转换", () => {
  for (const source of [
    "`" + String.raw`\[x\] $$y$$` + "`",
    "```latex\n\\[x\\]\n$$y$$\n```",
    "~~~\n$$x$$\n~~~",
    "    $$x$$\n    \\[y\\]",
    String.raw`[链接](https://example.com/\(x\))`,
    String.raw`\\[x\\] 与 \$\$y\$\$`,
    String.raw`[ \boxed{x} ]`,
  ]) {
    assert.equal(normalizeMathDelimiters(source), source);
    assert.doesNotMatch(render(source), /class="katex/);
  }
});
test("不完整流式块保持文字，补全后渲染，坏公式不影响后文", () => {
  const partial = String.raw`开始：$$\frac{1}{2}`;
  assert.doesNotMatch(render(partial), /class="katex/);
  assert.match(render(partial), /\$\$/);
  assert.match(render(partial + "$$"), /class="katex-display"/);
  assert.doesNotMatch(render(String.raw`开始：\[x`), /class="katex/);
  const html = render(String.raw`$$\frac{1}$$` + "\n\n后续正文。");
  assert.match(html, /katex-error/);
  assert.match(html, /后续正文。/);
});
test("GFM 表格、列表、链接和代码块保持正常", () => {
  const html = render(
    "| 名称 | 内容 |\n| --- | --- |\n| 能量 | $E=mc^2$ |\n\n- 项目\n\n[链接](https://example.com)\n\n```js\nconst x = 1;\n```",
  );
  assert.match(html, /<table>/);
  assert.match(html, /<ul>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /<pre><code class="language-js">/);
  assert.match(html, /class="katex"/);
});
test("块公式不拆散列表和引用结构", () => {
  for (const equation of ["$$x=1$$", String.raw`\[x=1\]`]) {
    const html = render(
      `- 公式 ${equation} 后文\n- 第二项\n\n> 引用 ${equation}`,
    );
    assert.equal((html.match(/<li>/g) || []).length, 2);
    assert.match(html, /<li>公式 .*katex-display.*后文<\/li>/s);
    assert.match(html, /<blockquote>.*katex-display.*<\/blockquote>/s);
  }
  const html = render("- 公式\n\n  $$\n  x=1\n  $$\n\n  后文\n- 第二项");
  assert.equal((html.match(/<li>/g) || []).length, 2);
  assert.match(html, /<li>.*katex-display.*后文.*<\/li>/s);
});
