import asyncio
import json

import pytest
from websockets.asyncio.server import unix_serve
from websockets.exceptions import ConnectionClosed

from samaya.codex.adapter import Adapter


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "method,result",
    [
        ("item/commandExecution/requestApproval", {"decision": "cancel"}),
        ("mcpServer/elicitation/request", {"action": "cancel", "content": None}),
    ],
)
async def test_sdk_bridge_never_auto_accepts_server_request(tmp_path, method, result):
    response_received = asyncio.Event()
    responses = []

    async def daemon(ws):
        try:
            async for raw in ws:
                message = json.loads(raw)
                if message.get("method") == "initialize":
                    await ws.send(
                        json.dumps(
                            {
                                "id": message["id"],
                                "result": {"userAgent": "codex/0.160.0"},
                            }
                        )
                    )
                elif message.get("method") == "initialized":
                    await ws.send(
                        json.dumps(
                            {
                                "id": 7,
                                "method": method,
                                "params": {
                                    "threadId": "test",
                                    "turnId": "one",
                                    "command": "echo approval",
                                },
                            }
                        )
                    )
                elif message.get("id") == 7 and "result" in message:
                    responses.append(message)
                    response_received.set()
        except ConnectionClosed:
            pass

    socket = str(tmp_path / "daemon.sock")
    async with unix_serve(daemon, socket):
        adapter = Adapter(socket)
        try:
            await adapter.start()
            event = await asyncio.wait_for(adapter.event(), 5)
            assert event["id"] == 7 and event["method"] == method
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(response_received.wait(), 0.1)
            sent = await adapter.request(
                "samaya/serverRequest/respond",
                {"id": 7, "result": result},
            )
            await asyncio.wait_for(response_received.wait(), 5)
            assert sent == {"sent": True}
            assert responses == [{"id": 7, "result": result}]
        finally:
            await adapter.close()


@pytest.mark.asyncio
async def test_bridge_accepts_large_history_and_keeps_connection(tmp_path):
    payload = "x" * (65 * 1024 * 1024)

    async def daemon(ws):
        try:
            async for raw in ws:
                message = json.loads(raw)
                if "id" not in message:
                    continue
                result = (
                    {"text": payload}
                    if message.get("method") == "thread/read"
                    else {"userAgent": "codex/0.160.0"}
                )
                await ws.send(json.dumps({"id": message["id"], "result": result}))
        except ConnectionClosed:
            pass

    socket = str(tmp_path / "large.sock")
    async with unix_serve(daemon, socket):
        adapter = Adapter(socket)
        try:
            await adapter.start()
            result = await asyncio.wait_for(adapter.request("thread/read", {}), 30)
            assert result["text"] == payload
            assert await adapter.request("ping", {}) == {"userAgent": "codex/0.160.0"}
        finally:
            await adapter.close()
