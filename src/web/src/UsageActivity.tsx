import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  compactTokens,
  dateKey,
  dayLabel,
  exactTokens,
  shortDay,
  weeks,
  type ActivityDay,
} from "./usage-activity";

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
function dayActivity(day: ActivityDay, exact = false) {
  if (day.tokens === null) return "无数据";
  return exact ? exactTokens(day.tokens) : `${compactTokens(day.tokens)} Token`;
}

export function UsageCalendar({ days }: { days: ActivityDay[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const scroller = viewport.current;
    if (scroller)
      scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
  }, []);
  const max = Math.max(1, ...days.map((day) => day.tokens ?? 0));
  const selectedDay = days.find((day) => dateKey(day.date) === selected);
  const cursor = days.some((day) => dateKey(day.date) === focusDate)
    ? focusDate
    : dateKey(days[days.length - 1].date);

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const steps: Record<string, number> = {
      ArrowUp: -1,
      ArrowDown: 1,
      ArrowLeft: -7,
      ArrowRight: 7,
      Home: -index,
      End: days.length - 1 - index,
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(days.length - 1, index + step));
    const calendar = event.currentTarget.closest(".usage-calendar");
    calendar
      ?.querySelector<HTMLButtonElement>(`[data-day-index="${next}"]`)
      ?.focus();
  }

  const offset = days[0].date.getUTCDay();
  return (
    <>
      <div
        className="usage-calendar-shell"
        role="group"
        aria-label="每日 Token 活动"
      >
        <div className="usage-calendar-axis" aria-hidden="true">
          {weekdays.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="usage-calendar-scroll" ref={viewport}>
          <div className="usage-calendar">
            {weeks(days).map((week, column) => {
              const month = week.find((day) => day?.date.getUTCDate() === 1);
              return (
                <div className="usage-week" key={column}>
                  <span className="usage-month" aria-hidden="true">
                    {month ? `${month.date.getUTCMonth() + 1}月` : ""}
                  </span>
                  {week.map((day, row) => {
                    if (!day) return <span key={row} />;
                    const key = dateKey(day.date);
                    const label = `${dayLabel(day.date)}，${dayActivity(day, true)}`;
                    const level =
                      day.tokens === null
                        ? "missing"
                        : Math.ceil((day.tokens / max) * 4);
                    const index = column * 7 + row - offset;
                    return (
                      <button
                        type="button"
                        key={key}
                        className="usage-cell"
                        data-level={level}
                        data-day-index={index}
                        tabIndex={cursor === key ? 0 : -1}
                        aria-label={label}
                        aria-pressed={selected === key}
                        title={label}
                        onFocus={() => setFocusDate(key)}
                        onKeyDown={(event) => navigate(event, index)}
                        onClick={() => setSelected(key)}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="usage-calendar-legend">
        少
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            className="usage-cell"
            data-level={level}
            key={level}
            aria-hidden="true"
          />
        ))}
        多
        <span className="usage-cell" data-level="missing" aria-hidden="true" />
        无数据
      </div>
      <p className="usage-caption" aria-live="polite">
        {selectedDay ? (
          <span title={dayActivity(selectedDay, true)}>
            {dayLabel(selectedDay.date)} · {dayActivity(selectedDay)}
          </span>
        ) : (
          "选择日期查看当日 Token"
        )}
      </p>
    </>
  );
}

export function UsageBarChart({
  days,
  label,
}: {
  days: ActivityDay[];
  label: string;
}) {
  const peak = Math.max(1, ...days.map((day) => day.tokens ?? 0));
  const power = 10 ** Math.floor(Math.log10(peak / 3));
  const step = Math.max(1, Math.ceil(peak / 3 / power) * power);
  const max = step * 3;
  const dates = [days[0], days[Math.floor((days.length - 1) / 2)], days.at(-1)];
  return (
    <figure className="usage-bars">
      <div className="usage-plot" aria-hidden="true">
        <div className="usage-plot-ruler">
          {[max, step * 2, step, 0].map((tick) => (
            <span key={tick}>{compactTokens(tick)}</span>
          ))}
        </div>
        <div className="usage-plot-track">
          <div className="usage-plot-lines">
            {[0, 1, 2, 3].map((line) => (
              <span key={line} />
            ))}
          </div>
          <div className="usage-plot-values">
            {days.map((day) => (
              <span className="usage-bar-slot" key={dateKey(day.date)}>
                <span
                  className="usage-bar"
                  data-value={
                    day.tokens === null
                      ? "missing"
                      : day.tokens === 0
                        ? "zero"
                        : "positive"
                  }
                  style={{ height: `${((day.tokens ?? 0) / max) * 100}%` }}
                  title={`${dayLabel(day.date)}，${dayActivity(day, true)}`}
                />
              </span>
            ))}
          </div>
        </div>
        <div className="usage-plot-dates">
          {dates.map(
            (day, i) => day && <span key={i}>{shortDay(day.date)}</span>,
          )}
        </div>
      </div>
      <figcaption>
        <details className="usage-data-values">
          <summary>{label} · 查看数据</summary>
          <ul>
            {days.map((day) => (
              <li key={dateKey(day.date)}>
                <time dateTime={dateKey(day.date)}>{shortDay(day.date)}</time>
                <span title={dayActivity(day, true)}>{dayActivity(day)}</span>
              </li>
            ))}
          </ul>
        </details>
      </figcaption>
    </figure>
  );
}
