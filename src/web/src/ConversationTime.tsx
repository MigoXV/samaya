import { memo, useEffect, useState } from "react";
import {
  conversationTimeLabel,
  showConversationTime,
} from "./conversation-time";

export const ConversationTime = memo(function ConversationTime({
  at,
  previous,
}: {
  at?: number;
  previous?: number;
}) {
  const [now, setNow] = useState(Date.now);
  const shown = at !== undefined && showConversationTime(at, previous);
  useEffect(() => {
    if (!shown) return;
    const refresh = () => {
      if (!document.hidden) setNow(Date.now());
    };
    const timer = setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [shown]);
  if (at === undefined || !shown) return null;
  return (
    <div className="conversation-time">
      <time
        dateTime={new Date(at).toISOString()}
        title={new Intl.DateTimeFormat("zh-CN", {
          dateStyle: "full",
          timeStyle: "long",
        }).format(at)}
      >
        {conversationTimeLabel(at, now)}
      </time>
    </div>
  );
});
