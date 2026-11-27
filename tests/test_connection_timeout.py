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


@pytest.mark.parametrize("mode", ["timeout", "success", "cancel", "shutdown"])
@pytest.mark.parametrize(
    "read_method,timeout_setting,error",
    [
        ("app/list", "APP_LIST_TIMEOUT", "应用目录查询超时"),
        ("account/usage/read", "USAGE_HISTORY_TIMEOUT", "历史用量读取超时"),
    ],
)
async def test_optional_read_isolated_from_live_connection(
    tmp_path, monkeypatch, mode, read_method, timeout_setting, error
):
    requests = []
    sockets = []
    catalog_requested = asyncio.Event()

    async def daemon(ws):
        sockets.append(ws)
        try:
            async for raw in ws:
                message = json.loads(raw)
                method = message.get("method")
                if method == "initialize":
                    result = {"userAgent": "codex/0.163.0"}
                elif method == read_method:
                    requests.append((ws, method))
                    catalog_requested.set()
                    if mode != "success":
                        continue
                    result = {"data": [], "nextCursor": None}
                elif method == "thread/loaded/list":
                    requests.append((ws, method))
                    result = {"data": []}
                else:
                    continue
                await ws.send(json.dumps({"id": message["id"], "result": result}))
        except ConnectionClosed:
            pass

    socket = str(tmp_path / "daemon.sock")
    async with unix_serve(daemon, socket):
        disconnected = Mock()
        connection = Connection(
            Settings(socket=socket), AsyncMock(), AsyncMock(), disconnected
        )
        await connection.start()
        try:
            await asyncio.wait_for(connection.ready.wait(), 5)
            # Allow process startup time; timeout must happen after catalog dispatch.
            monkeypatch.setattr(f"samaya.codex.connection.{timeout_setting}", 2)
            pending = asyncio.create_task(connection.rpc(read_method, {}))
            await asyncio.wait_for(catalog_requested.wait(), 5)
            assert await connection.rpc("thread/loaded/list", {"limit": 1}) == {
                "data": []
            }
            if mode == "success":
                assert await pending == {"data": [], "nextCursor": None}
            elif mode == "timeout":
                with pytest.raises(ConnectionError, match=error):
                    await pending
            elif mode == "cancel":
                pending.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await pending
            else:
                await connection.close()
                with pytest.raises(asyncio.CancelledError):
                    await pending
            if mode != "shutdown":
                assert await connection.rpc("thread/loaded/list", {"limit": 1}) == {
                    "data": []
                }
                assert connection.generation == 1
                assert connection.state == "connected"
                disconnected.assert_not_called()
            assert requests[0][0] is not requests[1][0]
            assert not connection.isolated_tasks
            await asyncio.wait_for(sockets[1].wait_closed(), 3)
        finally:
            await asyncio.wait_for(connection.close(), 5)
