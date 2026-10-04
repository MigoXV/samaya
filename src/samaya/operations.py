"""Durable operation identities, per-thread serialization and HTTP-independent work."""

import asyncio
from collections import defaultdict
from collections.abc import Awaitable, Callable

from openai_codex.errors import JsonRpcError

from samaya.store import Store


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
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return await asyncio.shield(task)

    async def _execute(self, key: str, action: str, body: dict) -> dict:
        try:
            async with self.locks[body.get("threadId", "create")]:
                result = await self.dispatch(action, body)
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
