import test from "node:test";
import assert from "node:assert/strict";
import { options, validateField } from "../src/mcp-schema.ts";
test("保留零、false、未填写与 Unicode 长度", () => {
  assert.equal(validateField({ type: "integer", minimum: 0 }, 0, true), "");
  assert.equal(validateField({ type: "boolean" }, false, true), "");
  assert.notEqual(validateField({ type: "boolean" }, undefined, true), "");
  assert.equal(validateField({ type: "boolean" }, undefined, false), "");
  assert.equal(validateField({ type: "string", maxLength: 1 }, "😀", true), "");
});
test("表单数字、日期、选择约束", () => {
  for (const [field, value] of [
    [{ type: "integer" }, 0.5],
    [{ type: "number", maximum: 2 }, 3],
    [{ type: "string", format: "email" }, "invalid"],
    [{ type: "string", format: "uri" }, "relative"],
    [{ type: "string", format: "date" }, "2026-02-30"],
    [{ type: "string", format: "date-time" }, "2026-10-03T12:00:00"],
    [{ type: "array", minItems: 1 }, []],
    [{ type: "array", maxItems: 1 }, ["a", "b"]],
    [{ type: "string", enum: ["a"] }, "b"],
  ])
    assert.notEqual(validateField(field, value, true), "");
  assert.equal(
    validateField({ type: "string", format: "uri" }, "urn:example:test", true),
    "",
  );
});
test("兼容标题枚举、旧枚举和多选", () => {
  assert.deepEqual(
    options({ type: "string", enum: ["a"], enumNames: ["甲"] }),
    [{ value: "a", label: "甲" }],
  );
  assert.deepEqual(
    options({ type: "string", oneOf: [{ const: "a", title: "甲" }] }),
    [{ value: "a", label: "甲" }],
  );
  assert.deepEqual(
    options({ type: "array", items: { anyOf: [{ const: "a", title: "甲" }] } }),
    [{ value: "a", label: "甲" }],
  );
  assert.notEqual(
    validateField({ type: "array", items: { enum: ["a"] } }, ["b"], true),
    "",
  );
});
