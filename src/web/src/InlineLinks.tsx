import { Fragment } from "react";
import { PlatformLink } from "./PlatformLink";
import { bareUrlEnd } from "./link-boundaries";

export function InlineLinks({ text }: { text: string }) {
  // Keep literal code examples intact in user messages.
  const pattern = /```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s<>`]+/gi;
  const parts = [];
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    if (!/^https?:/i.test(value)) continue;
    const end = bareUrlEnd(value);
    if (!end) continue;
    parts.push(
      <Fragment key={match.index}>
        {text.slice(start, match.index)}
        <PlatformLink href={value.slice(0, end)}>
          {value.slice(0, end)}
        </PlatformLink>
      </Fragment>,
    );
    start = match.index + end;
  }
  return (
    <>
      {parts}
      {text.slice(start)}
    </>
  );
}
