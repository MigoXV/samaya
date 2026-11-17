import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ChevronRight,
  FileCode,
  Globe,
  Network,
  Terminal,
  Wrench,
} from "lucide-react";
import { PlatformIcon } from "./PlatformLink";
import { useDisclosure } from "./use-disclosure";
import { preserveMessagePosition } from "./reading-position";
import {
  activityHints,
  durationText,
  groupActivities,
  itemFailed,
  nativeTime,
} from "./work-history";
import type { Activity, WorkState } from "./work-history";
import type { Item, Turn } from "./types";

function ActivityIcon({ activity }: { activity: Activity }) {
  if (activity.platform)
    return (
      <PlatformIcon
        platform={activity.platform === "figma" ? "Figma" : "GitHub"}
      />
    );
  const Icon = {
    search: Globe,
    command: Terminal,
    files: FileCode,
    agents: Network,
    app: Wrench,
    other: Wrench,
  }[activity.kind];
  return <Icon size={16} aria-hidden="true" />;
}
function ActivityGroup({
  activity,
  scope,
  renderItem,
  onInspect,
  aliasScope,
}: {
  activity: Activity;
  scope: string;
  renderItem: (item: Item) => ReactNode;
  onInspect: () => void;
  aliasScope: string;
}) {
  const [open, setOpen] = useDisclosure(
    `${scope}:activity:${activity.items[0].id}`,
    activity.items.map((item) => `samaya.activity.${aliasScope}:${item.id}`),
  );
  const ref = useRef<HTMLDetailsElement>(null);
  const hints = activityHints(activity);
  const failures = activity.items.filter(itemFailed).length;
  const hintList = (expanded: boolean) =>
    !!hints.length && (
      <div className="work-activity-hints">
        {(expanded ? hints : hints.slice(0, 3)).map((hint, i) =>
          hint.href ? (
            <a key={i} href={hint.href} title={hint.href}>
              {hint.label}
            </a>
          ) : (
            <span key={i} title={hint.label}>
              {hint.label}
            </span>
          ),
        )}
        {!expanded && hints.length > 3 && (
          <button
            onClick={() => {
              preserveMessagePosition(ref.current);
              onInspect();
              setOpen(true);
            }}
          >
            另 {hints.length - 3} 项
          </button>
        )}
      </div>
    );
  return (
    <div className="work-activity-row">
      <details
        className="work-activity"
        ref={ref}
        open={open}
        onToggle={(e) => {
          if (e.currentTarget.open !== open) setOpen(e.currentTarget.open);
        }}
      >
        <summary
          onClick={(e) => {
            e.preventDefault();
            preserveMessagePosition(ref.current);
            if (!open) onInspect();
            setOpen(!open);
          }}
        >
          <ActivityIcon activity={activity} />
          <span>{activity.label}</span>
          <span className="work-activity-count">
            {activity.items.length} 次{failures ? ` · ${failures} 项异常` : ""}
          </span>
          <ChevronRight size={14} aria-hidden="true" />
        </summary>
        {open && hintList(true)}
        <div className="work-activity-details">
          {activity.items.map(renderItem)}
        </div>
      </details>
      {!open && hintList(false)}
    </div>
  );
}
function useWorkClock(tid: string, turn: Turn, active: boolean) {
  const [now, setNow] = useState(Date.now);
  const [observed, setObserved] = useState<number | null>(() => {
    try {
      const saved = Number(
        sessionStorage.getItem(`samaya.working.${tid}.${turn.id}`),
      );
      return saved > 0 && saved <= Date.now() ? saved : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (!active) return;
    const update = () => {
      if (document.hidden) return;
      const time = Date.now();
      setNow(time);
      if (observed === null) {
        setObserved(time);
        try {
          sessionStorage.setItem(
            `samaya.working.${tid}.${turn.id}`,
            String(time),
          );
        } catch {
          /* Observation still works in memory. */
        }
      }
    };
    const initial = setTimeout(update, 0);
    const timer = setInterval(update, 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [active, observed, tid, turn.id]);
  const start = nativeTime(turn.startedAt);
  const end = nativeTime(turn.completedAt);
  if (turn.status !== "inProgress") {
    if (start === undefined || end === undefined || end < start)
      return {
        text: "耗时未提供",
        title: "历史未提供完整的本轮开始与结束时间",
      };
    return {
      text: `已用时 ${durationText(end - start)}`,
      title: "本轮持续时间",
    };
  }
  if (start !== undefined)
    return {
      text: `已用时 ${durationText(now / 1000 - start)}`,
      title: "本轮持续时间",
    };
  if (observed !== null)
    return {
      text: `本次观察 ${durationText((now - observed) / 1000)}`,
      title: "本次观察时长",
    };
  return { text: "计时待确认", title: "尚未取得本轮开始时间" };
}
function WorkDuration({
  tid,
  turn,
  active,
}: {
  tid: string;
  turn: Turn;
  active: boolean;
}) {
  const clock = useWorkClock(tid, turn, active);
  return (
    <span className="work-duration" title={clock.title} aria-live="off">
      {clock.text}
    </span>
  );
}
function isActivity(row: Activity | Item): row is Activity {
  return Array.isArray(row.items) && typeof row.kind === "string";
}
export function WorkProcess({
  tid,
  turn,
  scope,
  items,
  renderItem,
  active,
  state,
  hasFinal = false,
}: {
  tid: string;
  turn: Turn;
  scope: string;
  items: Item[];
  renderItem: (item: Item) => ReactNode;
  active: boolean;
  state: WorkState;
  hasFinal?: boolean;
}) {
  const [open, setOpen] = useDisclosure(
    `samaya.work.${scope}`,
    items.map((item) => `samaya.work.${tid}:${turn.id}:item:${item.id}`),
  );
  const ref = useRef<HTMLElement>(null);
  const detailsId = useId();
  const running = active && state === "running" && turn.status === "inProgress";
  const rows = groupActivities(items);
  const tools = items.filter((i) => i.type !== "agentMessage");
  const failures = tools.filter(itemFailed).length;
  const latestComment = [...items]
    .reverse()
    .find((i) => i.type === "agentMessage");
  const activeActivity = [...rows]
    .reverse()
    .find(
      (row) =>
        isActivity(row) && row.items.some((i) => i.status === "inProgress"),
    );
  const latestActivity = activeActivity || [...rows].reverse().find(isActivity);
  const terminal = turn.status !== "inProgress" || !active;
  const stateLabel =
    turn.status === "failed"
      ? "本轮失败"
      : turn.status === "interrupted"
        ? "本轮已中断"
        : terminal
          ? turn.status === "inProgress"
            ? "此前过程"
            : "本轮已结束"
          : state === "waiting"
            ? "等待你的答复"
            : state === "disconnected"
              ? "连接已断开"
              : state === "stale"
                ? "状态待确认"
                : hasFinal
                  ? "正在生成答复"
                  : activeActivity && isActivity(activeActivity)
                    ? activeActivity.label.replace(
                        /^(使用|执行|修改|搜索|调用)/,
                        "正在$1",
                      )
                    : "正在处理";
  const body = (row: Activity | Item) =>
    isActivity(row) ? (
      <ActivityGroup
        key={row.items[0].id}
        activity={row}
        scope={scope}
        renderItem={renderItem}
        onInspect={() => setOpen(true)}
        aliasScope={`${tid}:${turn.id}`}
      />
    ) : (
      renderItem(row)
    );
  return (
    <section
      className="work-process"
      ref={ref}
      data-work-state={terminal ? turn.status : state}
    >
      <div className="work-summary">
        <button
          className="work-disclosure"
          disabled={!items.length}
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => {
            preserveMessagePosition(ref.current);
            setOpen(!open);
          }}
        >
          <span
            className={
              running
                ? "work-state-label is-working"
                : turn.status === "completed" &&
                    nativeTime(turn.startedAt) !== undefined &&
                    nativeTime(turn.completedAt) !== undefined &&
                    turn.completedAt! >= turn.startedAt!
                  ? "work-state-label sr-only"
                  : "work-state-label"
            }
          >
            {stateLabel}
          </span>
          <WorkDuration tid={tid} turn={turn} active={running} />
          {!!tools.length && open && (
            <span className="work-count">{tools.length} 次活动</span>
          )}
          {!!items.length && <ChevronRight size={14} aria-hidden="true" />}
        </button>
        {!!failures && (
          <span className="work-anomaly">{failures} 项工具异常</span>
        )}
        <span className="sr-only" role="status">
          {stateLabel}
        </span>
      </div>
      <div id={detailsId} className="work-process-details" data-expanded={open}>
        {rows.map((row) => {
          const chosen =
            open ||
            (!terminal &&
              !hasFinal &&
              (isActivity(row)
                ? row === latestActivity
                : row.id === latestComment?.id));
          const key = isActivity(row) ? row.items[0].id : row.id;
          return (
            <div key={key} className="work-process-row" hidden={!chosen}>
              {chosen && body(row)}
            </div>
          );
        })}
      </div>
    </section>
  );
}
