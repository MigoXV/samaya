"""Durable operation identities, per-thread serialization and HTTP-independent work."""

import asyncio
import logging
from collections import defaultdict
from collections.abc import Awaitable, Callable

from openai_codex.errors import JsonRpcError

from samaya.composer.files import file_ids
from samaya.composer.images import message_inputs
from samaya.store import Store

logger = logging.getLogger(__name__)

QUEUE_TIMEOUT = 15
DISPATCH_TIMEOUT = 120


class Operations:
    def __init__(
        self,
        store: Store,
        dispatch: Callable[[str, dict], Awaitable[dict]],
        publish: Callable[[dict], Awaitable[None]],
    ):
        self.store, self.dispatch, self.publish = store, dispatch, publish
        self.locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self.tasks: set[asyncio.Task] = set()

    async def close(self) -> None:
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)

    @staticmethod
    def validate_action(action: str, body: dict) -> None:
        required = {
            "command": ["threadId", "command"],
            "shell": ["threadId", "command", "expectedCwd"],
            "create": ["cwd"],
            "send": ["threadId"],
            "steer": ["threadId", "expectedTurnId"],
            "interrupt": ["threadId", "turnId"],
            "workspace": ["threadId", "cwd", "expectedCwd"],
            "terminate": ["threadId", "processId"],
            "archive": ["threadId", "digest"],
            "delete": ["threadId", "digest"],
            "unarchive": ["threadId"],
            "respond": ["threadId", "requestKey"],
            "plan_execute": ["threadId", "turnId", "planItemId"],
        }
        if action not in required:
            raise ValueError("不支持的操作")
        for field in required[action]:
            if not isinstance(body.get(field), str) or not body[field].strip():
                raise ValueError(f"缺少有效参数：{field}")
        if action == "shell" and any(
            body.get(key) for key in ("images", "files", "references")
        ):
            raise ValueError("Shell 命令不能同时附带图片、文件或引用")
        if action == "respond" and not isinstance(body.get("response"), dict):
            raise ValueError("无效的输入响应")
        if action == "plan_execute" and not isinstance(body.get("clearContext"), bool):
            raise ValueError("缺少计划执行方式")
        if action in ("send", "steer"):
            uploaded = file_ids(body.get("files", []))
            message_inputs(
                body.get("text", ""), body.get("images", []), allow_empty=bool(uploaded)
            )
        if action == "send" and "expectedTurnId" not in body:
            raise ValueError("缺少会话版本，请刷新")

    async def execute(
        self, key: str, action: str, body: dict, *, wait: bool = True
    ) -> dict:
        self.validate_action(action, body)
        fresh, receipt = self.store.reserve(key, {"action": action, "body": body})
        if not fresh:
            return receipt
        # Retain task independently of HTTP disconnect/cancellation.
        task = asyncio.create_task(self._execute(key, action, body))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        if not wait:
            return {"operationId": key, "state": "pending", "result": None}
        return await asyncio.shield(task)

    async def _execute(self, key: str, action: str, body: dict) -> dict:
        dispatched = False

        async def dispatch() -> dict:
            nonlocal dispatched
            dispatched = True
            logger.info(
                "operation dispatch action=%s id=%s thread=%s",
                action,
                key,
                body.get("threadId", "-"),
            )
            return await asyncio.wait_for(self.dispatch(action, body), DISPATCH_TIMEOUT)

        try:
            if action in ("respond", "interrupt"):
                result = await dispatch()
            else:
                lock = self.locks[body.get("threadId", "create")]
                await asyncio.wait_for(lock.acquire(), QUEUE_TIMEOUT)
                try:
                    result = await dispatch()
                finally:
                    lock.release()
            receipt = self.store.finish(key, "succeeded", result)
        except asyncio.TimeoutError:
            receipt = self.store.finish(
                key,
                "uncertain" if dispatched else "failed",
                {
                    "message": "操作结果超时未确认，请核对会话；不会自动重发。"
                    if dispatched
                    else "此会话的前一操作仍未完成，本次操作未执行，请稍后重试。"
                },
            )
        except asyncio.CancelledError:
            self.store.finish(
                key,
                "uncertain" if dispatched else "failed",
                {
                    "message": "服务已停止，操作结果待确认。"
                    if dispatched
                    else "服务已停止，本次排队操作未执行。",
                },
            )
            raise
        except (ValueError, FileNotFoundError) as exc:
            receipt = self.store.finish(key, "failed", {"message": str(exc)})
        except Exception as exc:  # noqa: BLE001 - contain transport failures and uncertain submissions
            # A protocol rejection is definite. Transport failure may have followed execution.
            definite = isinstance(exc, JsonRpcError)
            receipt = self.store.finish(
                key, "failed" if definite else "uncertain", {"message": str(exc)[:1500]}
            )
        logger.info(
            "operation action=%s id=%s thread=%s state=%s",
            action,
            key,
            body.get("threadId") or (receipt.get("result") or {}).get("threadId", "-"),
            receipt["state"],
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
