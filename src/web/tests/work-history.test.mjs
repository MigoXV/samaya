import test from "node:test";
import assert from "node:assert/strict";
import {
  historyItem,
  isProcessItem,
  groupActivities,
  workSegments,
  activityFor,
  activityHints,
  durationText,
  lastNativeTime,
} from "../src/work-history.ts";
import {
  conversationTimeLabel,
  showConversationTime,
} from "../src/conversation-time.ts";
test("native phase is authoritative; public replies and legacy text stay outside", () => {
  assert.equal(
    isProcessItem({ type: "agentMessage", phase: "commentary" }),
    true,
  );
  for (const phase of ["final_answer", "partial_answer", null, undefined])
    assert.equal(isProcessItem({ type: "agentMessage", phase }), false);
  for (const type of ["plan", "reasoning", "contextCompaction", "userMessage"])
    assert.equal(isProcessItem({ type }), false);
  assert.equal(
    isProcessItem({ type: "commandExecution", source: "userShell" }),
    false,
  );
});
test("history metadata and live confirmations retain native timestamps", () => {
  const item = historyItem(
    {
      item: { id: "a", type: "agentMessage", phase: "final_answer" },
      startedAtMs: 1000,
    },
    {
      id: "a",
      type: "agentMessage",
      phase: "final_answer",
      text: "完整答复",
      samayaTiming: { completedAtMs: 5000 },
    },
  );
  assert.deepEqual(item.samayaTiming, {
    startedAtMs: 1000,
    completedAtMs: 5000,
  });
  assert.equal(item.text, "完整答复");
  assert.equal(lastNativeTime({ completedAt: 6 }, [item]), 6000);
  assert.equal(lastNativeTime({}, []), undefined);
});
test("group only adjacent same activities, and keep user boundaries", () => {
  const figma = (id) => ({
    id,
    type: "mcpToolCall",
    server: "codex_apps",
    tool: "figma/get_metadata",
  });
  const rows = groupActivities([
    figma("f1"),
    figma("f2"),
    { id: "c", type: "agentMessage", phase: "commentary" },
    figma("f3"),
    { id: "s", type: "webSearch" },
  ]);
  assert.deepEqual(
    rows.map((r) => r.items?.length ?? r.id),
    [2, "c", 1, 1],
  );
  assert.equal(rows[0].label, "使用 Figma");
  assert.equal(
    activityFor({
      type: "mcpToolCall",
      server: "unknown",
      tool: "unrecognized",
    }).platform,
    undefined,
  );
  assert.equal(
    activityFor({
      type: "dynamicToolCall",
      namespace: "functions",
      tool: "exec",
      arguments: { code: "figma()" },
    }).platform,
    undefined,
  );
  assert.equal(
    workSegments([
      { id: "u1", type: "userMessage" },
      figma("f"),
      { id: "u2", type: "userMessage" },
      figma("f2"),
    ]).length,
    2,
  );
});
test("query hints use native data and do not invent sources", () => {
  assert.deepEqual(
    activityHints({
      kind: "search",
      items: [
        {
          query: "真实查询",
          results: [
            { url: "https://example.com/a" },
            { url: "javascript:alert(1)" },
            { url: "https://example.com/b" },
          ],
        },
      ],
    }),
    [
      { label: "真实查询" },
      { label: "example.com", href: "https://example.com/b" },
    ],
  );
  assert.deepEqual(activityHints({ kind: "search", items: [{}] }), []);
  assert.equal(durationText(86), "1分26秒");
  assert.equal(durationText(3600), "1小时0分");
});
test("one-hour threshold, local midnight, missing and out-of-order times", () => {
  const at = Date.parse("2026-11-17T12:00:00Z");
  assert.equal(showConversationTime(at, at - 3599999, "Asia/Shanghai"), false);
  assert.equal(showConversationTime(at, at - 3600000, "Asia/Shanghai"), true);
  assert.equal(
    showConversationTime(
      Date.parse("2026-11-17T16:01:00Z"),
      Date.parse("2026-11-17T15:59:00Z"),
      "Asia/Shanghai",
    ),
    true,
  );
  assert.equal(showConversationTime(undefined, at), false);
  assert.equal(showConversationTime(at, undefined), true);
  assert.equal(showConversationTime(at, at + 100), false);
});
test("labels follow the requested timezone, including DST yesterday and year change", () => {
  const now = Date.parse("2026-11-17T13:03:00Z");
  assert.equal(conversationTimeLabel(now, now, "Asia/Shanghai"), "今天 21:03");
  assert.equal(
    conversationTimeLabel(now - 86400000, now, "Asia/Shanghai"),
    "昨天 21:03",
  );
  assert.match(
    conversationTimeLabel(
      Date.parse("2025-12-31T09:00:00Z"),
      now,
      "Asia/Shanghai",
    ),
    /2025年/,
  );
  // DST makes elapsed hours an unreliable way of deciding whether it was yesterday.
  assert.match(
    conversationTimeLabel(
      Date.parse("2026-03-08T06:30:00Z"),
      Date.parse("2026-03-09T04:15:00Z"),
      "America/New_York",
    ),
    /^昨天/,
  );
});

test("late partial answers merge before a final received earlier over SSE", async () => {
  const { mergeHistoryItems } = await import("../src/work-history.ts");
  const old = [
    { id: "older" },
    { id: "user" },
    { id: "progress" },
    { id: "final", samayaTiming: { completedAtMs: 5000 } },
    { id: "live" },
  ];
  const page = [
    { id: "user" },
    { id: "progress" },
    { id: "partial" },
    { id: "final" },
  ];
  const merged = mergeHistoryItems(old, page);
  assert.deepEqual(
    merged.map((i) => i.id),
    ["older", "user", "progress", "partial", "final", "live"],
  );
  assert.equal(
    merged.find((i) => i.id === "final").samayaTiming.completedAtMs,
    5000,
  );
  assert.deepEqual(
    mergeHistoryItems(merged, [{ id: "earliest" }], true).map((i) => i.id),
    ["earliest", ...merged.map((i) => i.id)],
  );
});

test("user time uses item metadata; turn-start fallback requires the original user message", async () => {
  const { userMessageTime } = await import("../src/work-history.ts");
  assert.equal(
    userMessageTime({ samayaTiming: { startedAtMs: 1300 } }, false, false, 1),
    1300,
  );
  assert.equal(
    userMessageTime({ samayaTiming: { completedAtMs: 1400 } }, false, false, 1),
    1400,
  );
  assert.equal(userMessageTime({}, true, true, 1), 1000);
  assert.equal(userMessageTime({}, false, true, 1), undefined);
  assert.equal(userMessageTime({}, true, false, 1), undefined);
  assert.equal(
    lastNativeTime({ completedAt: 2 }, [
      { samayaTiming: { completedAtMs: 5000 } },
    ]),
    2000,
  );
  assert.equal(showConversationTime(1e20, 100), false);
});
