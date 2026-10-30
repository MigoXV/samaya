"""Browser cancellation/backpressure must never stop native input delivery."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI

from samaya.config import Settings
from samaya.runtime import Runtime
from samaya.signals import ChangeSignal
from samaya.store import Store
from samaya.web.events import register_events


@pytest.fixture
def runtime(tmp_path):
    store = Store(tmp_path)
    service = Runtime(Settings(data_dir=tmp_path), store)
    service.connection.connection_id = "test-connection"
    service.connection.state = "connected"
    yield service
    store.close()


async def test_signal_broadcast_and_cancelled_waiter():
    signal = ChangeSignal()
    wake = signal.event
    first = asyncio.create_task(wake.wait())
    second = asyncio.create_task(wake.wait())
    first.cancel()
    await asyncio.gather(first, return_exceptions=True)
    signal.notify()
    assert await asyncio.wait_for(second, 1)
    assert wake.is_set()
    assert not signal.event.is_set()
    # A notification between the journal read and wait is not lost.
    assert await asyncio.wait_for(wake.wait(), 1)


class Browser:
    def __init__(self, response, *, slow=False):
        self.disconnect = asyncio.Event()
        self.started = asyncio.Event()
        self.blocked = asyncio.Event()
        self.chunks = []

        async def receive():
            await self.disconnect.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            if message["type"] == "http.response.body":
                body = message.get("body", b"").decode()
                self.chunks.append(body)
                self.started.set()
                if slow and "id:" in body:
                    self.blocked.set()
                    await asyncio.Event().wait()

        self.task = asyncio.create_task(
            response(
                {"type": "http", "asgi": {"spec_version": "2.0"}},
                receive,
                send,
            )
        )

    async def close(self):
        self.disconnect.set()
        await asyncio.wait_for(self.task, 1)


async def open_browser(runtime, *, after=0, slow=False):
    app = FastAPI()
    app.state.runtime = runtime
    app.state.store = runtime.store
    register_events(app)
    endpoint = next(r.endpoint for r in app.routes if r.path == "/api/events")
    response = await endpoint(
        SimpleNamespace(headers={}, is_disconnected=AsyncMock(return_value=False)),
        after=after,
    )
    browser = Browser(response, slow=slow)
    await asyncio.wait_for(browser.started.wait(), 1)
    return browser


async def test_disconnected_and_slow_browsers_do_not_block_questions(runtime):
    browsers = []
    try:
        slow = await open_browser(runtime, slow=True)
        live = await open_browser(runtime)
        browsers.extend([slow, live])
        # Wake and cancel idle streams repeatedly, as navigation/refresh does.
        for _ in range(12):
            leaving = await open_browser(runtime, after=runtime.store.cursor())
            await asyncio.sleep(0)
            runtime.changed.notify()
            await leaving.close()
        await asyncio.wait_for(
            runtime.receive({"method": "test/activity", "params": {}}), 1
        )
        await asyncio.wait_for(slow.blocked.wait(), 1)
        question = {
            "method": "item/tool/requestUserInput",
            "id": 24,
            "params": {
                "threadId": "thread-one",
                "turnId": "turn-one",
                "itemId": "question-one",
                "questions": [{"id": "scope", "question": "处理哪些范围？"}],
            },
        }
        await asyncio.wait_for(runtime.receive(question), 1)
        assert next(iter(runtime.decisions.pending.values()))["id"] == 24

        async def wait_for_question():
            while not any('"id": 24' in chunk for chunk in live.chunks):
                await asyncio.sleep(0.001)

        await asyncio.wait_for(wait_for_question(), 1)
        await slow.close()
        browsers.remove(slow)
        # Reopening gets the authoritative snapshot and replays the question.
        replay = await open_browser(runtime)
        browsers.append(replay)
        assert any('"id": 24' in chunk for chunk in replay.chunks)
        await asyncio.wait_for(
            runtime.receive({"method": "test/follow-up", "params": {}}), 1
        )
    finally:
        for browser in browsers:
            await browser.close()


def test_global_mode_update_omits_settings_and_instructions():
    from samaya.web.events import scoped_event

    event = {
        "method": "thread/settings/updated",
        "params": {
            "threadId": "a",
            "threadSettings": {
                "collaborationMode": {
                    "mode": "default",
                    "settings": {"developer_instructions": "private"},
                },
                "cwd": "/private",
            },
        },
    }
    assert scoped_event(event, "global", None, None) == {
        "method": event["method"],
        "params": {"threadId": "a", "mode": "default"},
    }
