from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from openai_codex.errors import JsonRpcError

from samaya.sessions.queries import SessionQueries
from samaya.store import Store


@pytest.fixture
def queries(tmp_path):
    store = Store(tmp_path)
    connection = SimpleNamespace(connection_id="generation-1", rpc=AsyncMock())
    result = SessionQueries(connection, store, SimpleNamespace(pending={}, progress={}))
    yield result
    store.close()


@pytest.mark.asyncio
async def test_legacy_turn_pagination_falls_back_only_on_unsupported_method(queries):
    turns = [{"id": str(n), "items": [], "status": "completed"} for n in range(3)]
    calls = []

    async def rpc(method, params):
        calls.append(method)
        if method == "thread/turns/list":
            raise JsonRpcError(-32601, "list_turns is not supported yet")
        assert method == "thread/read"
        return {
            "thread": {
                "id": "t",
                "historyMode": "legacy",
                "turns": turns if params["includeTurns"] else [],
            }
        }

    queries.connection.rpc.side_effect = rpc
    first = await queries.turns("t", limit=2)
    assert [t["id"] for t in first["data"]] == ["2", "1"]
    second = await queries.turns("t", first["nextCursor"], limit=2)
    assert [t["id"] for t in second["data"]] == ["0"]
    assert second["nextCursor"] is None
    assert calls.count("thread/turns/list") == 1
    with pytest.raises(ValueError, match="游标"):
        await queries.turns("t", "legacy:-1")
    queries.connection.connection_id = "generation-2"
    await queries.turns("t", limit=1)
    assert calls.count("thread/turns/list") == 2


@pytest.mark.asyncio
async def test_non_capability_failure_is_not_hidden(queries):
    async def rpc(method, params):
        if method == "thread/read":
            return {"thread": {"id": "t", "historyMode": "legacy"}}
        raise JsonRpcError(-32603, "storage unavailable")

    queries.connection.rpc.side_effect = rpc
    with pytest.raises(JsonRpcError, match="storage unavailable"):
        await queries.turns("t")
    assert not queries.legacy_turns


@pytest.mark.asyncio
async def test_history_is_blocked_only_after_both_native_interfaces_reject(
    queries,
):
    async def rpc(method, params):
        if method in ("thread/turns/list", "thread/items/list") or params.get(
            "includeTurns"
        ):
            raise JsonRpcError(-32601, "list_turns is not supported yet")
        assert method == "thread/read"
        return {
            "thread": {
                "id": "t",
                "cwd": "/root",
                "historyMode": "paginated",
                "status": {"type": "idle"},
            }
        }

    queries.connection.rpc.side_effect = rpc
    summary = await queries.read("t", include_turns=False)
    assert summary["thread"].get("historyAvailable") is not False
    result = await queries.read("t")
    assert result["thread"]["status"]["type"] == "idle"
    assert result["thread"].get("canAcceptDirectInput") is not False
    assert result["historyAvailable"] is False
    page = await queries.turns("t")
    assert page["historyAvailable"] is False
    assert "自动重试" in page["historyNotice"]
    with pytest.raises(ValueError, match="历史暂时不可用"):
        await queries.idle("t")
    with pytest.raises(ValueError, match="历史暂时不可用"):
        await queries.items("t", "turn")


@pytest.mark.asyncio
async def test_native_creation_sends_first_turn_without_resuming_missing_rollout(
    queries,
):
    from samaya.config import Settings
    from samaya.sessions.actions import SessionActions

    resume = AsyncMock(
        side_effect=JsonRpcError(-32600, "no rollout found for thread id created")
    )
    queries.connection.connected = lambda: SimpleNamespace(
        sdk=SimpleNamespace(thread_resume=resume)
    )
    thread = {
        "id": "created",
        "cwd": "/root",
        "historyMode": "paginated",
        "status": {"type": "idle"},
        "preview": "",
        "turns": [],
    }

    async def rpc(method, params):
        if method == "thread/start":
            assert params["historyMode"] == "paginated"
            assert params["threadSource"] == "user" and params["ephemeral"] is False
            return {"thread": dict(thread), "model": "native-model"}
        if method == "thread/read":
            assert params["includeTurns"] is False
            return {"thread": dict(thread)}
        if method == "thread/settings/update":
            return {}
        assert method == "turn/start"
        return {"turn": {"id": "first", "status": "inProgress"}}

    queries.connection.rpc.side_effect = rpc
    actions = SessionActions(Settings(), queries.connection, queries.store, queries)
    actions.catalog = SimpleNamespace(
        inputs=AsyncMock(return_value=[{"type": "text", "text": "hello"}])
    )
    result = await actions.execute("create", {"cwd": "/root"})
    assert result == {"threadId": "created"}
    assert "created" in queries.store.watched()
    assert (await queries.read("created", subscribe=True))["thread"]["turns"] == []
    assert (await queries.turns("created"))["data"] == []
    assert (await queries.settings("created", refresh=True))["model"] == "native-model"
    assert (
        await actions.execute(
            "send", {"threadId": "created", "text": "hello", "expectedTurnId": None}
        )
    )["turn"]["id"] == "first"
    resume.assert_not_awaited()
    assert not queries.fresh_threads
    queries.observe_settings(
        {"method": "turn/started", "params": {"threadId": "created"}}
    )
    assert not queries.fresh_threads


@pytest.mark.asyncio
async def test_history_failure_retries_original_session_after_short_delay(queries):
    recovered = False

    async def rpc(method, params):
        if method == "thread/turns/list" or params.get("includeTurns"):
            if not recovered:
                raise JsonRpcError(-32601, "list_turns is not supported yet")
            return (
                {"data": [], "nextCursor": None}
                if method == "thread/turns/list"
                else {"thread": {"id": "t", "turns": [{"id": "original"}]}}
            )
        return {"thread": {"id": "t", "status": {"type": "idle"}}}

    queries.connection.rpc.side_effect = rpc
    assert (await queries.turns("t"))["historyAvailable"] is False
    recovered = True
    queries.unavailable_history[("generation-1", "t")] = 1
    result = await queries.read("t")
    assert result["thread"]["turns"][0]["id"] == "original"
    assert result["thread"].get("historyAvailable") is not False
    assert not queries.unavailable_history
    assert not queries.legacy_turns


@pytest.mark.asyncio
async def test_fresh_thread_is_not_assumed_empty_after_cli_update_or_reconnect(queries):
    queries.created({"thread": {"id": "fresh"}})
    assert not queries.is_fresh({"id": "fresh", "status": {"type": "active"}})
    assert not queries.fresh_threads
    queries.created({"thread": {"id": "fresh"}})
    queries.connection.connection_id = "generation-2"
    assert not queries.is_fresh({"id": "fresh", "status": {"type": "idle"}})


@pytest.mark.asyncio
async def test_cli_paginated_session_can_read_resume_and_send(queries):
    from samaya.config import Settings
    from samaya.sessions.actions import SessionActions
    from samaya.sessions.models import normalize

    thread = {
        "id": "cli",
        "cwd": "/root",
        "historyMode": "paginated",
        "source": "cli",
        "status": {"type": "idle"},
        "turns": [{"id": "previous", "status": "completed", "items": []}],
    }
    assert normalize(dict(thread)).get("canAcceptDirectInput") is not False
    resume = AsyncMock()
    queries.connection.connected = lambda: SimpleNamespace(
        sdk=SimpleNamespace(thread_resume=resume)
    )

    async def rpc(method, params):
        if method == "thread/read":
            return {
                "thread": {
                    **thread,
                    "turns": thread["turns"] if params["includeTurns"] else [],
                }
            }
        if method == "thread/turns/list":
            return {"data": thread["turns"], "nextCursor": None}
        assert method == "turn/start"
        return {"turn": {"id": "new", "status": "inProgress"}}

    queries.connection.rpc.side_effect = rpc
    result = await queries.read("cli", subscribe=True)
    assert result["thread"]["turns"][0]["id"] == "previous"
    assert result["thread"].get("historyAvailable") is not False
    assert (await queries.turns("cli"))["data"][0]["id"] == "previous"
    actions = SessionActions(Settings(), queries.connection, queries.store, queries)
    actions.catalog = SimpleNamespace(
        inputs=AsyncMock(return_value=[{"type": "text", "text": "continue"}])
    )
    sent = await actions.execute(
        "send", {"threadId": "cli", "text": "continue", "expectedTurnId": "previous"}
    )
    assert sent["turn"]["id"] == "new"
    assert resume.await_count == 2
    queries.connection.rpc.reset_mock()
    with pytest.raises(ValueError, match="其他客户端已更新"):
        await actions.execute(
            "send", {"threadId": "cli", "text": "stale", "expectedTurnId": None}
        )
    assert all(
        call.args[0] != "turn/start" for call in queries.connection.rpc.call_args_list
    )


@pytest.mark.asyncio
async def test_full_history_rejection_uses_supported_paginated_history(queries):
    async def rpc(method, params):
        if method == "thread/read":
            if params["includeTurns"]:
                raise JsonRpcError(-32601, "full history unavailable")
            return {
                "thread": {
                    "id": "cli",
                    "historyMode": "paginated",
                    "status": {"type": "idle"},
                }
            }
        assert method == "thread/turns/list" and params["itemsView"] == "full"
        return {
            "data": [{"id": "turn", "status": "completed", "items": []}],
            "nextCursor": None,
        }

    queries.connection.rpc.side_effect = rpc
    result = await queries.read("cli")
    assert result["thread"]["turns"][0]["id"] == "turn"
    assert not queries.unavailable_history
    await queries.require_history("cli")


@pytest.mark.asyncio
async def test_control_read_uses_only_latest_summary_and_never_full_history(queries):
    async def rpc(method, params):
        if method == "thread/read":
            assert params["includeTurns"] is False
            return {"thread": {"id": "t", "cwd": "/tmp", "status": {"type": "active"}}}
        assert method == "thread/turns/list"
        assert params == {
            "threadId": "t",
            "cursor": None,
            "limit": 1,
            "sortDirection": "desc",
            "itemsView": "summary",
        }
        return {"data": [{"id": "latest", "status": "inProgress"}]}

    queries.connection.rpc.side_effect = rpc
    result = await queries.read("t", latest_only=True)
    assert result["thread"]["turns"] == [{"id": "latest", "status": "inProgress"}]
    assert queries.connection.rpc.await_count == 2


@pytest.mark.asyncio
async def test_control_read_does_not_hide_native_failures(queries):
    async def rpc(method, params):
        if method == "thread/read":
            return {"thread": {"id": "t", "status": {"type": "idle"}}}
        raise ConnectionError("offline")

    queries.connection.rpc.side_effect = rpc
    with pytest.raises(ConnectionError, match="offline"):
        await queries.read("t", latest_only=True)
    assert queries.connection.rpc.await_count == 2
