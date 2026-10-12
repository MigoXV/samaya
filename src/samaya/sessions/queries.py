"""Native session/history queries and explicit subscription restoration."""

import hashlib
import json
import logging
import time

from openai_codex.errors import JsonRpcError
from openai_codex.generated.v2_all import ThreadSortKey, ThreadSourceKind

from samaya.codex.connection import Connection
from samaya.decisions.service import Decisions
from samaya.store import Store

from .models import HISTORY_UNAVAILABLE, active_turn, normalize

logger = logging.getLogger(__name__)


def missing_rollout(exc: JsonRpcError) -> bool:
    return any(
        message in str(exc)
        for message in ("missing source rollout", "no rollout found for thread id")
    )


class SessionQueries:
    def __init__(self, connection: Connection, store: Store, decisions: Decisions):
        self.connection, self.store, self.decisions = connection, store, decisions
        self.subscription_problems: dict[str, str] = {}
        self.legacy_items: set[str] = set()
        self.legacy_turns: set[tuple[str, str]] = set()
        self.unavailable_history: dict[tuple[str, str], float] = {}
        self.fresh_threads: set[tuple[str, str]] = set()
        self.setting_snapshots: dict[str, tuple[str, int, dict]] = {}
        self.settings_revision = 0

    def created(self, result: dict) -> None:
        """A started thread is already subscribed; resume only persisted sessions."""
        tid = result["thread"]["id"]
        generation = self.connection.connection_id
        self.fresh_threads.add((generation, tid))
        self.setting_snapshots[tid] = (
            generation,
            self.settings_revision,
            {
                k: result.get(k)
                for k in (
                    "model",
                    "reasoningEffort",
                    "serviceTier",
                    "collaborationMode",
                )
            },
        )

    def is_fresh(self, thread: dict) -> bool:
        key = (self.connection.connection_id, thread["id"])
        if key not in self.fresh_threads:
            return False
        if thread.get("preview") or thread.get("status", {}).get("type") != "idle":
            self.fresh_threads.discard(key)
            return False
        return True

    def observe_settings(self, event: dict) -> None:
        if event.get("method") in ("turn/started", "turn/completed", "thread/started"):
            params = event.get("params", {})
            tid = params.get("threadId") or params.get("thread", {}).get("id")
            key = (self.connection.connection_id, tid)
            self.unavailable_history.pop(key, None)
            self.legacy_turns.discard(key)
            if event.get("method") != "thread/started":
                self.fresh_threads.discard(key)
        if event.get("method") != "thread/settings/updated":
            return
        params = event["params"]
        settings = params.get("threadSettings", {})
        self.settings_revision += 1
        self.setting_snapshots[params["threadId"]] = (
            self.connection.connection_id,
            self.settings_revision,
            {
                "model": settings.get("model"),
                "reasoningEffort": settings.get("effort"),
                "serviceTier": settings.get("serviceTier"),
                "collaborationMode": settings.get("collaborationMode"),
            },
        )

    async def settings(self, tid: str, refresh: bool = False) -> dict:
        generation = self.connection.connection_id
        cached = self.setting_snapshots.get(tid)
        if (
            cached
            and cached[0] == generation
            and (not refresh or (generation, tid) in self.fresh_threads)
        ):
            return dict(cached[2])
        revision = self.settings_revision
        try:
            result = await self.connection.rpc(
                "thread/resume", {"threadId": tid, "excludeTurns": True}
            )
        except JsonRpcError as exc:
            if not missing_rollout(exc) or not cached or cached[0] != generation:
                raise
            return dict(cached[2])
        latest = self.setting_snapshots.get(tid)
        if latest and latest[0] == generation and latest[1] > revision:
            return dict(latest[2])
        values = {
            k: result.get(k)
            for k in ("model", "reasoningEffort", "serviceTier", "collaborationMode")
        }
        self.setting_snapshots[tid] = (generation, revision, values)
        return dict(values)

    def with_settings(self, thread: dict) -> dict:
        cached = self.setting_snapshots.get(thread["id"])
        if cached and cached[0] == self.connection.connection_id:
            thread.update(cached[2])
        return thread

    async def restore(self) -> None:
        loaded = set((await self.connection.rpc("thread/loaded/list", {}))["data"])
        for tid in self.store.watched():
            if tid in loaded:
                try:
                    await self.join(tid)
                except JsonRpcError:
                    logger.info("Could not resubscribe one watched thread")

    async def threads(
        self,
        archived: bool = False,
        cursor: str | None = None,
        search: str | None = None,
    ) -> dict:
        result = await self.connection.connected().sdk.thread_list(
            archived=archived,
            cursor=cursor,
            limit=100,
            search_term=search or None,
            source_kinds=list(ThreadSourceKind),
            sort_key=ThreadSortKey.updated_at,
            use_state_db_only=True,
        )
        data = result.model_dump(mode="json", by_alias=True)
        data["data"] = [normalize({**t, "archived": archived}) for t in data["data"]]
        return data

    async def turns(self, tid: str, cursor: str | None = None, limit: int = 20) -> dict:
        summary = (await self.read(tid, include_turns=False))["thread"]
        if self.is_fresh(summary):
            return {"data": [], "nextCursor": None, "historyAvailable": True}
        if summary.get("historyAvailable") is False:
            return {
                "data": [],
                "nextCursor": None,
                "historyAvailable": False,
                "historyNotice": HISTORY_UNAVAILABLE,
            }
        key = (self.connection.connection_id, tid)
        if key not in self.legacy_turns and not (cursor or "").startswith("legacy:"):
            try:
                return await self.connection.rpc(
                    "thread/turns/list",
                    {
                        "threadId": tid,
                        "cursor": cursor,
                        "limit": limit,
                        "sortDirection": "desc",
                        "itemsView": "summary",
                    },
                )
            except JsonRpcError as exc:
                if "-32601" not in str(exc):
                    raise
                self.legacy_turns.add(key)
        if cursor and not cursor.startswith("legacy:"):
            raise ValueError("历史接口已变化，请重新加载会话")
        offset = int(cursor.split(":", 1)[1]) if cursor else 0
        if offset < 0:
            raise ValueError("无效历史游标")
        result = await self.read(tid)
        if result.get("historyAvailable") is False:
            return {
                "data": [],
                "nextCursor": None,
                "historyAvailable": False,
                "historyNotice": HISTORY_UNAVAILABLE,
            }
        thread = result["thread"]
        rows = list(reversed(thread.get("turns", [])))
        return {
            "data": rows[offset : offset + limit],
            "nextCursor": f"legacy:{offset + limit}"
            if offset + limit < len(rows)
            else None,
            "historyAvailable": True,
        }

    async def require_history(self, tid: str) -> None:
        thread = (await self.read(tid))["thread"]
        if thread.get("historyAvailable") is False:
            raise ValueError(HISTORY_UNAVAILABLE)

    async def paged_history(self, tid: str) -> list[dict]:
        """Use the native full turn view when a store cannot serve thread/read history."""
        rows, cursor = [], None
        while True:
            page = await self.connection.rpc(
                "thread/turns/list",
                {
                    "threadId": tid,
                    "cursor": cursor,
                    "limit": 100,
                    "sortDirection": "asc",
                    "itemsView": "full",
                },
            )
            rows.extend(page["data"])
            cursor = page.get("nextCursor")
            if not cursor:
                return rows

    async def items(
        self, tid: str, turn_id: str, cursor: str | None = None, limit: int = 50
    ) -> dict:
        if tid not in self.legacy_items and not (cursor or "").startswith("legacy:"):
            try:
                result = await self.connection.rpc(
                    "thread/items/list",
                    {
                        "threadId": tid,
                        "turnId": turn_id,
                        "cursor": cursor,
                        "limit": limit,
                        "sortDirection": "desc",
                    },
                )
                return {**result, "samayaCursor": self.store.cursor()}
            except JsonRpcError as exc:
                # Verified on one older native thread in this daemon. The fallback is
                # still the official protocol, never Codex's database/history files.
                if "-32601" not in str(exc):
                    raise
                self.legacy_items.add(tid)
        offset = int(cursor.split(":", 1)[1]) if cursor else 0
        if offset < 0:
            raise ValueError("无效历史游标")
        result = await self.read(tid)
        if result.get("historyAvailable") is False:
            raise ValueError(HISTORY_UNAVAILABLE)
        thread = result["thread"]
        turn = next((t for t in thread.get("turns", []) if t["id"] == turn_id), None)
        if turn is None:
            raise ValueError("指定轮次未出现在可恢复历史中")
        rows = list(reversed(turn.get("items", [])))
        return {
            "data": [
                {"turnId": turn_id, "item": i} for i in rows[offset : offset + limit]
            ],
            "nextCursor": f"legacy:{offset + limit}"
            if offset + limit < len(rows)
            else None,
            "samayaCursor": self.store.cursor(),
            "historyNotice": "此旧会话未支持条目分页；通过官方完整历史接口恢复后分段展示。",
        }

    async def join(self, tid: str) -> None:
        if (self.connection.connection_id, tid) in self.fresh_threads:
            thread = (await self.read(tid, include_turns=False))["thread"]
            if self.is_fresh(thread):
                return
        try:
            await self.connection.connected().sdk.thread_resume(
                tid, include_turns=False
            )
        except JsonRpcError as exc:
            # 0.160.0 creates paginated threads before their first rollout exists.
            if not missing_rollout(exc):
                raise
            thread = (
                await self.connection.rpc(
                    "thread/read", {"threadId": tid, "includeTurns": False}
                )
            )["thread"]
            if thread.get("preview") or thread.get("status", {}).get("type") != "idle":
                raise

    async def read(
        self, tid: str, subscribe: bool = False, include_turns: bool = True
    ) -> dict:
        summary = await self.connection.rpc(
            "thread/read", {"threadId": tid, "includeTurns": False}
        )
        key = (self.connection.connection_id, tid)
        unavailable_until = self.unavailable_history.get(key, 0)
        if unavailable_until and unavailable_until <= time.monotonic():
            self.unavailable_history.pop(key, None)
            self.legacy_turns.discard(key)
        if self.is_fresh(summary["thread"]):
            summary["thread"]["turns"] = []
            if subscribe:
                self.store.watch(tid)
            include_turns = False
        if not include_turns or key in self.unavailable_history:
            summary["thread"] = self.with_settings(normalize(summary["thread"]))
            if key in self.unavailable_history:
                summary["thread"].update(
                    historyAvailable=False,
                    historyNotice=HISTORY_UNAVAILABLE,
                )
                summary.update(
                    historyAvailable=False, historyNotice=HISTORY_UNAVAILABLE
                )
            summary.update(
                cursor=self.store.cursor(),
                pendingRequests=[
                    p
                    for p in self.decisions.pending.values()
                    if p.get("params", {}).get("threadId") == tid
                ],
            )
            return summary
        if subscribe:
            try:
                await self.join(tid)
                self.store.watch(tid)
                self.subscription_problems.pop(tid, None)
            except JsonRpcError as exc:
                self.subscription_problems[tid] = str(exc)
        try:
            result = await self.connection.rpc(
                "thread/read", {"threadId": tid, "includeTurns": True}
            )
        except JsonRpcError as exc:
            if "-32601" in str(exc):
                result = summary
                try:
                    result["thread"]["turns"] = await self.paged_history(tid)
                except JsonRpcError as paged_exc:
                    if "-32601" not in str(paged_exc):
                        raise
                    self.unavailable_history[key] = time.monotonic() + 5
                    result.update(
                        historyAvailable=False, historyNotice=HISTORY_UNAVAILABLE
                    )
                    result["thread"].update(
                        historyAvailable=False,
                        historyNotice=HISTORY_UNAVAILABLE,
                    )
            elif not missing_rollout(exc):
                raise
            else:
                result = summary
                if result["thread"].get("preview"):
                    raise
                result["historyNotice"] = "新会话尚未产生历史记录"

        result["thread"] = self.with_settings(normalize(result["thread"]))
        result["pendingRequests"] = [
            p
            for p in self.decisions.pending.values()
            if p.get("params", {}).get("threadId") == tid
        ]
        result["subscriptionNotice"] = self.subscription_problems.get(tid)
        result["toolProgress"] = {
            item: message
            for (thread, item), message in self.decisions.progress.items()
            if thread == tid
        }
        result["cursor"] = self.store.cursor()
        return result

    async def children(self, tid: str) -> list[dict]:
        rows = []
        for archived in (False, True):
            cursor = None
            while True:
                page = await self.connection.rpc(
                    "thread/list",
                    {
                        "ancestorThreadId": tid,
                        "archived": archived,
                        "sourceKinds": [s.value for s in ThreadSourceKind],
                        "limit": 100,
                        "cursor": cursor,
                        "useStateDbOnly": True,
                    },
                )
                rows.extend(
                    normalize({**t, "archived": archived}) for t in page["data"]
                )
                cursor = page.get("nextCursor")
                if not cursor:
                    break
        return rows

    async def terminals(self, tid: str) -> dict:
        rows, cursor = [], None
        while True:
            page = await self.connection.rpc(
                "thread/backgroundTerminals/list",
                {"threadId": tid, "limit": 100, "cursor": cursor},
            )
            rows.extend(page["data"])
            cursor = page.get("nextCursor")
            if not cursor:
                return {"data": rows}

    async def idle(self, tid: str) -> dict:
        thread = (await self.read(tid))["thread"]
        if thread.get("historyAvailable") is False:
            raise ValueError(HISTORY_UNAVAILABLE)
        state = thread.get("status", {}).get("type")
        if active_turn(thread) or state == "active":
            raise ValueError("会话正在执行；请等待本轮结束或明确停止当前轮次")
        if state not in ("idle", "notLoaded", "systemError"):
            raise ValueError("无法确认会话状态，暂不执行此操作")
        return thread

    async def preview(self, tid: str) -> dict:
        root = (await self.read(tid))["thread"]
        scope = [root] + await self.children(tid)
        values = [
            {
                "id": t["id"],
                "name": t.get("name") or t.get("preview") or "未命名会话",
                "cwd": t["cwd"],
                "status": t.get("status"),
            }
            for t in scope
        ]
        digest = hashlib.sha256(
            json.dumps(
                sorted((t["id"], t["cwd"], t.get("name") or "") for t in scope)
            ).encode()
        ).hexdigest()
        return {"scope": values, "digest": digest}
