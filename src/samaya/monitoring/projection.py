"""Synchronous native-event projection; no connection, polling or persistence."""

import copy
import time
from collections import OrderedDict, deque


class Projection:
    def __init__(self):
        self.records: dict[str, dict] = {}
        self.dirty: set[str] = set()
        self.removed: set[str] = set()
        # Confirmed deletions must outlive flushes and stale in-flight reads.
        self.deleted: set[str] = set()
        self.archived: set[str] = set()
        self.versions: dict[str, int] = {}
        self.changes: deque[dict] = deque(maxlen=100)
        self.last_connection = "connecting"
        self.refresh_queue: set[str] = set()
        self.summaries: OrderedDict[tuple[str, str], dict] = OrderedDict()

    def turn_summary(self, tid: str, turn_id: str):
        return copy.deepcopy(
            self.summaries.get(
                (tid, turn_id),
                {
                    "threadId": tid,
                    "turnId": turn_id,
                    "plan": None,
                    "diff": None,
                    "observedAt": None,
                    "notice": "当前连接未观察到此轮计划或汇总差异；请核对原生执行记录。",
                },
            )
        )

    def observe_summary(self, tid: str, turn_id: str, method: str, params: dict):
        key = (tid, turn_id)
        value = self.turn_summary(tid, turn_id)
        value.update(observedAt=time.time(), notice=None)
        if method == "turn/plan/updated":
            value["plan"] = {
                "explanation": params.get("explanation"),
                "steps": params.get("plan", []),
            }
        else:
            value["diff"] = params.get("diff")
        self.summaries[key] = value
        self.summaries.move_to_end(key)
        # Limit both count and total diff bytes. Oversize observations are explicitly unavailable.
        while self.summaries and (
            len(self.summaries) > 100
            or sum(len(str(v).encode()) for v in self.summaries.values()) > 8_000_000
        ):
            self.summaries.popitem(last=False)

    @staticmethod
    def compact(turn: dict | None) -> dict | None:
        if not turn:
            return None
        result = {
            k: turn[k]
            for k in ("id", "status", "startedAt", "completedAt")
            if k in turn
        }
        if turn.get("error"):
            result["error"] = {"message": str(turn["error"].get("message", ""))[:512]}
        result["items"] = []
        text_budget = 512
        for item in reversed(turn.get("items", [])[-12:]):
            summary = {
                k: item[k] for k in ("id", "type", "status", "exitCode") if k in item
            }
            for key in ("text", "aggregatedOutput", "tool", "name"):
                if isinstance(item.get(key), str):
                    limit = text_budget if key in ("text", "aggregatedOutput") else 120
                    summary[key] = item[key][:limit]
                    if key in ("text", "aggregatedOutput"):
                        text_budget -= len(summary[key])
            if "changes" in item or "changeCount" in item:
                summary["changeCount"] = item.get(
                    "changeCount", len(item.get("changes", []))
                )
            summary["summaryOnly"] = True
            result["items"].append(summary)
        result["items"].reverse()
        return result

    @classmethod
    def summary_record(cls, record: dict) -> dict:
        thread = record["thread"]
        result = {
            k: record[k]
            for k in (
                "confirmedAt",
                "progressAt",
                "eventAt",
                "requestsUnknown",
                "historyAvailable",
            )
            if k in record
        }
        result["thread"] = {
            k: thread[k]
            for k in (
                "id",
                "name",
                "cwd",
                "updatedAt",
                "status",
                "parentThreadId",
                "canAcceptDirectInput",
                "historyAvailable",
                "historyNotice",
                "archived",
                "model",
                "reasoningEffort",
                "serviceTier",
                "recencyAt",
            )
            if k in thread
        }
        result["thread"]["preview"] = str(thread.get("preview") or "")[:240]
        result["turn"] = cls.compact(record.get("turn"))
        result["error"] = str(record["error"])[:512] if record.get("error") else None
        result["terminals"] = [
            {
                k: (v[:512] if isinstance(v, str) else v)
                for k, v in terminal.items()
                if k in ("itemId", "processId", "command", "cwd", "osPid")
            }
            for terminal in record.get("terminals", [])
        ]
        plan = record.get("plan")
        result["plan"] = (
            {
                "explanation": str(plan.get("explanation") or "")[:512],
                "steps": [
                    {
                        "step": str(step.get("step", ""))[:512],
                        "status": step.get("status"),
                    }
                    for step in plan.get("steps", [])
                ],
            }
            if plan
            else None
        )
        return result

    def touch(self, tid: str):
        self.versions[tid] = self.versions.get(tid, 0) + 1
        self.dirty.add(tid)

    def event(
        self,
        event: dict,
        *,
        connection_state: str,
        connection_id: str,
        pending: dict[str, dict],
    ):
        method, params = event.get("method", ""), event.get("params", {})
        if method.startswith("samaya/monitor"):
            return
        tid = params.get("threadId") or params.get("thread", {}).get("id")
        if method == "samaya/connection":
            self.summaries.clear()
            if (
                connection_state == "disconnected"
                and self.last_connection != "disconnected"
            ):
                self.changes.append(
                    {
                        "id": f"connection:{connection_id}:{time.time()}",
                        "threadId": "",
                        "at": time.time(),
                        "kind": "connection",
                    }
                )
            self.last_connection = connection_state
            if connection_state != "connected":
                self.records = {
                    tid: {
                        **r,
                        "plan": None,
                        "error": "连接已断开，保留最后确认状态",
                        "requestsUnknown": sum(
                            p.get("params", {}).get("threadId") == tid
                            for p in pending.values()
                        )
                        or r.get("requestsUnknown", 0),
                    }
                    for tid, r in self.records.items()
                }
            self.dirty.update(self.records)
            return
        if method == "samaya/operation" and params.get("state") == "succeeded":
            action, result = params.get("action"), params.get("result") or {}
            if action == "unarchive" and tid and tid not in self.deleted:
                self.archived.discard(tid)
                self.removed.discard(tid)
                self.touch(tid)
                self.refresh_queue.add(tid)
                return
            ids = set()
            if action == "delete":
                ids = {t["id"] for t in result.get("scope", [])}
                if tid:
                    ids.add(tid)
                self.deleted.update(ids)
            elif action == "archive":
                # The native archive receipt explicitly verifies each descendant.
                ids = {
                    t["id"]
                    for t in result.get("items", [])
                    if t["state"] == "succeeded"
                }
                self.archived.update(ids)
            for target in ids:
                self.touch(target)  # Invalidate any read started before cleanup.
                self.records.pop(target, None)
                self.dirty.discard(target)
                self.refresh_queue.discard(target)
                self.removed.add(target)
            for key in list(self.summaries):
                if key[0] in ids:
                    del self.summaries[key]
            if ids:
                return
        if tid in self.deleted or tid in self.archived:
            return
        if not tid or method.endswith(("Delta", "/delta")):
            return
        if method in ("turn/plan/updated", "turn/diff/updated") and params.get(
            "turnId"
        ):
            # A first plan can arrive before polling confirms the new turn. Keep
            # it by native identity without changing the currently displayed turn.
            self.observe_summary(tid, params["turnId"], method, params)
            current = (self.records.get(tid) or {}).get("turn")
            if not current or current["id"] != params["turnId"]:
                return
        if "id" in event:
            change_id = f"request:{connection_id}:{event['id']}"
            if not any(c["id"] == change_id for c in self.changes):
                self.changes.append(
                    {
                        "id": change_id,
                        "threadId": tid,
                        "at": time.time(),
                        "kind": "request",
                    }
                )
        self.touch(tid)
        if (
            method
            in (
                "thread/started",
                "thread/status/changed",
                "turn/started",
                "turn/completed",
                "samaya/operation",
            )
            or "id" in event
        ):
            self.refresh_queue.add(tid)
        old = self.records.get(tid)
        if not old:
            return  # The next catalog/read obtains the full native identity.
        record = {**old}
        thread = {**old["thread"]}
        turn = old.get("turn")
        # Never let a late event from a previous turn replace the current turn.
        incoming_turn = params.get("turn", {}).get("id") or params.get("turnId")
        if (
            method.startswith(("turn/", "item/"))
            and incoming_turn
            and turn
            and incoming_turn != turn["id"]
        ):
            return  # polling confirms a new turn; even late turn/started cannot resurrect one
        if (
            method == "turn/completed"
            and turn
            and turn.get("status") == params["turn"].get("status")
        ):
            return
        if method == "item/started" and turn and turn.get("status") != "inProgress":
            return
        now = time.time()
        if method in ("turn/plan/updated", "turn/diff/updated") and turn:
            if turn.get("status") != "inProgress":
                return
            summary = self.turn_summary(tid, turn["id"])
            record.update(plan=summary.get("plan"), progressAt=now, eventAt=now)
            self.records[tid] = record
            return
        if method == "thread/settings/updated":
            settings = params.get("threadSettings", {})
            thread.update(
                model=settings.get("model"),
                reasoningEffort=settings.get("effort"),
                serviceTier=settings.get("serviceTier"),
            )
        elif method == "thread/status/changed":
            if (
                params["status"].get("type") == "active"
                and turn
                and turn.get("status") != "inProgress"
            ):
                return  # an unversioned status event requires a new authoritative read
            thread["status"] = params["status"]
        elif method in ("turn/started", "turn/completed"):
            if method == "turn/started" and turn and turn.get("status") != "inProgress":
                return
            turn = self.compact(params["turn"])
            record["progressAt"] = now
        elif method in ("item/started", "item/completed") and turn:
            item = params["item"]
            items = [i for i in turn.get("items", []) if i["id"] != item["id"]]
            turn = self.compact({**turn, "items": [*items, item]})
            record["progressAt"] = now
        else:
            return  # deltas do not constitute new verified progress
        record.update(thread=thread, turn=turn, eventAt=now)
        self.records[tid] = record
        if method == "turn/completed":
            if any(
                c["id"] == f"{connection_id}:{tid}:{turn['id']}" for c in self.changes
            ):
                return
            self.changes.append(
                {
                    "id": f"{connection_id}:{tid}:{turn['id']}",
                    "threadId": tid,
                    "at": now,
                    "kind": turn["status"],
                }
            )
