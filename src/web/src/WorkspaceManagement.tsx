import { useCallback, useEffect, useRef, useState } from "react";
import { api, operation } from "./api";
import { execution, threadTitle, type Observation } from "./monitor";
import { shortProject } from "./project-navigation";
import type { Preview, Thread } from "./types";
import "./workspace-management.css";

type Action = "archive" | "unarchive" | "delete";
type Scope = { id: string; name: string; value?: Preview; error?: string };
type Outcome = { id: string; name: string; error?: string };
function Icon({
  name,
}: {
  name: "left" | "search" | "down" | "plus" | "check" | "trash" | "archive";
}) {
  return <span className={`wm-icon wm-icon-${name}`} aria-hidden="true" />;
}
function Check({
  label,
  checked,
  mixed = false,
  disabled,
  change,
}: {
  label: string;
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  change: (value: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <span className="wm-check">
      <input
        ref={input}
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => change(e.target.checked)}
      />
      <span>{checked ? <Icon name="check" /> : mixed ? "−" : null}</span>
    </span>
  );
}
export function WorkspaceManagement({
  cwd,
  connected,
  records,
  open,
  back,
  create,
}: {
  cwd: string;
  connected: boolean;
  records: Map<string, Observation>;
  open: (id: string) => void;
  back: () => void;
  create: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const [rows, setRows] = useState<Thread[]>([]);
  const [archived, setArchived] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [ascending, setAscending] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<Scope[] | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcomes, setOutcomes] = useState<{
    action: Action;
    items: Outcome[];
  } | null>(null);
  const [details, setDetails] = useState(false);
  const request = useRef(0),
    preparation = useRef(0),
    executing = useRef(false);
  const load = useCallback(
    async (more?: string) => {
      const version = ++request.current;
      try {
        const result = await api<{ data: Thread[]; nextCursor: string | null }>(
          `/threads?archived=${archived}&cwd=${encodeURIComponent(cwd)}${more ? "&cursor=" + encodeURIComponent(more) : ""}`,
        );
        if (version !== request.current) return;
        const incoming = result.data.filter(
          (t) => t.cwd === cwd && !t.parentThreadId,
        );
        setRows((old) =>
          more
            ? [...new Map([...old, ...incoming].map((t) => [t.id, t])).values()]
            : incoming,
        );
        setCursor(result.nextCursor);
        setLoaded(true);
        setError("");
      } catch (e) {
        if (version === request.current) {
          setError(String(e));
          setLoaded(true);
        }
      }
    },
    [cwd, archived],
  );
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  function status(t: Thread) {
    if (archived) return "已归档";
    const record = records.get(t.id);
    if (!connected) return "状态待确认";
    if (t.status.type === "active") return "运行中";
    if (
      record &&
      !record.error &&
      record.confirmedAt &&
      now - record.confirmedAt * 1000 <= 45000
    ) {
      const value = execution(record);
      return value === "执行中"
        ? "运行中"
        : value.startsWith("未映射状态")
          ? "状态待确认"
          : value;
    }
    return (
      (
        {
          idle: "空闲",
          notLoaded: "未运行",
          systemError: "会话异常",
        } as Record<string, string>
      )[t.status.type] || "状态待确认"
    );
  }
  const visible = rows
    .filter(
      (t) =>
        threadTitle(t).toLowerCase().includes(query.toLowerCase()) &&
        (filter === "all" ||
          (filter === "running"
            ? status(t) === "运行中"
            : filter === "issues"
              ? /异常|失败|待确认|不可用/.test(status(t))
              : status(t) !== "运行中")),
    )
    .sort(
      (a, b) =>
        (ascending ? 1 : -1) * (a.updatedAt - b.updatedAt) ||
        a.id.localeCompare(b.id),
    );
  const all = !!visible.length && visible.every((t) => selected.includes(t.id));
  const locked = busy || preparing || !!confirm;
  const failed = outcomes?.items.filter((i) => i.error) || [];
  const extra = new Map(
    confirm
      ?.flatMap((p) => p.value?.scope || [])
      .filter((t) => !selected.includes(t.id))
      .map((t) => [t.id, t]),
  );
  const crossWorkspace = [...extra.values()].some((t) => t.cwd !== cwd);
  function cancel() {
    preparation.current++;
    setPreparing(false);
    setConfirm(null);
    setDetails(false);
  }
  async function execute(action: Action, scopes: Scope[]) {
    if (executing.current) return;
    executing.current = true;
    setBusy(true);
    setOutcomes(null);
    setDetails(false);
    const results: Outcome[] = [];
    const removed = new Set<string>();
    try {
      for (const scope of scopes) {
        if (!scope.value || scope.error) {
          results.push({
            id: scope.id,
            name: scope.name,
            error: scope.error || "影响范围未确认",
          });
          continue;
        }
        try {
          const receipt = await operation(action, {
            threadId: scope.id,
            digest: scope.value.digest,
          });
          const items = receipt.result?.items as
            { id: string; state: string }[] | undefined;
          if (
            !items ||
            items.some((i) => i.id === scope.id && i.state === "succeeded")
          )
            removed.add(scope.id);
          const unsuccessful = items?.filter((i) => i.state !== "succeeded");
          results.push({
            id: scope.id,
            name: scope.name,
            error: unsuccessful?.length
              ? `部分处理失败：${unsuccessful.map((i) => scope.value?.scope.find((t) => t.id === i.id)?.name || i.id).join("、")}`
              : undefined,
          });
        } catch (e) {
          results.push({ id: scope.id, name: scope.name, error: String(e) });
        }
      }
      setRows((old) => old.filter((t) => !removed.has(t.id)));
      setOutcomes({ action, items: results });
      setSelected([]);
      setConfirm(null);
      await load();
    } finally {
      executing.current = false;
      setBusy(false);
    }
  }
  async function prepare(action: Action) {
    if (preparing || busy || confirm || !selected.length) return;
    const version = ++preparation.current;
    const targets = selected.map((id) => ({
      id,
      name: threadTitle(rows.find((t) => t.id === id)!),
    }));
    setPreparing(true);
    setOutcomes(null);
    setDetails(false);
    if (action === "delete") setConfirm([]);
    const scopes: Scope[] = [];
    for (let offset = 0; offset < targets.length; offset += 4) {
      const batch = await Promise.all(
        targets.slice(offset, offset + 4).map(async (target) => {
          try {
            return {
              ...target,
              value: await api<Preview>(
                `/threads/${encodeURIComponent(target.id)}/cleanup-preview`,
              ),
            };
          } catch (e) {
            return { ...target, error: String(e) };
          }
        }),
      );
      if (version !== preparation.current) return;
      scopes.push(...batch);
    }
    setPreparing(false);
    if (action === "delete") setConfirm(scopes);
    else await execute(action, scopes);
  }
  function resetSelection() {
    setSelected([]);
    setOutcomes(null);
    setDetails(false);
  }
  const actionLabel = (a: Action) =>
    a === "archive" ? "归档" : a === "delete" ? "删除" : "恢复";
  return (
    <section
      className="workspace-manager"
      aria-label={`${shortProject(cwd)} 工作区管理`}
    >
      <header className="wm-heading">
        <h1>工作区管理</h1>
        <button className="wm-back" onClick={back}>
          <Icon name="left" />
          <span className="wm-wide">返回任务总览</span>
          <span className="wm-narrow">返回</span>
        </button>
      </header>
      <div className="wm-identity">
        <h2>{shortProject(cwd)}</h2>
        <p className="workspace-management-path" title={cwd}>
          {cwd}
        </p>
      </div>
      <div className="wm-scope">
        <label className="wm-search">
          <Icon name="search" />
          <input
            aria-label="搜索对话"
            placeholder="搜索对话"
            value={query}
            disabled={locked}
            onChange={(e) => {
              setQuery(e.target.value);
              resetSelection();
            }}
          />
        </label>
        <label className="wm-select">
          <select
            aria-label="对话范围"
            disabled={locked}
            value={archived ? "archived" : "current"}
            onChange={(e) => {
              setArchived(e.target.value === "archived");
              setRows([]);
              setLoaded(false);
              setCursor(null);
              resetSelection();
            }}
          >
            <option value="current">全部对话</option>
            <option value="archived">已归档</option>
          </select>
          <Icon name="down" />
        </label>
        <label className="wm-select">
          <select
            aria-label="对话状态"
            disabled={locked}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              resetSelection();
            }}
          >
            <option value="all">全部状态</option>
            <option value="running">运行中</option>
            <option value="idle">未运行</option>
            <option value="issues">异常与待确认</option>
          </select>
          <Icon name="down" />
        </label>
        <button
          className="primary wm-create"
          disabled={!connected || busy || preparing}
          onClick={create}
        >
          <Icon name="plus" />
          <span className="wm-wide">新建对话</span>
          <span className="wm-narrow">新建</span>
        </button>
      </div>
      <div className="wm-batch" aria-label="批量操作">
        <Check
          label="全选当前列表"
          checked={all}
          mixed={!all && selected.length > 0}
          disabled={locked || !visible.length}
          change={(checked) => {
            setSelected(checked ? visible.map((t) => t.id) : []);
            setOutcomes(null);
          }}
        />
        <span className="wm-selection">
          {selected.length ? (
            <>
              已选 {selected.length} 个<span className="wm-wide">对话</span>
            </>
          ) : (
            "全选当前列表"
          )}
        </span>
        <div className="wm-batch-actions">
          {confirm ? (
            <>
              <button
                className="wm-danger"
                disabled={
                  !connected ||
                  busy ||
                  preparing ||
                  !confirm.some((p) => p.value)
                }
                onClick={() => void execute("delete", confirm)}
              >
                <Icon name="trash" />
                确定删除 {selected.length} 个
              </button>
              <button disabled={busy} onClick={cancel}>
                取消
              </button>
            </>
          ) : selected.length ? (
            <>
              <button
                disabled={!connected || busy || preparing}
                onClick={() => void prepare(archived ? "unarchive" : "archive")}
              >
                <Icon name="archive" />
                {archived ? "恢复归档" : "归档"}
              </button>
              <button
                disabled={!connected || busy || preparing}
                onClick={() => void prepare("delete")}
              >
                <Icon name="trash" />
                删除
              </button>
              <button disabled={busy || preparing} onClick={resetSelection}>
                <span className="wm-wide">取消选择</span>
                <span className="wm-narrow">取消</span>
              </button>
            </>
          ) : (
            <>
              <span className="wm-count">
                {rows.length} 个对话{cursor ? "（已加载）" : ""}
              </span>
              <label className="wm-select wm-sort">
                <select
                  aria-label="排序"
                  value={ascending ? "old" : "recent"}
                  onChange={(e) => setAscending(e.target.value === "old")}
                >
                  <option value="recent">最近活动</option>
                  <option value="old">最早活动</option>
                </select>
                <Icon name="down" />
              </label>
            </>
          )}
        </div>
      </div>
      <div
        className="wm-feedback"
        role={error ? "alert" : "status"}
        aria-live="polite"
      >
        <span>
          {outcomes
            ? `已${actionLabel(outcomes.action)} ${outcomes.items.length - failed.length} 个对话${failed.length ? ` · ${failed.length} 个未处理` : ""}${error ? " · 列表同步失败" : ""}`
            : error ||
              (confirm
                ? `永久删除，无法恢复${extra.size ? `；包含 ${extra.size} 个子对话${crossWorkspace ? "（含其它目录）" : ""}` : ""}。${confirm.some((p) => p.error) ? "部分范围核对失败。" : ""}`
                : archived
                  ? "归档保留历史，可以随时恢复。"
                  : "已按" + (ascending ? "最早" : "最近") + "活动排序")}
        </span>
        {(confirm && (extra.size || confirm.some((p) => p.error))) ||
        failed.length ? (
          <button
            className="wm-text-button"
            aria-expanded={details}
            onClick={() => setDetails(!details)}
          >
            {details ? "收起" : confirm ? "查看范围" : "查看原因"}
          </button>
        ) : null}
        {error && (
          <button className="wm-text-button" onClick={() => void load()}>
            重新读取
          </button>
        )}
      </div>
      {(details || crossWorkspace) && (
        <div className="wm-details">
          {confirm
            ? confirm.map((p) => (
                <div key={p.id}>
                  <strong>{p.name}</strong>
                  {p.error ? (
                    <p role="alert">{p.error}</p>
                  ) : (
                    p.value?.scope.map((t) => (
                      <p key={t.id}>
                        {t.name} <small>{t.cwd}</small>
                      </p>
                    ))
                  )}
                </div>
              ))
            : failed.map((r) => (
                <p key={r.id}>
                  {r.name}：{r.error}
                </p>
              ))}
        </div>
      )}
      <div className="wm-list" role="list" aria-label="工作区对话">
        {visible.map((t) => {
          const chosen = selected.includes(t.id),
            failure = failed.find((r) => r.id === t.id);
          return (
            <div
              role="listitem"
              className={`wm-conversation ${chosen ? "is-selected" : ""}`}
              key={t.id}
              data-workspace-thread={t.id}
            >
              <Check
                label={`选择 ${threadTitle(t)}`}
                checked={chosen}
                disabled={locked}
                change={(checked) => {
                  setSelected((old) =>
                    checked ? [...old, t.id] : old.filter((id) => id !== t.id),
                  );
                  setOutcomes(null);
                }}
              />
              <button
                className="wm-conversation-body"
                title={threadTitle(t)}
                onClick={() => open(t.id)}
              >
                <span className="wm-conversation-title">{threadTitle(t)}</span>
                <span className="wm-conversation-meta">
                  {failure
                    ? `${status(t)} · ${failure.error}`
                    : `${status(t)} · ${new Date(t.updatedAt * 1000).toLocaleDateString("zh-CN", { month: "long", day: "numeric" })}`}
                </span>
              </button>
              <button className="wm-enter" onClick={() => open(t.id)}>
                进入对话
              </button>
            </div>
          );
        })}
        {loaded && !visible.length && (
          <p className="wm-empty">
            {error
              ? "暂时无法读取对话"
              : query || filter !== "all"
                ? "没有符合条件的对话"
                : archived
                  ? "暂无已归档对话"
                  : "此工作区暂无对话"}
          </p>
        )}
      </div>
      <footer className="wm-footer">
        <span>
          已显示 {visible.length} / {rows.length} 个对话
          {cursor ? "（已加载）" : ""}
        </span>
        {cursor && (
          <button disabled={locked} onClick={() => void load(cursor)}>
            加载更多
          </button>
        )}
      </footer>
    </section>
  );
}
