import asyncio
import copy
from unittest.mock import AsyncMock

import pytest

from samaya.codex.service import CodexService
from samaya.config import Settings
from samaya.store import Store


@pytest.fixture
def service(tmp_path):
    store = Store(tmp_path)
    s = CodexService(Settings(data_dir=tmp_path, roots=[tmp_path]), store)
    s.connection = "connected"
    s.generation = 1
    s.connection_id = "connection-one"
    s.adapter = object()
    yield s
    store.close()


def record(turn="current", status="inProgress"):
    return {
        "thread": {
            "id": "a",
            "cwd": "/demo",
            "status": {"type": "active"},
            "updatedAt": 1,
        },
        "turn": {"id": turn, "status": status, "items": []},
        "terminals": [],
        "confirmedAt": 1,
        "progressAt": 1,
        "error": None,
    }


def test_old_turn_events_cannot_resurrect_completed_task(service):
    m = service.monitor
    m.records["a"] = record(status="completed")
    before = copy.deepcopy(m.records["a"])
    for turn in ["old", "current"]:
        m.event(
            {
                "method": "turn/started",
                "params": {
                    "threadId": "a",
                    "turn": {"id": turn, "status": "inProgress", "items": []},
                },
            }
        )
    m.event(
        {
            "method": "thread/status/changed",
            "params": {"threadId": "a", "status": {"type": "active"}},
        }
    )
    assert m.records["a"] == before


def test_duplicate_completion_has_one_change(service):
    m = service.monitor
    m.records["a"] = record()
    event = {
        "method": "turn/completed",
        "params": {
            "threadId": "a",
            "turn": {"id": "current", "status": "completed", "items": []},
        },
    }
    m.event(event)
    m.event(event)
    assert len(m.changes) == 1
    assert m.records["a"]["turn"]["status"] == "completed"


def test_disconnect_preserves_execution_and_unknown_request(service):
    m = service.monitor
    m.records["a"] = record()
    service.pending["private"] = {
        "params": {"threadId": "a", "secret": "not journaled"}
    }
    service.connection = "disconnected"
    m.event({"method": "samaya/connection"})
    assert m.records["a"]["turn"]["status"] == "inProgress"
    assert m.records["a"]["requestsUnknown"] == 1
    assert m.records["a"]["error"]


async def test_poll_snapshot_cannot_overwrite_newer_completion(service):
    m = service.monitor
    m.records["a"] = record()
    started, release = asyncio.Event(), asyncio.Event()

    async def rpc(method, params):
        if method == "thread/read":
            started.set()
            await release.wait()
            return {"thread": record()["thread"]}
        return {"data": []}

    service.rpc = AsyncMock(side_effect=rpc)
    service.turns = AsyncMock(return_value={"data": [record()["turn"]]})
    task = asyncio.create_task(m.refresh("a"))
    await started.wait()
    m.event(
        {
            "method": "turn/completed",
            "params": {
                "threadId": "a",
                "turn": {"id": "current", "status": "interrupted", "items": []},
            },
        }
    )
    release.set()
    await task
    assert m.records["a"]["turn"]["status"] == "interrupted"


async def test_catalog_includes_loaded_ephemeral_and_no_filter(service):
    m = service.monitor
    service.threads = AsyncMock(
        side_effect=[
            {"data": [record()["thread"]], "nextCursor": "page2"},
            {"data": [{"id": "b", "cwd": "/different", "status": {"type": "idle"}}]},
        ]
    )
    service.rpc = AsyncMock(
        side_effect=[{"data": ["a"], "nextCursor": "loaded2"}, {"data": ["ephemeral"]}]
    )
    ids = await m.catalog()
    assert ids == {"a", "b", "ephemeral"}
    assert m.initialized
    assert service.threads.await_count == 2
    assert m.loaded == {"a", "ephemeral"}


async def test_monitor_cache_and_private_requests_never_enter_database(service):
    m = service.monitor
    m.records["a"] = record()
    m.dirty.add("a")
    service.pending["private"] = {"params": {"url": "secret-url"}}
    task = asyncio.create_task(m.flush())
    await asyncio.sleep(0.3)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert service.store.cursor() == 0
    assert m.patches[-1]["requestKeys"] == ["private"]
    assert "secret-url" not in str(m.patches)


async def test_steer_rejects_changed_turn_without_resubmission(service, tmp_path):
    service.read = AsyncMock(
        return_value={
            "thread": {
                **record()["thread"],
                "cwd": str(tmp_path),
                "turns": [record()["turn"]],
            }
        }
    )
    service.rpc = AsyncMock()
    r = await service.execute(
        "steer-once",
        "steer",
        {"threadId": "a", "text": "extra instruction", "expectedTurnId": "old"},
    )
    assert r["state"] == "failed"
    service.rpc.assert_not_called()
    r = await service.execute(
        "steer-current",
        "steer",
        {"threadId": "a", "text": "extra instruction", "expectedTurnId": "current"},
    )
    service.rpc.assert_awaited_once_with(
        "turn/steer",
        {
            "threadId": "a",
            "expectedTurnId": "current",
            "input": [{"type": "text", "text": "extra instruction"}],
        },
    )


async def test_legacy_item_history_uses_official_read_fallback(service):
    from openai_codex.errors import JsonRpcError

    service.rpc = AsyncMock(
        side_effect=JsonRpcError(-32601, "thread/items/list is not supported yet")
    )
    service.read = AsyncMock(
        return_value={
            "thread": {
                "turns": [
                    {
                        "id": "current",
                        "items": [
                            {"id": str(i), "type": "agentMessage", "text": "history"}
                            for i in range(4)
                        ],
                    }
                ]
            }
        }
    )
    first = await service.items("a", "current", limit=2)
    assert [r["item"]["id"] for r in first["data"]] == ["3", "2"]
    second = await service.items("a", "current", first["nextCursor"], limit=2)
    assert [r["item"]["id"] for r in second["data"]] == ["1", "0"]
    assert second["nextCursor"] is None
    assert service.rpc.await_count == 1
    assert service.read.await_count == 2


def test_turn_summary_keeps_native_plan_and_isolates_old_events(service):
    m = service.monitor
    m.records["a"] = record()
    m.event(
        {
            "method": "turn/plan/updated",
            "params": {
                "threadId": "a",
                "turnId": "current",
                "explanation": "stage",
                "plan": [{"step": "run regression", "status": "inProgress"}],
            },
        }
    )
    before = copy.deepcopy(m.records["a"])
    m.event(
        {
            "method": "turn/plan/updated",
            "params": {
                "threadId": "a",
                "turnId": "old",
                "plan": [],
            },
        }
    )
    assert m.records["a"] == before
    assert (
        m.turn_summary("a", "current")["plan"]["steps"][0]["step"] == "run regression"
    )
    assert m.turn_summary("other", "current")["plan"] is None


async def test_full_diff_on_demand_only_and_disconnect_invalidates(service):
    m = service.monitor
    m.records["a"] = record()
    await service.publish(
        {
            "method": "turn/diff/updated",
            "params": {
                "threadId": "a",
                "turnId": "current",
                "diff": "private-diff" * 1000,
            },
        }
    )
    summary = await service.turn_summary("a", "current")
    assert summary["diff"] == "private-diff" * 1000
    assert "private-diff" not in str(m.snapshot())
    assert "private-diff" not in str(service.store.events(0))
    summary["diff"] = "modified"
    assert m.turn_summary("a", "current")["diff"] != "modified"
    service.connection = "disconnected"
    m.event({"method": "samaya/connection"})
    assert m.turn_summary("a", "current")["diff"] is None
    assert m.records["a"]["turn"]["status"] == "inProgress"


def test_summary_cache_is_bounded_and_oversize_is_explicitly_unavailable(service):
    m = service.monitor
    for i in range(110):
        m.observe_summary("a", str(i), "turn/diff/updated", {"diff": "x"})
    assert len(m.summaries) == 100
    assert m.turn_summary("a", "0")["notice"]
    m.observe_summary("a", "huge", "turn/diff/updated", {"diff": "x" * 8_000_001})
    assert not m.summaries
    assert m.turn_summary("a", "huge")["notice"]


async def test_first_plan_before_new_turn_read_is_retained_without_reviving_old_turn(
    service,
):
    m = service.monitor
    m.records["a"] = record(status="completed")
    m.event(
        {
            "method": "turn/plan/updated",
            "params": {
                "threadId": "a",
                "turnId": "new",
                "plan": [{"step": "verify", "status": "inProgress"}],
            },
        }
    )
    assert m.records["a"]["turn"]["id"] == "current"
    assert m.records["a"]["turn"]["status"] == "completed"
    service.rpc = AsyncMock(return_value={"thread": record()["thread"]})
    service.turns = AsyncMock(return_value={"data": [record(turn="new")["turn"]]})
    service.items = AsyncMock(return_value={"data": []})
    await m.refresh("a")
    assert m.records["a"]["turn"]["id"] == "new"
    assert m.records["a"]["plan"]["steps"][0]["step"] == "verify"
