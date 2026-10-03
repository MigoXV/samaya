from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid
from collections import defaultdict

from openai_codex import ApprovalMode, Sandbox
from openai_codex.errors import CodexError, JsonRpcError
from openai_codex.generated.v2_all import ThreadSortKey, ThreadSourceKind

from samaya.config import Settings
from samaya.store import Store

from . import mcp
from .adapter import Adapter
from .monitor import Monitor

logger = logging.getLogger(__name__)


class Conflict(ValueError):
    pass


def parent_id(thread: dict) -> str | None:
    source = thread.get("source")
    spawn = (
        source.get("subAgent", {}).get("thread_spawn", {})
        if isinstance(source, dict)
        else {}
    )
    return thread.get("parentThreadId") or spawn.get("parent_thread_id")


def normalize(thread: dict) -> dict:
    thread["parentThreadId"] = parent_id(thread)
    return thread


def active_turn(thread: dict) -> dict | None:
    return next(
        (
            t
            for t in reversed(thread.get("turns", []))
            if t.get("status") == "inProgress"
        ),
        None,
    )


class CodexService:
    def __init__(self, config: Settings, store: Store):
        self.config, self.store = config, store
        self.adapter: Adapter | None = None
        self.connection = "connecting"
        self.error: str | None = None
        self.metadata: dict = {}
        self.pending: dict[str, dict] = {}
        self.mcp_progress: dict[tuple[str, str], str] = {}
        self.locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self.changed = asyncio.Condition()
        self.runner: asyncio.Task | None = None
        self.operations: set[asyncio.Task] = set()
        self.ready = asyncio.Event()
        self.generation = 0
        self.connection_id = ""
        self.subscription_problems: dict[str, str] = {}
        self.monitor = Monitor(self)
        self.legacy_items: set[str] = set()

    async def start(self) -> None:
        self.runner = asyncio.create_task(self._connect())
        self.monitor.start()

    async def close(self) -> None:
        await self.monitor.close()
        if self.runner:
            self.runner.cancel()
        if self.adapter:
            await self.adapter.close()
        if self.runner:
            await asyncio.gather(self.runner, return_exceptions=True)
        for task in self.operations:
            task.cancel()
        await asyncio.gather(*self.operations, return_exceptions=True)

    async def publish(self, event: dict) -> None:
        self.monitor.event(event)
        if event.get("method") == "turn/diff/updated":
            # Large disposable diff observations are read on demand, not retained
            # in the durable journal or broadcast to every global monitor.
            event = {
                "method": "samaya/turnSummaryChanged",
                "params": {k: event["params"][k] for k in ("threadId", "turnId")},
            }
        if event.get("method") == mcp.METHOD:
            # Live prompts can contain authorization URLs and private defaults.
            # Browsers obtain them from the in-memory snapshot, never the journal.
            event = {
                "method": "samaya/requestChanged",
                "params": {"threadId": event.get("params", {}).get("threadId")},
            }
        self.store.event(event)
        async with self.changed:
            self.changed.notify_all()

    async def _connect(self) -> None:
        while True:
            adapter = Adapter(self.config.socket)
            self.adapter = adapter
            self.connection = "connecting" if not self.generation else "reconnecting"
            await self.publish({"method": "samaya/connection", "params": self.status()})
            try:
                await asyncio.wait_for(adapter.start(), 15)
                self.generation += 1
                self.connection_id = uuid.uuid4().hex
                self.metadata = adapter.sdk.metadata.model_dump(by_alias=True)
                self.connection, self.error = "connected", None
                self.ready.set()
                # Rejoin only threads explicitly viewed/created here; no task replay.
                loaded = set((await self.rpc("thread/loaded/list", {}))["data"])
                for tid in self.store.watched():
                    if tid in loaded:
                        try:
                            await self.join(tid)
                        except JsonRpcError:
                            logger.info("Could not resubscribe one watched thread")
                await self.publish(
                    {
                        "method": "samaya/connection",
                        "params": self.status(),
                        "snapshotRequired": True,
                    }
                )
                while True:
                    event = await adapter.event()
                    method, params = event.get("method", ""), event.get("params", {})
                    if method == "item/mcpToolCall/progress":
                        self.mcp_progress[(params["threadId"], params["itemId"])] = (
                            params["message"][-6000:]
                        )
                        if len(self.mcp_progress) > 200:
                            self.mcp_progress.pop(next(iter(self.mcp_progress)))
                    elif method == "item/completed":
                        self.mcp_progress.pop(
                            (params["threadId"], params["item"]["id"]), None
                        )
                    if "id" in event:
                        key = f"{self.connection_id}:{json.dumps(event['id'])}"
                        if key not in self.pending:
                            self.pending[key] = {**event, "key": key}
                            if method == mcp.METHOD:
                                self.pending[key]["mcp"] = mcp.presentation(params)
                    if method in ("serverRequest/resolved", "turn/completed"):
                        self.pending = {
                            k: p
                            for k, p in self.pending.items()
                            if not mcp.resolved_by(p, method, params)
                        }
                    await self.publish(event)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - contain transport failures and uncertain submissions
                logger.warning("Codex connection interrupted: %s", type(exc).__name__)
                self.connection, self.error = (
                    "disconnected",
                    "无法连接 Codex；正在重连，执行状态未知",
                )
                self.ready.clear()
                self.monitor.event(
                    {"method": "samaya/connection", "params": self.status()}
                )
                self.pending.clear()
                self.mcp_progress.clear()
                await self.publish(
                    {
                        "method": "samaya/connection",
                        "params": self.status(),
                        "snapshotRequired": True,
                    }
                )
            finally:
                await adapter.close()
            await asyncio.sleep(3)

    def status(self) -> dict:
        return {
            "connection": self.connection,
            "error": self.error,
            "generation": self.generation,
            "sdkVersion": "0.160.0",
            "runtime": self.metadata,
            "socket": self.config.socket,
            "roots": [str(p) for p in self.config.roots],
            "cursor": self.store.cursor(),
        }

    def connected(self) -> Adapter:
        if self.connection != "connected" or self.adapter is None:
            raise ConnectionError("Codex 连接已断开；请等待恢复")
        return self.adapter

    async def rpc(self, method: str, params: dict | None = None) -> dict:
        return await asyncio.wait_for(self.connected().request(method, params), 60)

    async def threads(
        self,
        archived: bool = False,
        cursor: str | None = None,
        search: str | None = None,
    ) -> dict:
        result = await self.connected().sdk.thread_list(
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
        return await self.rpc(
            "thread/turns/list",
            {
                "threadId": tid,
                "cursor": cursor,
                "limit": limit,
                "sortDirection": "desc",
                "itemsView": "summary",
            },
        )

    async def turn_summary(self, tid: str, turn_id: str) -> dict:
        # Ownership is the native thread+turn pair observed by this connection.
        return self.monitor.turn_summary(tid, turn_id)

    async def items(
        self, tid: str, turn_id: str, cursor: str | None = None, limit: int = 50
    ) -> dict:
        if tid not in self.legacy_items and not (cursor or "").startswith("legacy:"):
            try:
                result = await self.rpc(
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
        thread = (await self.read(tid))["thread"]
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
        try:
            await self.connected().sdk.thread_resume(tid, include_turns=False)
        except JsonRpcError as exc:
            # 0.160.0 creates paginated threads before their first rollout exists.
            if "missing source rollout" not in str(exc):
                raise
            thread = (
                await self.rpc("thread/read", {"threadId": tid, "includeTurns": False})
            )["thread"]
            if thread.get("preview") or thread.get("status", {}).get("type") != "idle":
                raise

    async def read(self, tid: str, subscribe: bool = False) -> dict:
        if subscribe:
            try:
                await self.join(tid)
                self.store.watch(tid)
                self.subscription_problems.pop(tid, None)
            except JsonRpcError as exc:
                self.subscription_problems[tid] = str(exc)
        try:
            result = await self.rpc(
                "thread/read", {"threadId": tid, "includeTurns": True}
            )
        except JsonRpcError as exc:
            if "missing source rollout" not in str(exc):
                raise
            result = await self.rpc(
                "thread/read", {"threadId": tid, "includeTurns": False}
            )
            if result["thread"].get("preview"):
                raise
            result["historyNotice"] = "新会话尚未产生历史记录"

        result["thread"] = normalize(result["thread"])
        result["pendingRequests"] = [
            p
            for p in self.pending.values()
            if p.get("params", {}).get("threadId") == tid
        ]
        result["subscriptionNotice"] = self.subscription_problems.get(tid)
        result["toolProgress"] = {
            item: message
            for (thread, item), message in self.mcp_progress.items()
            if thread == tid
        }
        result["cursor"] = self.store.cursor()
        return result

    async def children(self, tid: str) -> list[dict]:
        rows = []
        for archived in (False, True):
            cursor = None
            while True:
                page = await self.rpc(
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
            page = await self.rpc(
                "thread/backgroundTerminals/list",
                {"threadId": tid, "limit": 100, "cursor": cursor},
            )
            rows.extend(page["data"])
            cursor = page.get("nextCursor")
            if not cursor:
                return {"data": rows}

    async def idle(self, tid: str) -> dict:
        thread = (await self.read(tid))["thread"]
        state = thread.get("status", {}).get("type")
        if active_turn(thread) or state == "active":
            raise Conflict("会话正在执行；请等待本轮结束或明确停止当前轮次")
        if state not in ("idle", "notLoaded", "systemError"):
            raise Conflict("无法确认会话状态，暂不执行此操作")
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

    @staticmethod
    def validate_action(action: str, body: dict) -> None:
        required = {
            "create": ["cwd"],
            "send": ["threadId", "text"],
            "steer": ["threadId", "text", "expectedTurnId"],
            "interrupt": ["threadId", "turnId"],
            "workspace": ["threadId", "cwd", "expectedCwd"],
            "terminate": ["threadId", "processId"],
            "archive": ["threadId", "digest"],
            "delete": ["threadId", "digest"],
            "unarchive": ["threadId"],
            "respond": ["threadId", "requestKey"],
        }
        if action not in required:
            raise ValueError("不支持的操作")
        for field in required[action]:
            if not isinstance(body.get(field), str) or not body[field].strip():
                raise ValueError(f"缺少有效参数：{field}")
        if action == "respond" and not isinstance(body.get("response"), dict):
            raise ValueError("无效的输入响应")
        if action == "send" and "expectedTurnId" not in body:
            raise ValueError("缺少会话版本，请刷新")

    async def execute(self, key: str, action: str, body: dict) -> dict:
        self.validate_action(action, body)
        fresh, receipt = self.store.reserve(key, {"action": action, "body": body})
        if not fresh:
            return receipt
        # Retain task independently of HTTP disconnect/cancellation.
        task = asyncio.create_task(self._execute(key, action, body))
        self.operations.add(task)
        task.add_done_callback(self.operations.discard)
        return await asyncio.shield(task)

    async def _execute(self, key: str, action: str, body: dict) -> dict:
        try:
            async with self.locks[body.get("threadId", "create")]:
                result = await self._action(action, body)
            receipt = self.store.finish(key, "succeeded", result)
        except (ValueError, FileNotFoundError) as exc:
            receipt = self.store.finish(key, "failed", {"message": str(exc)})
        except Exception as exc:  # noqa: BLE001 - contain transport failures and uncertain submissions
            # A protocol rejection is definite. Transport failure may have followed execution.
            definite = isinstance(exc, JsonRpcError)
            receipt = self.store.finish(
                key, "failed" if definite else "uncertain", {"message": str(exc)[:1500]}
            )
        await self.publish(
            {
                "method": "samaya/operation",
                "params": {
                    **receipt,
                    "threadId": body.get("threadId")
                    or receipt.get("result", {}).get("threadId"),
                    "action": action,
                },
            }
        )
        return receipt

    async def _action(self, action: str, b: dict) -> dict:
        adapter = self.connected()
        tid = b.get("threadId", "")
        if action == "create":
            cwd = str(self.config.directory(b["cwd"]))
            thread = await adapter.sdk.thread_start(
                cwd=cwd,
                approval_mode=ApprovalMode.deny_all,
                sandbox=Sandbox.workspace_write,
                service_name="samaya",
            )
            self.store.watch(thread.id)
            try:
                await self.rpc(
                    "thread/settings/update",
                    {
                        "threadId": thread.id,
                        "approvalPolicy": "on-request",
                        "approvalsReviewer": "user",
                    },
                )
                if b.get("name"):
                    await self.rpc(
                        "thread/name/set", {"threadId": thread.id, "name": b["name"]}
                    )
            except (CodexError, asyncio.TimeoutError, ConnectionError) as exc:
                logger.warning(
                    "Thread created; setup incomplete: %s", type(exc).__name__
                )
                return {
                    "threadId": thread.id,
                    "warning": "会话已创建，但附加设置未全部确认。请先核查会话，不要重复创建。",
                }
            return {"threadId": thread.id}
        if action == "send":
            await self.join(tid)
            thread = await self.idle(tid)
            self.config.directory(thread["cwd"])
            if thread.get("canAcceptDirectInput") is False:
                raise Conflict("此子智能体不接受直接输入，请返回主会话")
            latest = thread.get("turns", [])[-1]["id"] if thread.get("turns") else None
            if b.get("expectedTurnId") != latest:
                raise Conflict("其他客户端已更新会话，请刷新后再发送")
            if not b.get("text", "").strip():
                raise ValueError("消息不能为空")
            self.store.watch(tid)
            return await self.rpc(
                "turn/start",
                {"threadId": tid, "input": [{"type": "text", "text": b["text"]}]},
            )
        if action == "steer":
            thread = (await self.read(tid))["thread"]
            self.config.directory(thread["cwd"])
            current = active_turn(thread)
            if not current or current["id"] != b["expectedTurnId"]:
                raise Conflict("当前轮次已变化；追加要求未发送")
            if thread.get("canAcceptDirectInput") is False:
                raise Conflict("此子智能体不接受直接输入")
            return await self.rpc(
                "turn/steer",
                {
                    "threadId": tid,
                    "expectedTurnId": current["id"],
                    "input": [{"type": "text", "text": b["text"]}],
                },
            )
        if action == "interrupt":
            thread = (await self.read(tid))["thread"]
            current = active_turn(thread)
            if not current or current["id"] != b["turnId"]:
                raise Conflict("当前轮次已变化或已结束；没有中断其他轮次")
            return await self.rpc(
                "turn/interrupt", {"threadId": tid, "turnId": b["turnId"]}
            )
        if action == "workspace":
            cwd = str(self.config.directory(b["cwd"]))
            await self.idle(tid)
            await self.join(tid)
            before = (await self.read(tid))["thread"]
            if before["cwd"] != b["expectedCwd"]:
                raise Conflict("工作目录已被其他客户端改变，请刷新")
            await self.rpc("thread/settings/update", {"threadId": tid, "cwd": cwd})
            resumed = await self.rpc(
                "thread/resume", {"threadId": tid, "excludeTurns": True}
            )
            if resumed["cwd"] != cwd:
                raise RuntimeError("服务端尚未确认新的会话工作目录，请刷新核查")
            return {
                "cwd": resumed["cwd"],
                "threadId": tid,
                "instructionSourcesBeforeNextTurn": resumed.get(
                    "instructionSources", []
                ),
                "instructionReload": "next-turn",
                "sandbox": resumed.get("sandbox"),
                "runtimeWorkspaceRoots": resumed.get("runtimeWorkspaceRoots", []),
            }
        if action == "terminate":
            rows = (await self.terminals(tid))["data"]
            if not any(str(p["processId"]) == str(b["processId"]) for p in rows):
                raise Conflict("指定命令已经结束或不属于此会话")
            return await self.rpc(
                "thread/backgroundTerminals/terminate",
                {"threadId": tid, "processId": b["processId"]},
            )
        if action in ("archive", "delete"):
            preview = await self.preview(tid)
            if preview["digest"] != b.get("digest"):
                raise Conflict("影响范围已变化，请重新确认")
            for target in preview["scope"]:
                await self.idle(target["id"])
                # Unloaded threads have no terminal runtime. Unknown failures block cleanup.
                if (
                    target.get("status", {}).get("type") != "notLoaded"
                    and (await self.terminals(target["id"]))["data"]
                ):
                    raise Conflict(f"会话 {target['id']} 有后台命令，请先明确处理")
            if action == "archive":
                await adapter.sdk.thread_archive(tid)
                # Codex can report success despite a descendant archive failure.
                archived_ids: set[str] = set()
                cursor = None
                while True:
                    page = await self.threads(archived=True, cursor=cursor)
                    archived_ids.update(t["id"] for t in page["data"])
                    cursor = page.get("nextCursor")
                    if not cursor:
                        break
                remaining = {t["id"] for t in preview["scope"]} - archived_ids
                return {
                    "items": [
                        {
                            "id": t["id"],
                            "state": "failed" if t["id"] in remaining else "succeeded",
                        }
                        for t in preview["scope"]
                    ]
                }
            result = await self.rpc("thread/delete", {"threadId": tid})
            return {"scope": preview["scope"], **result}
        if action == "unarchive":
            await adapter.sdk.thread_unarchive(tid)
            return {"threadId": tid}
        if action == "respond":
            request = self.pending.get(b["requestKey"])
            if not request or request.get("params", {}).get("threadId") != tid:
                raise Conflict("请求已经处理或连接已变化；请刷新会话")
            if request.get("responseState") in ("submitting", "sent", "uncertain"):
                raise Conflict("此请求已经提交，结果尚未确认；请勿再次提交")
            method = request["method"]
            result = b["response"]
            if method in (
                "item/commandExecution/requestApproval",
                "item/fileChange/requestApproval",
            ):
                if result.get("decision") not in ("accept", "decline", "cancel"):
                    raise ValueError("不支持的审批决定")
            elif method == "item/tool/requestUserInput":
                questions = request["params"]["questions"]
                if any(q["id"] not in result.get("answers", {}) for q in questions):
                    raise ValueError("请回答全部问题")
            elif method == "item/permissions/requestApproval":
                if result.get("scope") != "turn":
                    raise ValueError("仅支持本轮权限审批")
            elif method == mcp.METHOD:
                result = mcp.validate_response(request["params"], result)
            else:
                raise ValueError("此类服务端输入尚未适配，请使用 Codex 客户端处理")
            request["responseState"] = "submitting"
            try:
                response = await self.rpc(
                    "samaya/serverRequest/respond",
                    {"id": request["id"], "result": result},
                )
            except JsonRpcError:
                request.pop("responseState", None)
                raise
            except BaseException:
                request["responseState"] = "uncertain"
                await self.publish(
                    {"method": "samaya/requestChanged", "params": {"threadId": tid}}
                )
                raise
            # Bridge receipt proves a wire send, not app-server resolution. Keep
            # the request visible and non-answerable until a native resolution.
            request["responseState"] = "sent"
            await self.publish(
                {"method": "samaya/requestChanged", "params": {"threadId": tid}}
            )
            return response
        raise ValueError("不支持的操作")
