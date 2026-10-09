export type QuestionReply = {
  question: string;
  answer: string;
  questionItemId?: string;
};
export type UserMessagePart =
  | { type: "text"; text: string }
  | { type: "replies"; replies: QuestionReply[] };

// Decode only complete, valid reply envelopes; keep malformed data and code examples verbatim.
export function userMessageParts(text: string): UserMessagePart[] {
  const parts: UserMessagePart[] = [];
  const pattern =
    /^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>[ \t]*(?=\r?$|\n)/gm;
  const fences = /^ {0,3}(`{3,}|~{3,})[^\n]*$/gm;
  let fence: string | null = null;
  let fenceMatch = fences.exec(text);
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    while (fenceMatch && fenceMatch.index < match.index) {
      const marker = fenceMatch[1];
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = null;
      fenceMatch = fences.exec(text);
    }
    if (fence) continue;
    let replies: unknown;
    try {
      replies = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (
      !Array.isArray(replies) ||
      !replies.length ||
      !replies.every(
        (reply) =>
          reply &&
          typeof reply === "object" &&
          typeof reply.question === "string" &&
          typeof reply.answer === "string" &&
          (reply.questionItemId === undefined ||
            typeof reply.questionItemId === "string"),
      )
    )
      continue;
    if (match.index > cursor)
      parts.push({ type: "text", text: text.slice(cursor, match.index) });
    parts.push({ type: "replies", replies });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length)
    parts.push({ type: "text", text: text.slice(cursor) });
  return parts.filter((part) => part.type !== "text" || part.text.trim());
}
