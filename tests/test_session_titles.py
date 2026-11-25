import asyncio
from unittest.mock import AsyncMock, Mock

import pytest

from samaya.codex.title_generation import TITLE_THREAD_SOURCE
from samaya.config import Settings
from samaya.runtime import Runtime
from samaya.sessions import titles
from samaya.store import Store


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    store = Store(tmp_path)
    service = Runtime(Settings(data_dir=tmp_path), store)
    service.connection.state = "connected"
    service.connection.adapter = object()
    title_adapter = Mock(start=AsyncMock(), close=AsyncMock(), request=AsyncMock())
    monkeypatch.setattr(titles, "Adapter", lambda _socket: title_adapter)
    yield service, title_adapter
    store.close()


async def test_confirmed_first_send_returns_without_waiting_for_title(
    runtime, tmp_path, monkeypatch
):
    service, adapter = runtime
    first = {"id": "new", "cwd": str(tmp_path), "turns": []}
    service.connection.rpc = AsyncMock(
        side_effect=[
            {"thread": first},
            RuntimeError("send was not confirmed"),
            {"turn": {"id": "first"}},
            {"turn": {"id": "second"}},
        ]
    )
    service.sessions.join = AsyncMock()
    service.sessions.idle = AsyncMock(return_value=first)
    service.catalog.inputs = AsyncMock(
        return_value=[{"type": "text", "text": "检查侧栏"}]
    )

    await service.dispatch("create", {"cwd": str(tmp_path)})
    body = {"threadId": "new", "expectedTurnId": None, "text": "检查侧栏"}
    with pytest.raises(RuntimeError, match="was not confirmed"):
        await service.dispatch("send", body)
    assert service.titles.queue.empty()

    started, finish = asyncio.Event(), asyncio.Event()

    async def generate(_socket, _thread, text, _hide):
        assert text == body["text"]
        started.set()
        await finish.wait()
        return "检查会话侧栏"

    generator = AsyncMock(side_effect=generate)
    monkeypatch.setattr(titles, "generate_title", generator)
    adapter.request.side_effect = [{"thread": first}, {}]
    service.titles.start()
    try:
        assert await service.dispatch("send", body) == {"turn": {"id": "first"}}
        await asyncio.wait_for(started.wait(), 1)
        assert not finish.is_set()
        await service.dispatch("send", body)
        finish.set()
        await asyncio.wait_for(service.titles.queue.join(), 1)
    finally:
        await service.titles.close()

    generator.assert_awaited_once()
    adapter.request.assert_awaited_with(
        "thread/name/set", {"threadId": "new", "name": "检查会话侧栏"}
    )
    assert "new" in service.monitor.projection.refresh_queue


async def test_named_existing_or_attachment_only_sessions_do_not_start_a_title(
    runtime, tmp_path
):
    service, _ = runtime
    service.connection.rpc = AsyncMock(
        side_effect=[
            {"thread": {"id": "named"}},
            {},
            {"thread": {"id": "new"}},
        ]
    )
    await service.dispatch("create", {"cwd": str(tmp_path), "name": "自定义"})
    await service.dispatch("create", {"cwd": str(tmp_path)})
    service.titles.enqueue({"id": "new"}, "  ")
    service.titles.enqueue({"id": "named"}, "重新命名？")
    service.titles.enqueue({"id": "old"}, "旧会话")
    assert service.titles.queue.empty()
    assert service.store.claim_title("new")


async def test_manual_rename_during_generation_wins(runtime, monkeypatch, tmp_path):
    service, adapter = runtime

    async def generate(*_args):
        await service.receive(
            {
                "method": "thread/name/updated",
                "params": {"threadId": "new", "threadName": "手动标题"},
            }
        )
        return "自动标题"

    monkeypatch.setattr(titles, "generate_title", generate)
    service.titles.register("new")
    service.titles.enqueue({"id": "new", "cwd": str(tmp_path)}, "检查更新")
    service.titles.start()
    try:
        await asyncio.wait_for(service.titles.queue.join(), 1)
    finally:
        await service.titles.close()
    adapter.start.assert_not_awaited()


@pytest.mark.parametrize("native_name", [None, "外部手动标题"])
async def test_failed_generation_saves_fallback_only_if_still_unnamed(
    runtime, monkeypatch, native_name
):
    service, adapter = runtime
    monkeypatch.setattr(titles, "generate_title", AsyncMock(side_effect=ValueError))
    adapter.request.side_effect = [{"thread": {"name": native_name}}, {}]
    await service.titles.apply(titles.TitleJob({"id": "t"}, "# 调整侧栏"))
    if native_name:
        assert adapter.request.await_count == 1
    else:
        adapter.request.assert_awaited_with(
            "thread/name/set", {"threadId": "t", "name": "调整侧栏"}
        )
    adapter.close.assert_awaited_once()


async def test_helper_is_hidden_and_name_event_updates_only_the_name(runtime):
    service, _ = runtime
    projection = service.monitor.projection
    row = {
        "thread": {"id": "visible", "preview": "首条请求"},
        "turn": None,
        "eventAt": 42,
    }
    projection.records["visible"] = row
    helper = {"id": "hidden", "ephemeral": True, "threadSource": TITLE_THREAD_SOURCE}
    await service.receive({"method": "thread/started", "params": {"thread": helper}})
    await service.receive(
        {"method": "item/completed", "params": {"threadId": "hidden"}}
    )
    assert service.store.cursor() == 0
    service.connection.rpc = AsyncMock(return_value={"thread": helper})
    await service.monitor.refresh("hidden")
    service.connection.rpc.assert_awaited_once_with(
        "thread/read", {"threadId": "hidden", "includeTurns": False}
    )
    assert "hidden" not in projection.records

    await service.receive(
        {
            "method": "thread/name/updated",
            "params": {
                "threadId": "visible",
                "threadName": "任务标题",
            },
        }
    )
    assert projection.records["visible"] == {
        **row,
        "thread": {**row["thread"], "name": "任务标题"},
    }
    assert service.store.activities() == {}


def test_new_thread_eligibility_survives_restart_once(tmp_path):
    store = Store(tmp_path)
    store.allow_title("new")
    store.close()
    store = Store(tmp_path)
    try:
        assert store.claim_title("new")
        assert not store.claim_title("new")
        assert not store.claim_title("legacy")
    finally:
        store.close()
