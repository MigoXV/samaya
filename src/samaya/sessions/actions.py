"""Session mutations with native identity and execution-state checks."""

import asyncio
import logging

from openai_codex.errors import CodexError

from samaya.codex.connection import Connection
from samaya.composer.models import draft_settings, validate_selection
from samaya.config import Settings
from samaya.store import Store

from .models import active_turn
from .queries import SessionQueries

logger = logging.getLogger(__name__)


class SessionActions:
    def __init__(
        self,
        config: Settings,
        connection: Connection,
        store: Store,
        queries: SessionQueries,
    ):
        self.catalog = None
        self.config, self.connection, self.store, self.queries = (
            config,
            connection,
            store,
            queries,
        )

    async def execute(self, action: str, b: dict) -> dict:
        adapter = self.connection.connected()
        tid = b.get("threadId", "")
        if action == "plan_execute":
            thread = await self.queries.idle(tid)
            if thread.get("canAcceptDirectInput") is False:
                raise ValueError("此子智能体不接受直接输入")
            turns = thread.get("turns") or []
            if (
                not turns
                or turns[-1]["id"] != b["turnId"]
                or turns[-1]["status"] != "completed"
            ):
                raise ValueError("计划所在轮次已变化，请重新查看")
            settings = await self.queries.settings(tid, refresh=True)
            mode = (settings.get("collaborationMode") or {}).get("mode", "default")
            if mode != "plan":
                raise ValueError("当前已不在计划模式，请重新查看")
            cursor = None
            plan = None
            while True:
                page = await self.queries.items(
                    tid, b["turnId"], cursor=cursor, limit=100
                )
                plan = next(
                    (
                        row["item"]
                        for row in page["data"]
                        if row["item"].get("id") == b["planItemId"]
                        and row["item"].get("type") == "plan"
                    ),
                    None,
                )
                cursor = page.get("nextCursor")
                if plan or not cursor:
                    break
            if not plan or not plan.get("text", "").strip():
                raise ValueError("计划内容不可用，请重新查看")
            target = tid
            if b["clearContext"]:
                profile = settings.get("activePermissionProfile") or {}
                if (
                    not profile.get("id")
                    or not settings.get("approvalPolicy")
                    or not settings.get("approvalsReviewer")
                ):
                    raise ValueError("无法确认当前权限，暂时不能清空上下文执行")
                params = {
                    "cwd": thread["cwd"],
                    "permissions": profile["id"],
                    "approvalPolicy": settings["approvalPolicy"],
                    "approvalsReviewer": settings["approvalsReviewer"],
                    "historyMode": "paginated",
                    "threadSource": "user",
                    "ephemeral": False,
                }
                if settings.get("model"):
                    params["model"] = settings["model"]
                if settings.get("serviceTier"):
                    params["serviceTier"] = settings["serviceTier"]
                if settings.get("reasoningEffort"):
                    params["config"] = {
                        "model_reasoning_effort": settings["reasoningEffort"]
                    }
                created = await self.connection.rpc("thread/start", params)
                target = created["thread"]["id"]
                self.store.watch(target)
                self.queries.created(created)
            else:
                await self.connection.rpc(
                    "thread/settings/update",
                    {
                        "threadId": tid,
                        "collaborationMode": {
                            "mode": "default",
                            "settings": {
                                "model": settings.get("model") or thread.get("model"),
                                "reasoning_effort": settings.get("reasoningEffort"),
                                "developer_instructions": None,
                            },
                        },
                    },
                )
            text = (
                "请执行以下已确认的计划：\n\n" + plan["text"]
                if b["clearContext"]
                else "Implement the plan."
            )
            try:
                inputs = await self.catalog.inputs(
                    target, text, [], thread["cwd"], [], []
                )
                result = await self.connection.rpc(
                    "turn/start", {"threadId": target, "input": inputs}
                )
            except Exception:
                if target != tid:
                    return {
                        "threadId": target,
                        "warning": "新会话已创建，执行未确认，请打开会话核对。",
                    }
                raise
            return {"threadId": target, "turn": result.get("turn")}
        if action == "create":
            cwd = str(self.config.directory(b["cwd"]))
            selection = {}
            if b.get("modelSettings") is not None:
                choice = validate_selection(
                    await draft_settings(self.connection, cwd), b["modelSettings"]
                )
                selection = {
                    "model": choice["model"],
                    "serviceTier": choice["serviceTier"],
                    "config": {"model_reasoning_effort": choice["reasoningEffort"]},
                }
            started = await self.connection.rpc(
                "thread/start",
                {
                    "cwd": cwd,
                    "serviceName": "samaya",
                    "historyMode": "paginated",
                    "threadSource": "user",
                    "ephemeral": False,
                    **selection,
                },
            )
            thread = started["thread"]
            created_id = thread["id"]
            self.store.watch(created_id)
            self.queries.created(started)
            try:
                if b.get("name"):
                    await self.connection.rpc(
                        "thread/name/set", {"threadId": created_id, "name": b["name"]}
                    )
            except (CodexError, asyncio.TimeoutError, ConnectionError) as exc:
                logger.warning(
                    "Thread created; setup incomplete: %s", type(exc).__name__
                )
                return {
                    "threadId": created_id,
                    "warning": "会话已创建，但附加设置未全部确认。请先核查会话，不要重复创建。",
                }
            return {"threadId": created_id}
        if action == "shell":
            await self.queries.join(tid)
            thread = (await self.queries.read(tid, include_turns=False))["thread"]
            cwd = str(self.config.directory(thread["cwd"]))
            if cwd != b["expectedCwd"]:
                raise ValueError("工作目录已变化，请刷新后再执行命令")
            if thread.get("canAcceptDirectInput") is False:
                raise ValueError("此子智能体不接受直接输入，请返回主会话")
            self.store.watch(tid)
            result = await self.connection.rpc(
                "thread/shellCommand", {"threadId": tid, "command": b["command"]}
            )
            self.queries.fresh_threads.discard((self.connection.connection_id, tid))
            return result
        if action == "send":
            await self.queries.join(tid)
            thread = (
                (await self.queries.read(tid))["thread"]
                if b.get("reconcileLatest")
                else await self.queries.idle(tid)
            )
            self.config.directory(thread["cwd"])
            if thread.get("canAcceptDirectInput") is False:
                raise ValueError("此子智能体不接受直接输入，请返回主会话")
            latest = thread.get("turns", [])[-1]["id"] if thread.get("turns") else None
            if not b.get("reconcileLatest") and b.get("expectedTurnId") != latest:
                raise ValueError("其他客户端已更新会话，请刷新后再发送")
            self.store.watch(tid)
            active = active_turn(thread)
            if active and b.get("reconcileLatest"):
                return await self.connection.rpc(
                    "turn/steer",
                    {
                        "threadId": tid,
                        "expectedTurnId": active["id"],
                        "input": await self.catalog.inputs(
                            tid,
                            b.get("text", ""),
                            b.get("references", []),
                            b.get("expectedCwd"),
                            b.get("images", []),
                            b.get("files", []),
                        ),
                    },
                )
            result = await self.connection.rpc(
                "turn/start",
                {
                    "threadId": tid,
                    "input": await self.catalog.inputs(
                        tid,
                        b.get("text", ""),
                        b.get("references", []),
                        b.get("expectedCwd"),
                        b.get("images", []),
                        b.get("files", []),
                    ),
                },
            )
            self.queries.fresh_threads.discard((self.connection.connection_id, tid))
            return result
        if action == "steer":
            thread = (await self.queries.read(tid))["thread"]
            self.config.directory(thread["cwd"])
            current = active_turn(thread)
            if not current or current["id"] != b["expectedTurnId"]:
                raise ValueError("当前轮次已变化；追加要求未发送")
            if thread.get("canAcceptDirectInput") is False:
                raise ValueError("此子智能体不接受直接输入")
            return await self.connection.rpc(
                "turn/steer",
                {
                    "threadId": tid,
                    "expectedTurnId": current["id"],
                    "input": await self.catalog.inputs(
                        tid,
                        b.get("text", ""),
                        b.get("references", []),
                        b.get("expectedCwd"),
                        b.get("images", []),
                        b.get("files", []),
                    ),
                },
            )
        if action == "interrupt":
            thread = (await self.queries.read(tid))["thread"]
            current = active_turn(thread)
            if not current or current["id"] != b["turnId"]:
                raise ValueError("当前轮次已变化或已结束；没有中断其他轮次")
            return await self.connection.rpc(
                "turn/interrupt", {"threadId": tid, "turnId": b["turnId"]}
            )
        if action == "workspace":
            cwd = str(self.config.directory(b["cwd"]))
            await self.queries.idle(tid)
            await self.queries.join(tid)
            before = (await self.queries.read(tid))["thread"]
            if before["cwd"] != b["expectedCwd"]:
                raise ValueError("工作目录已被其他客户端改变，请刷新")
            await self.connection.rpc(
                "thread/settings/update", {"threadId": tid, "cwd": cwd}
            )
            resumed = await self.connection.rpc(
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
            rows = (await self.queries.terminals(tid))["data"]
            if not any(str(p["processId"]) == str(b["processId"]) for p in rows):
                raise ValueError("指定命令已经结束或不属于此会话")
            return await self.connection.rpc(
                "thread/backgroundTerminals/terminate",
                {"threadId": tid, "processId": b["processId"]},
            )
        if action in ("archive", "delete"):
            preview = await self.queries.preview(tid)
            if preview["digest"] != b.get("digest"):
                raise ValueError("影响范围已变化，请重新确认")
            for target in preview["scope"]:
                await self.queries.idle(target["id"])
                # Unloaded threads have no terminal runtime. Unknown failures block cleanup.
                if (
                    target.get("status", {}).get("type") != "notLoaded"
                    and (await self.queries.terminals(target["id"]))["data"]
                ):
                    raise ValueError(f"会话 {target['id']} 有后台命令，请先明确处理")
            if action == "archive":
                await adapter.sdk.thread_archive(tid)
                # Codex can report success despite a descendant archive failure.
                archived_ids: set[str] = set()
                cursor = None
                while True:
                    page = await self.queries.threads(archived=True, cursor=cursor)
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
            result = await self.connection.rpc("thread/delete", {"threadId": tid})
            return {"scope": preview["scope"], **result}
        if action == "unarchive":
            await adapter.sdk.thread_unarchive(tid)
            return {"threadId": tid}
        raise ValueError("不支持的操作")
