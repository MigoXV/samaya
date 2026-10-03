"""Synchronous native-event projection; no connection, polling or persistence."""

import copy
import time
from collections import OrderedDict, deque


class Projection:
    def __init__(self):
        self.records: dict[str, dict] = {}
        self.dirty: set[str] = set()
        self.removed: set[str] = set()
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
        result = copy.deepcopy(turn)
        result["items"] = result.get("items", [])[-12:]
        for item in result["items"]:
            for key in ("text", "aggregatedOutput"):
                if isinstance(item.get(key), str):
                    item[key] = item[key][-2000:]
            # Exact diffs and full logs are read on demand; never imply this is complete.
            if "changes" in item:
                item["changes"] = [
                    {"path": c.get("path"), "kind": c.get("kind")}
                    for c in item["changes"]
                ]
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
        if method == "thread/status/changed":
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
