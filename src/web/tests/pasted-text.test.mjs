import test from "node:test";
import assert from "node:assert/strict";
import { pastedTextFile } from "../src/pasted-text.ts";
test("1000 characters stay inline; larger paste becomes an exact UTF-8 file", async () => {
  assert.equal(pastedTextFile("文".repeat(1000)), null);
  assert.equal(pastedTextFile("😀".repeat(1000)), null);
  const source = "😀".repeat(1001) + "\n尾部\r\n";
  const file = pastedTextFile(source);
  assert.equal(file.name, "粘贴内容.txt");
  assert.equal(await file.text(), source);
  assert.equal(file.size, new TextEncoder().encode(source).length);
});
