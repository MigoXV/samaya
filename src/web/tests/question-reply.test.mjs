import test from "node:test";
import assert from "node:assert/strict";
import { userMessageParts } from "../src/question-reply.ts";

const reply = {
  question: "请重新连接 Figma。",
  answer: "go on",
  questionItemId: '["request_user_input_async","call_1",0]',
};
const envelope = (value) =>
  `<send_user_message_question_reply>\n${JSON.stringify(value)}\n</send_user_message_question_reply>`;
test("解码实际提问回复，保留前后补充、多个问题和多个回复块", () => {
  assert.deepEqual(userMessageParts(envelope([reply])), [
    { type: "replies", replies: [reply] },
  ]);
  const parts = userMessageParts(
    `补充要求\n${envelope([reply, { question: "日期？", answer: "今天" }])}\n继续同步代码\n${envelope([reply])}\n结束要求`,
  );
  assert.deepEqual(
    parts.map((part) => part.type),
    ["text", "replies", "text", "replies", "text"],
  );
  assert.equal(parts[0].text, "补充要求\n");
  assert.equal(parts[2].text, "\n继续同步代码\n");
  assert.equal(parts[4].text, "\n结束要求");
});
test("坏 JSON、未知结构、不完整标签和代码示例原样保留", () => {
  for (const value of [
    "<send_user_message_question_reply>bad JSON</send_user_message_question_reply>",
    envelope([]),
    envelope([{ question: "问题", answer: {} }]),
    envelope([reply]).replace("</send_user_message_question_reply>", ""),
    `\`\`\`xml\n${envelope([reply])}\n\`\`\``,
    `~~~xml\n${envelope([reply])}\n~~~`,
  ])
    assert.deepEqual(userMessageParts(value), [{ type: "text", text: value }]);
  assert.equal(
    userMessageParts(
      `\`\`\`xml\n${envelope([reply])}\n\`\`\`\n${envelope([reply])}`,
    ).at(-1).type,
    "replies",
  );
});
