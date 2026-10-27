import json

from samaya.store import Store
from samaya.web.events import scoped_event


def test_catalog_events_are_small_and_migration_preserves_ids(tmp_path):
    store = Store(tmp_path)
    try:
        event = {"method": "app/list/updated", "params": {"data": "x" * 1_000_000}}
        first = store.event(event)
        assert len(json.dumps(store.events(0))) < 200
        store.db.execute(
            "INSERT INTO events(payload,created) VALUES(?,0)", (json.dumps(event),)
        )
        store.db.commit()
        head = store.cursor()
        assert len(json.dumps(store.events(0))) < 400
        assert store.compact_catalog_events()
        assert not store.compact_catalog_events()
        assert store.cursor() == head
        assert store.event_floor() == first
    finally:
        store.close()


def test_catalog_name_in_message_is_not_mistaken_for_catalog_event(tmp_path):
    store = Store(tmp_path)
    try:
        event = {
            "method": "item/agentMessage/delta",
            "params": {"delta": "app/list/updated"},
        }
        store.event(event)
        assert store.events(0)[0]["data"] == event
    finally:
        store.close()


def test_event_scopes_keep_completions_and_isolate_other_threads():
    event = {
        "method": "turn/completed",
        "params": {
            "threadId": "a",
            "turn": {"id": "t", "status": "completed", "items": ["private-body"]},
        },
    }
    result = scoped_event(event, "global", None, None)
    assert result["params"]["turn"] == {"id": "t", "status": "completed"}
    assert scoped_event(event, "thread", "b", "t") is None
    assert scoped_event(event, "thread", "a", "old") is None
    assert scoped_event(event, "thread", "a", "t") == event
    assert (
        scoped_event({"method": "item/agentMessage/delta"}, "global", None, None)
        is None
    )
    receipt = {
        "method": "samaya/operation",
        "params": {"operationId": "x", "state": "succeeded"},
    }
    assert scoped_event(receipt, "global", None, None) == receipt


def test_monitor_summary_removes_nested_bodies_without_changing_history():
    from samaya.monitoring.projection import Projection

    body = "x" * 2_000_000
    record = {
        "thread": {"id": "a", "cwd": "/demo", "preview": body, "turns": [body]},
        "turn": {
            "id": "t",
            "status": "completed",
            "items": [
                {
                    "id": "u",
                    "type": "userMessage",
                    "content": [{"type": "image", "url": body}],
                },
                {"id": "m", "type": "mcpToolCall", "result": {"content": body}},
                {"id": "a", "type": "agentMessage", "text": body},
                {"id": "f", "type": "fileChange", "changes": [{"diff": body}]},
            ],
        },
        "terminals": [],
        "error": None,
    }
    summary = Projection.summary_record(record)
    assert len(json.dumps(summary)) < 2000
    assert summary["turn"]["items"][-1]["changeCount"] == 1
    assert Projection.summary_record(summary) == summary
    assert len(record["turn"]["items"][2]["text"]) == 2_000_000
    assert summary["turn"]["items"][2]["summaryOnly"] is True


async def test_shared_cache_cancellation_invalidation_and_retry():
    import asyncio

    from samaya.cache import ReadCache

    cache = ReadCache()
    ready = asyncio.Event()
    calls = 0

    async def load():
        nonlocal calls
        calls += 1
        await ready.wait()
        return calls

    first = asyncio.create_task(cache.get("key", load))
    second = asyncio.create_task(cache.get("key", load))
    await asyncio.sleep(0.01)
    first.cancel()
    await asyncio.gather(first, return_exceptions=True)
    cache.invalidate()
    ready.set()
    assert await second == 1
    assert not cache.values  # stale completion must not repopulate the cache
    assert await cache.get("key", load) == 2
    assert await cache.get("key", load) == 2


async def test_first_stream_starts_at_head_and_expired_cursor_requests_snapshot(
    tmp_path,
):
    from types import SimpleNamespace

    from fastapi import FastAPI

    from samaya.signals import ChangeSignal
    from samaya.web.events import register_events

    store = Store(tmp_path)
    app = FastAPI()
    app.state.store = store
    app.state.runtime = SimpleNamespace(
        monitor=SimpleNamespace(revision=0, patches=[]), changed=ChangeSignal()
    )
    register_events(app)
    endpoint = next(r.endpoint for r in app.routes if r.path == "/api/events")

    async def connected():
        return False

    request = SimpleNamespace(headers={}, is_disconnected=connected)
    try:
        old = store.event(
            {"method": "samaya/operation", "params": {"operationId": "old"}}
        )
        response = await endpoint(request, scope="global")
        iterator = response.body_iterator
        assert f'"cursor": {old}' in await anext(iterator)
        store.event({"method": "samaya/operation", "params": {"operationId": "new"}})
        message = await anext(iterator)
        assert '"new"' in message and '"old"' not in message
        await iterator.aclose()
        store.db.execute("DELETE FROM events WHERE id=?", (old,))
        store.db.commit()
        response = await endpoint(request, after=0, scope="global")
        iterator = response.body_iterator
        await anext(iterator)
        assert "cursor-expired" in await anext(iterator)
        await iterator.aclose()
    finally:
        store.close()


def test_identical_app_notifications_do_not_invalidate_read_cache():
    from samaya.composer.catalog import InputCatalog

    catalog = InputCatalog(None, None, None)
    params = {"data": [{"id": "a", "name": "A", "isAccessible": True}]}
    catalog.observe_apps(params)
    revision = catalog.apps_cache.revision
    catalog.observe_apps(params)
    assert catalog.apps_cache.revision == revision
    params["data"][0]["isAccessible"] = False
    catalog.observe_apps(params)
    assert catalog.apps_cache.revision == revision + 1
    assert catalog.skills_cache.revision == 0


def test_global_turn_start_keeps_identity_without_history():
    event = {
        "method": "turn/started",
        "params": {
            "threadId": "a",
            "turn": {"id": "new", "status": "inProgress", "items": ["large-body"]},
        },
    }
    result = scoped_event(event, "global", None, None)
    assert result["params"] == {
        "threadId": "a",
        "turn": {"id": "new", "status": "inProgress"},
    }
