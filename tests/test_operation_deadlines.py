import asyncio
from unittest.mock import AsyncMock

from samaya.operations import Operations
from samaya.store import Store


async def test_queued_operation_times_out_without_dispatch_or_replay(
    tmp_path, monkeypatch
):
    monkeypatch.setattr("samaya.operations.QUEUE_TIMEOUT", 0.02)
    store = Store(tmp_path)
    dispatch = AsyncMock(return_value={})
    service = Operations(store, dispatch, AsyncMock())
    body = {"threadId": "t", "text": "keep draft", "expectedTurnId": None}
    await service.locks["t"].acquire()
    try:
        receipt = await service.execute("queued", "send", body)
        assert receipt["state"] == "failed"
        assert "未执行" in receipt["result"]["message"]
        dispatch.assert_not_awaited()
        service.locks["t"].release()
        assert await service.execute("queued", "send", body) == receipt
        dispatch.assert_not_awaited()
        assert (await service.execute("next", "send", body))["state"] == "succeeded"
    finally:
        await service.close()
        store.close()


async def test_dispatch_deadline_is_uncertain_releases_lock_and_never_replays(
    tmp_path, monkeypatch
):
    monkeypatch.setattr("samaya.operations.DISPATCH_TIMEOUT", 0.02)
    store = Store(tmp_path)

    async def stuck(action, body):
        await asyncio.Event().wait()

    dispatch = AsyncMock(side_effect=stuck)
    service = Operations(store, dispatch, AsyncMock())
    body = {"threadId": "t", "text": "once", "expectedTurnId": None}
    try:
        receipt = await service.execute("slow", "send", body)
        assert receipt["state"] == "uncertain"
        assert "超时" in receipt["result"]["message"]
        assert not service.locks["t"].locked()
        assert await service.execute("slow", "send", body) == receipt
        dispatch.assert_awaited_once()
        dispatch.side_effect = None
        dispatch.return_value = {}
        assert (await service.execute("next", "send", body))["state"] == "succeeded"
    finally:
        await service.close()
        store.close()


async def test_shutdown_distinguishes_dispatched_and_queued_operations(tmp_path):
    store = Store(tmp_path)
    started = asyncio.Event()

    async def stuck(action, body):
        started.set()
        await asyncio.Event().wait()

    service = Operations(store, stuck, AsyncMock())
    body = {"threadId": "t", "text": "once", "expectedTurnId": None}
    try:
        await service.execute("active", "send", body, wait=False)
        await started.wait()
        await service.execute("queued", "send", body, wait=False)
        await asyncio.sleep(0)
        await service.close()
        assert store.receipt("active")["state"] == "uncertain"
        assert store.receipt("queued")["state"] == "failed"
    finally:
        store.close()
