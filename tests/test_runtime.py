"""Composition regressions: reconnect, request ownership and orderly shutdown."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from samaya.config import Settings
from samaya.runtime import Runtime
from samaya.store import Store


async def eventually(predicate):
    async def wait():
        while not predicate():
            await asyncio.sleep(0.01)

    await asyncio.wait_for(wait(), 6)


async def test_reconnect_preserves_observation_but_invalidates_old_decisions(
    tmp_path, monkeypatch
):
    adapters, calls = [], []

    class Adapter:
        def __init__(self, socket):
            self.events = asyncio.Queue()
            self.closed = False
            self.sdk = SimpleNamespace(
                metadata=SimpleNamespace(model_dump=lambda **kw: {"test": True}),
                thread_list=AsyncMock(
                    return_value=SimpleNamespace(model_dump=lambda **kw: {"data": []})
                ),
                thread_resume=AsyncMock(),
            )
            adapters.append(self)

        async def start(self):
            pass

        async def close(self):
            self.closed = True

        async def request(self, method, params):
            calls.append((method, params))
            if method == "thread/loaded/list":
                return {"data": ["watched"]}
            if method == "thread/read":
                return {"thread": {"id": "watched", "status": {"type": "idle"}}}
            if method == "samaya/serverRequest/respond":
                return {"sent": True}
            return {"data": []}

        async def event(self):
            value = await self.events.get()
            if isinstance(value, Exception):
                raise value
            return value

    monkeypatch.setattr("samaya.codex.connection.Adapter", Adapter)
    store = Store(tmp_path)
    store.watch("watched")
    store.watch("unloaded")
    runtime = Runtime(Settings(data_dir=tmp_path), store)
    request = {
        "id": 7,
        "method": "item/commandExecution/requestApproval",
        "params": {"threadId": "watched", "turnId": "one", "command": "echo test"},
    }
    try:
        await runtime.start()
        await eventually(lambda: runtime.monitor.initialized)
        assert runtime.sessions.connection is runtime.connection
        assert runtime.actions.connection is runtime.connection
        assert runtime.decisions.connection is runtime.connection
        assert runtime.monitor.connection is runtime.connection
        await adapters[0].events.put(request)
        await eventually(lambda: bool(runtime.decisions.pending))
        old_key = next(iter(runtime.decisions.pending))
        await adapters[0].events.put(ConnectionError("test disconnect"))
        await eventually(lambda: runtime.connection.state == "disconnected")
        assert not runtime.decisions.pending
        observed = runtime.monitor.snapshot()["records"][0]
        assert observed["requestsUnknown"] == 1
        assert observed["error"]
        await eventually(lambda: runtime.connection.generation == 2)
        await adapters[1].events.put(request)
        await eventually(lambda: bool(runtime.decisions.pending))
        new_key = next(iter(runtime.decisions.pending))
        assert old_key != new_key
        response = {
            "threadId": "watched",
            "requestKey": old_key,
            "response": {"decision": "cancel"},
        }
        stale = await runtime.operations.execute("old-key", "respond", response)
        assert stale["state"] == "failed"
        assert not any(method == "samaya/serverRequest/respond" for method, _ in calls)
        response["requestKey"] = new_key
        sent = await runtime.operations.execute("new-key", "respond", response)
        assert sent["state"] == "succeeded"
        assert runtime.decisions.pending[new_key]["responseState"] == "sent"
        await adapters[1].events.put(
            {
                "method": "serverRequest/resolved",
                "params": {"threadId": "watched", "requestId": 7},
            }
        )
        await eventually(lambda: not runtime.decisions.pending)
        for adapter in adapters:
            assert adapter.sdk.thread_resume.await_count >= 1
            assert all(
                call.args[0] == "watched"
                for call in adapter.sdk.thread_resume.await_args_list
            )
        assert not any(method in ("turn/start", "thread/start") for method, _ in calls)
    finally:
        await asyncio.wait_for(runtime.close(), 2)
        store.close()
    assert all(adapter.closed for adapter in adapters)
    assert runtime.connection.runner.done()
    assert all(task.done() for task in runtime.monitor.tasks)
    assert not runtime.operations.tasks
