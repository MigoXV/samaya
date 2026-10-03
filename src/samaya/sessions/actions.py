"""Session mutations with native identity and execution-state checks."""

import asyncio
import logging

from openai_codex import ApprovalMode, Sandbox
from openai_codex.errors import CodexError

from samaya.codex.connection import Connection
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
        self.config, self.connection, self.store, self.queries = (
            config,
            connection,
            store,
            queries,
        )

    async def execute(self, action: str, b: dict) -> dict:
        adapter = self.connection.connected()
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
                await self.connection.rpc(
                    "thread/settings/update",
                    {
                        "threadId": thread.id,
                        "approvalPolicy": "on-request",
                        "approvalsReviewer": "user",
                    },
                )
                if b.get("name"):
                    await self.connection.rpc(
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
            await self.queries.join(tid)
            thread = await self.queries.idle(tid)
            self.config.directory(thread["cwd"])
            if thread.get("canAcceptDirectInput") is False:
                raise ValueError("此子智能体不接受直接输入，请返回主会话")
            latest = thread.get("turns", [])[-1]["id"] if thread.get("turns") else None
            if b.get("expectedTurnId") != latest:
                raise ValueError("其他客户端已更新会话，请刷新后再发送")
            if not b.get("text", "").strip():
                raise ValueError("消息不能为空")
            self.store.watch(tid)
            return await self.connection.rpc(
                "turn/start",
                {"threadId": tid, "input": [{"type": "text", "text": b["text"]}]},
            )
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
                    "input": [{"type": "text", "text": b["text"]}],
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
