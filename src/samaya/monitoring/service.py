"""A bounded, disposable view of native Codex threads. No task model or database.

Polling repairs missed events. Revisions order *our observations*, not Codex work.
Request bodies remain in Decisions.pending and are never journaled here.
"""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque

from samaya.codex.connection import Connection
from samaya.decisions.service import Decisions
from samaya.sessions.models import normalize
from samaya.sessions.queries import SessionQueries
from samaya.store import Store

from .projection import Projection


class Monitor:
    def __init__(
        self,
        connection: Connection,
        queries: SessionQueries,
        decisions: Decisions,
        store: Store,
        changed: asyncio.Condition,
    ):
        self.connection, self.queries, self.decisions, self.store, self.changed = (
            connection,
            queries,
            decisions,
            store,
            changed,
        )
        self.revision = 0
        self.catalog_at = 0.0
        self.catalog_error: str | None = None
        self.initialized = False
        self.loaded: set[str] = set()
        self.joined: set[str] = set()
        self.tasks: list[asyncio.Task] = []
        self.generation = 0
        self.patches: deque[dict] = deque(maxlen=64)
        self.semaphore = asyncio.Semaphore(4)
        self.read_locks = defaultdict(asyncio.Lock)
        self.wake = asyncio.Event()

        self.projection = Projection()
        self.stopping = False

    def event(self, event: dict) -> None:
        self.projection.event(
            event,
            connection_state=self.connection.state,
            connection_id=self.connection.connection_id,
            pending=self.decisions.pending,
        )
        if self.projection.refresh_queue:
            self.wake.set()

    def turn_summary(self, tid: str, turn_id: str) -> dict:
        return self.projection.turn_summary(tid, turn_id)

    def start(self):
        self.tasks = [
            asyncio.create_task(self.poll()),
            asyncio.create_task(self.flush()),
            asyncio.create_task(self.refresh_events()),
        ]

    async def close(self):
        self.stopping = True
        self.wake.set()
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)

    def snapshot(self):
        return {
            "records": list(self.projection.records.values()),
            "revision": self.revision,
            "generation": self.connection.connection_id,
            "cursor": self.store.cursor(),
            "connection": self.connection.state,
            "initialized": self.initialized,
            "catalogAt": self.catalog_at,
            "catalogError": self.catalog_error,
            "pendingRequests": list(self.decisions.pending.values()),
            "changes": list(self.projection.changes),
            "requestCoverage": "live-connection-only",
        }

    async def loaded_ids(self) -> set[str]:
        loaded, cursor = set(), None
        while True:
            page = await self.connection.rpc("thread/loaded/list", {"cursor": cursor})
            loaded.update(page["data"])
            cursor = page.get("nextCursor")
            if not cursor:
                return loaded

    async def catalog(self):
        found, cursor = {}, None
        while True:
            page = await self.queries.threads(cursor=cursor)
            found.update((t["id"], t) for t in page["data"])
            cursor = page.get("nextCursor")
            if not cursor:
                break
        loaded = await self.loaded_ids()
        self.loaded = loaded
        for tid, thread in found.items():
            if tid not in self.projection.records:
                self.projection.records[tid] = {
                    "thread": thread,
                    "turn": None,
                    "confirmedAt": None,
                    "progressAt": None,
                    "terminals": [],
                    "error": "正在核对当前状态",
                }
                self.projection.touch(tid)
            elif any(
                thread.get(key) != self.projection.records[tid]["thread"].get(key)
                for key in ("updatedAt", "recencyAt")
            ):
                self.projection.touch(tid)
        for tid in set(self.projection.records) - set(found) - loaded:
            del self.projection.records[tid]
            self.projection.removed.add(tid)
        self.catalog_at = time.time()
        self.catalog_error = None
        self.initialized = True
        return set(found) | loaded

    async def refresh(self, tid: str):
        async with self.read_locks[tid], self.semaphore:
            generation, version = (
                self.connection.generation,
                self.projection.versions.get(tid, 0),
            )
            try:
                # Only subscribe to already loaded sessions; monitoring never loads history into execution.
                if tid in self.loaded and tid not in self.joined:
                    await self.queries.join(tid)
                    self.joined.add(tid)
                thread = (
                    await self.connection.rpc(
                        "thread/read", {"threadId": tid, "includeTurns": False}
                    )
                )["thread"]
                thread = self.queries.with_settings(normalize(thread))
                if tid not in self.projection.records:
                    self.projection.records[tid] = {
                        "thread": thread,
                        "turn": None,
                        "terminals": [],
                        "confirmedAt": None,
                        "progressAt": None,
                        "error": "正在核对历史",
                    }
                page = await self.queries.turns(tid, limit=1)
                turn = self.projection.compact(next(iter(page.get("data", [])), None))
                item_times = []
                if turn:
                    items = await self.queries.items(tid, turn["id"], limit=12)
                    item_times = [
                        entry[key] / 1000
                        for entry in items["data"]
                        for key in ("startedAtMs", "completedAtMs")
                        if isinstance(entry.get(key), (int, float))
                    ]
                    turn = self.projection.compact(
                        {
                            **turn,
                            "items": [
                                entry["item"] for entry in reversed(items["data"])
                            ],
                        }
                    )
                terminals = (
                    (await self.queries.terminals(tid))["data"]
                    if tid in self.loaded
                    else []
                )
                if (
                    generation != self.connection.generation
                    or version != self.projection.versions.get(tid, 0)
                ):
                    return
                previous = self.projection.records.get(tid, {})
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
                    change_id = f"{self.connection.connection_id}:{tid}:{turn['id']}"
                    if not any(c["id"] == change_id for c in self.projection.changes):
                        self.projection.changes.append(
                            {
                                "id": change_id,
                                "threadId": tid,
                                "at": time.time(),
                                "kind": turn["status"],
                            }
                        )
                self.projection.records[tid] = {
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
                self.projection.dirty.add(tid)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - isolate individual protocol/transport failures
                if tid in self.projection.records:
                    self.projection.records[tid] = {
                        **self.projection.records[tid],
                        "error": f"状态核对失败（{type(exc).__name__}）；保留最后确认结果",
                    }
                    self.projection.dirty.add(tid)

    async def poll(self):
        while not self.stopping:
            try:
                if self.connection.state == "connected":
                    reset = self.generation != self.connection.generation
                    if reset:
                        self.generation = self.connection.generation
                        self.joined.clear()
                    if reset or time.time() - self.catalog_at >= 30:
                        ids = await self.catalog()
                        targets = ids
                    else:
                        self.loaded = await self.loaded_ids()
                        targets = self.loaded | {
                            tid
                            for tid in self.projection.dirty
                            if tid in self.projection.records
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
        while not self.stopping:
            await self.wake.wait()
            if self.stopping:
                return
            self.wake.clear()
            targets, self.projection.refresh_queue = (
                self.projection.refresh_queue,
                set(),
            )
            if self.connection.state != "connected":
                continue
            for tid in targets:
                await self.refresh(tid)

    async def flush(self):
        previous = None
        while not self.stopping:
            await asyncio.sleep(0.25)
            state = (
                self.connection.state,
                self.catalog_error,
                self.initialized,
                tuple(
                    (k, p.get("responseState"))
                    for k, p in self.decisions.pending.items()
                ),
            )
            if (
                not self.projection.dirty
                and not self.projection.removed
                and state == previous
            ):
                continue
            previous = state
            self.revision += 1
            snapshot = self.snapshot()
            # Request bodies/URLs stay memory-only. Browsers refetch these on a key change.
            snapshot.pop("pendingRequests")
            snapshot["requestKeys"] = list(self.decisions.pending)
            snapshot["requestStates"] = [
                f"{k}:{p.get('responseState', '')}"
                for k, p in self.decisions.pending.items()
            ]
            snapshot["records"] = [
                self.projection.records[t]
                for t in self.projection.dirty
                if t in self.projection.records
            ]
            snapshot["removed"] = list(self.projection.removed)
            self.projection.dirty.clear()
            self.projection.removed.clear()
            self.patches.append(snapshot)
            async with self.changed:
                self.changed.notify_all()
