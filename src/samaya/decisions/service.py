"""Live approval/input requests; wire-send receipts do not imply resolution."""

import json
from collections.abc import Awaitable, Callable

from openai_codex.errors import JsonRpcError

from samaya.codex.connection import Connection

from . import mcp


class Decisions:
    def __init__(
        self, connection: Connection, publish: Callable[[dict], Awaitable[None]]
    ):
        self.connection, self.publish = connection, publish
        self.pending: dict[str, dict] = {}
        self.progress: dict[tuple[str, str], str] = {}

    def disconnect(self) -> None:
        self.pending.clear()
        self.progress.clear()

    def observe(self, event: dict) -> None:
        method, params = event.get("method", ""), event.get("params", {})
        if method == "item/mcpToolCall/progress":
            self.progress[(params["threadId"], params["itemId"])] = params["message"][
                -6000:
            ]
            if len(self.progress) > 200:
                self.progress.pop(next(iter(self.progress)))
        elif method == "item/completed":
            self.progress.pop((params["threadId"], params["item"]["id"]), None)
        if "id" in event:
            key = f"{self.connection.connection_id}:{json.dumps(event['id'])}"
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

    async def respond(self, b: dict) -> dict:
        self.connection.connected()
        tid = b["threadId"]
        request = self.pending.get(b["requestKey"])
        if not request or request.get("params", {}).get("threadId") != tid:
            raise ValueError("请求已经处理或连接已变化；请刷新会话")
        if request.get("responseState") in ("submitting", "sent", "uncertain"):
            raise ValueError("此请求已经提交，结果尚未确认；请勿再次提交")
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
            response = await self.connection.rpc(
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
