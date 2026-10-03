"""A bounded, disposable view of native Codex threads. No task model or database.

Polling repairs missed events. Revisions order *our observations*, not Codex work.
Request bodies remain in CodexService.pending and are never journaled here.
"""

from __future__ import annotations

import asyncio
import copy
import time
from collections import OrderedDict, defaultdict, deque
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .service import CodexService


class Monitor:
    def __init__(self, service: CodexService):
        self.service = service
        self.records: dict[str, dict] = {}
        self.revision = 0
        self.catalog_at = 0.0
        self.catalog_error: str | None = None
        self.initialized = False
        self.loaded: set[str] = set()
        self.joined: set[str] = set()
        self.dirty: set[str] = set()
        self.removed: set[str] = set()
        self.versions: dict[str, int] = {}
        self.changes: deque[dict] = deque(maxlen=100)
        self.tasks: list[asyncio.Task] = []
        self.last_connection = "connecting"
        self.generation = 0
        self.patches: deque[dict] = deque(maxlen=64)
        self.semaphore = asyncio.Semaphore(4)
        self.read_locks = defaultdict(asyncio.Lock)
        self.refresh_queue: set[str] = set()
        self.wake = asyncio.Event()
        # Event-only observations, not persistent native history. Full diffs stay
        # out of the catalog/SSE patch and are fetched by the detail view.
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

    def start(self):
        self.tasks = [
            asyncio.create_task(self.poll()),
            asyncio.create_task(self.flush()),
            asyncio.create_task(self.refresh_events()),
        ]

    async def close(self):
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)

    def snapshot(self):
        return {
            "records": list(self.records.values()),
            "revision": self.revision,
            "generation": self.service.connection_id,
            "cursor": self.service.store.cursor(),
            "connection": self.service.connection,
            "initialized": self.initialized,
            "catalogAt": self.catalog_at,
            "catalogError": self.catalog_error,
            "pendingRequests": list(self.service.pending.values()),
            "changes": list(self.changes),
            "requestCoverage": "live-connection-only",
        }

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

    def event(self, event: dict):
        method, params = event.get("method", ""), event.get("params", {})
        if method.startswith("samaya/monitor"):
            return
        tid = params.get("threadId") or params.get("thread", {}).get("id")
        if method == "samaya/connection":
            self.summaries.clear()
            if (
                self.service.connection == "disconnected"
                and self.last_connection != "disconnected"
            ):
                self.changes.append(
                    {
                        "id": f"connection:{self.service.connection_id}:{time.time()}",
                        "threadId": "",
                        "at": time.time(),
                        "kind": "connection",
                    }
                )
            self.last_connection = self.service.connection
            if self.service.connection != "connected":
                self.records = {
                    tid: {
                        **r,
                        "plan": None,
                        "error": "连接已断开，保留最后确认状态",
                        "requestsUnknown": sum(
                            p.get("params", {}).get("threadId") == tid
                            for p in self.service.pending.values()
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
            change_id = f"request:{self.service.connection_id}:{event['id']}"
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
            self.wake.set()
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
                c["id"] == f"{self.service.connection_id}:{tid}:{turn['id']}"
                for c in self.changes
            ):
                return
            self.changes.append(
                {
                    "id": f"{self.service.connection_id}:{tid}:{turn['id']}",
                    "threadId": tid,
                    "at": now,
                    "kind": turn["status"],
                }
            )

    async def loaded_ids(self) -> set[str]:
        loaded, cursor = set(), None
        while True:
            page = await self.service.rpc("thread/loaded/list", {"cursor": cursor})
            loaded.update(page["data"])
            cursor = page.get("nextCursor")
            if not cursor:
                return loaded

    async def catalog(self):
        found, cursor = {}, None
        while True:
            page = await self.service.threads(cursor=cursor)
            found.update((t["id"], t) for t in page["data"])
            cursor = page.get("nextCursor")
            if not cursor:
                break
        loaded = await self.loaded_ids()
        self.loaded = loaded
        for tid, thread in found.items():
            if tid not in self.records:
                self.records[tid] = {
                    "thread": thread,
                    "turn": None,
                    "confirmedAt": None,
                    "progressAt": None,
                    "terminals": [],
                    "error": "正在核对当前状态",
                }
                self.touch(tid)
            elif thread.get("updatedAt") != self.records[tid]["thread"].get(
                "updatedAt"
            ):
                self.touch(tid)
        for tid in set(self.records) - set(found) - loaded:
            del self.records[tid]
            self.removed.add(tid)
        self.catalog_at = time.time()
        self.catalog_error = None
        self.initialized = True
        return set(found) | loaded

    async def refresh(self, tid: str):
        async with self.read_locks[tid], self.semaphore:
            generation, version = self.service.generation, self.versions.get(tid, 0)
            try:
                # Only subscribe to already loaded sessions; monitoring never loads history into execution.
                if tid in self.loaded and tid not in self.joined:
                    await self.service.join(tid)
                    self.joined.add(tid)
                thread = (
                    await self.service.rpc(
                        "thread/read", {"threadId": tid, "includeTurns": False}
                    )
                )["thread"]
                from .service import normalize

                thread = normalize(thread)
                if tid not in self.records:
                    self.records[tid] = {
                        "thread": thread,
                        "turn": None,
                        "terminals": [],
                        "confirmedAt": None,
                        "progressAt": None,
                        "error": "正在核对历史",
                    }
                page = await self.service.turns(tid, limit=1)
                turn = self.compact(next(iter(page.get("data", [])), None))
                item_times = []
                if turn:
                    items = await self.service.items(tid, turn["id"], limit=12)
                    item_times = [
                        entry[key] / 1000
                        for entry in items["data"]
                        for key in ("startedAtMs", "completedAtMs")
                        if isinstance(entry.get(key), (int, float))
                    ]
                    turn = self.compact(
                        {
                            **turn,
                            "items": [
                                entry["item"] for entry in reversed(items["data"])
                            ],
                        }
                    )
                terminals = (
                    (await self.service.terminals(tid))["data"]
                    if tid in self.loaded
                    else []
                )
                if (
                    generation != self.service.generation
                    or version != self.versions.get(tid, 0)
                ):
                    return
                previous = self.records.get(tid, {})
                changed = previous.get("turn") != turn
                native_times = item_times + (
                    [
                        t
                        for t in (turn.get("startedAt"), turn.get("completedAt"))
                        if isinstance(t, (int, float))
                    ]
                    if turn
                    else []
                )
                progress_at = (
                    max(native_times) if native_times else previous.get("progressAt")
                )
                if (
                    changed
                    and previous.get("confirmedAt")
                    and turn
                    and turn["status"] == "inProgress"
                ):
                    progress_at = time.time()
                if (
                    turn
                    and turn.get("status") in ("completed", "interrupted", "failed")
                    and (previous.get("turn") or {}).get("status") == "inProgress"
                ):
                    change_id = f"{self.service.connection_id}:{tid}:{turn['id']}"
                    if not any(c["id"] == change_id for c in self.changes):
                        self.changes.append(
                            {
                                "id": change_id,
                                "threadId": tid,
                                "at": time.time(),
                                "kind": turn["status"],
                            }
                        )
                self.records[tid] = {
                    "thread": thread,
                    "turn": turn,
                    "terminals": terminals,
                    "confirmedAt": time.time(),
                    "progressAt": progress_at,
                    "plan": self.turn_summary(tid, turn["id"]).get("plan")
                    if turn
                    else None,
                    "error": None,
                    "requestsUnknown": previous.get("requestsUnknown", 0)
                    if thread.get("status", {}).get("activeFlags")
                    else 0,
                }
                self.dirty.add(tid)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - isolate individual protocol/transport failures
                if tid in self.records:
                    self.records[tid] = {
                        **self.records[tid],
                        "error": f"状态核对失败（{type(exc).__name__}）；保留最后确认结果",
                    }
                    self.dirty.add(tid)

    async def poll(self):
        while True:
            try:
                if self.service.connection == "connected":
                    reset = self.generation != self.service.generation
                    if reset:
                        self.generation = self.service.generation
                        self.joined.clear()
                    if reset or time.time() - self.catalog_at >= 30:
                        ids = await self.catalog()
                        targets = ids
                    else:
                        self.loaded = await self.loaded_ids()
                        targets = self.loaded | {
                            tid for tid in self.dirty if tid in self.records
                        }
                    # Do not put the whole catalog ahead of urgent event reconciliation.
                    ordered = list(targets)
                    for index in range(0, len(ordered), 4):
                        await asyncio.gather(
                            *(self.refresh(tid) for tid in ordered[index : index + 4])
                        )
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - isolate individual protocol/transport failures
                self.catalog_error = f"无法完成全局核对（{type(exc).__name__}）"
            await asyncio.sleep(5)

    async def refresh_events(self):
        while True:
            await self.wake.wait()
            self.wake.clear()
            targets, self.refresh_queue = self.refresh_queue, set()
            if self.service.connection != "connected":
                continue
            for tid in targets:
                await self.refresh(tid)

    async def flush(self):
        previous = None
        while True:
            await asyncio.sleep(0.25)
            state = (
                self.service.connection,
                self.catalog_error,
                self.initialized,
                tuple(
                    (k, p.get("responseState")) for k, p in self.service.pending.items()
                ),
            )
            if not self.dirty and not self.removed and state == previous:
                continue
            previous = state
            self.revision += 1
            snapshot = self.snapshot()
            # Request bodies/URLs stay memory-only. Browsers refetch these on a key change.
            snapshot.pop("pendingRequests")
            snapshot["requestKeys"] = list(self.service.pending)
            snapshot["requestStates"] = [
                f"{k}:{p.get('responseState', '')}"
                for k, p in self.service.pending.items()
            ]
            snapshot["records"] = [
                self.records[t] for t in self.dirty if t in self.records
            ]
            snapshot["removed"] = list(self.removed)
            self.dirty.clear()
            self.removed.clear()
            self.patches.append(snapshot)
            async with self.service.changed:
                self.service.changed.notify_all()
