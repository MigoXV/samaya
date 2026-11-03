import asyncio
import json
from unittest.mock import AsyncMock, Mock

import pytest
from websockets.asyncio.server import unix_serve
from websockets.exceptions import ConnectionClosed

from samaya.codex.connection import Connection
from samaya.config import Settings


async def test_missing_rpc_response_reconnects_real_sdk_without_replay(
    tmp_path, monkeypatch
):
    monkeypatch.setattr("samaya.codex.connection.RPC_TIMEOUT", 0.1)
    monkeypatch.setattr("samaya.codex.connection.RECONNECT_DELAY", 0.01)
    requests = []
    connections = 0

    async def daemon(ws):
        nonlocal connections
        connections += 1
        generation = connections
        try:
            async for raw in ws:
                message = json.loads(raw)
                if message.get("method") == "initialize":
                    result = {"userAgent": "codex/0.163.0"}
                elif message.get("method") == "thread/read":
                    requests.append((generation, message["method"]))
                    if generation == 1:
                        continue
                    result = {"thread": {"id": "t"}}
                else:
                    continue
                await ws.send(json.dumps({"id": message["id"], "result": result}))
        except ConnectionClosed:
            pass

    socket = str(tmp_path / "daemon.sock")
    async with unix_serve(daemon, socket):
        connection = Connection(
            Settings(socket=socket), AsyncMock(), AsyncMock(), Mock()
        )
        await connection.start()
        try:
            await asyncio.wait_for(connection.ready.wait(), 5)
            with pytest.raises(ConnectionError, match="不会自动重发"):
                await connection.rpc("thread/read", {"threadId": "t"})

            async def reconnected():
                while connection.generation < 2 or connection.state != "connected":
                    await asyncio.sleep(0.01)

            await asyncio.wait_for(reconnected(), 5)
            assert requests == [(1, "thread/read")]
            assert await connection.rpc("thread/read", {"threadId": "t"}) == {
                "thread": {"id": "t"}
            }
            assert requests == [(1, "thread/read"), (2, "thread/read")]
        finally:
            await asyncio.wait_for(connection.close(), 5)


async def test_stale_timeout_cannot_close_replacement_connection(tmp_path, monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setattr("samaya.codex.connection.RPC_TIMEOUT", 0.02)
    connection = Connection(
        Settings(data_dir=tmp_path), AsyncMock(), AsyncMock(), Mock()
    )
    replacement = SimpleNamespace(close=AsyncMock())

    async def old_request(method, params):
        connection.adapter = replacement
        await asyncio.Event().wait()

    old = SimpleNamespace(request=AsyncMock(side_effect=old_request), close=AsyncMock())
    connection.adapter = old
    connection.state = "connected"
    with pytest.raises(ConnectionError):
        await connection.rpc("thread/read", {"threadId": "t"})
    replacement.close.assert_not_awaited()
    assert connection.state == "connected"
