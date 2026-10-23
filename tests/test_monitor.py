import asyncio
import copy
from unittest.mock import AsyncMock

import pytest

from samaya.config import Settings
from samaya.runtime import Runtime
from samaya.store import Store


@pytest.fixture
def service(tmp_path):
    store = Store(tmp_path)
    s = Runtime(Settings(data_dir=tmp_path, roots=[tmp_path]), store)
    s.connection.state = "connected"
    s.connection.generation = 1
    s.connection.connection_id = "connection-one"
    s.connection.adapter = object()
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
    m.projection.records["a"] = record(status="completed")
    before = copy.deepcopy(m.projection.records["a"])
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
    assert m.projection.records["a"] == before


def test_duplicate_completion_has_one_change(service):
    m = service.monitor
    m.projection.records["a"] = record()
    event = {
        "method": "turn/completed",
        "params": {
            "threadId": "a",
            "turn": {"id": "current", "status": "completed", "items": []},
        },
    }
    m.event(event)
    m.event(event)
    assert len(m.projection.changes) == 1
    assert m.projection.records["a"]["turn"]["status"] == "completed"


def test_disconnect_preserves_execution_and_unknown_request(service):
    m = service.monitor
    m.projection.records["a"] = record()
    service.decisions.pending["private"] = {
        "params": {"threadId": "a", "secret": "not journaled"}
    }
    service.connection.state = "disconnected"
    m.event({"method": "samaya/connection"})
    assert m.projection.records["a"]["turn"]["status"] == "inProgress"
    assert m.projection.records["a"]["requestsUnknown"] == 1
    assert m.projection.records["a"]["error"]


async def test_poll_snapshot_cannot_overwrite_newer_completion(service):
    m = service.monitor
    m.projection.records["a"] = record()
    started, release = asyncio.Event(), asyncio.Event()

    async def rpc(method, params):
        if method == "thread/read":
            started.set()
            await release.wait()
            return {"thread": record()["thread"]}
        return {"data": []}

    service.connection.rpc = AsyncMock(side_effect=rpc)
    service.sessions.turns = AsyncMock(return_value={"data": [record()["turn"]]})
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
    assert m.projection.records["a"]["turn"]["status"] == "interrupted"


async def test_catalog_includes_loaded_ephemeral_and_no_filter(service):
    m = service.monitor
    service.sessions.threads = AsyncMock(
        side_effect=[
            {"data": [record()["thread"]], "nextCursor": "page2"},
            {"data": [{"id": "b", "cwd": "/different", "status": {"type": "idle"}}]},
        ]
    )
    service.connection.rpc = AsyncMock(
        side_effect=[{"data": ["a"], "nextCursor": "loaded2"}, {"data": ["ephemeral"]}]
    )
    ids = await m.catalog()
    assert ids == {"a", "b", "ephemeral"}
    assert m.initialized
    assert service.sessions.threads.await_count == 2
    assert m.loaded == {"a", "ephemeral"}


async def test_monitor_cache_and_private_requests_never_enter_database(service):
    m = service.monitor
    m.projection.records["a"] = record()
    m.projection.dirty.add("a")
    service.decisions.pending["private"] = {"params": {"url": "secret-url"}}
    task = asyncio.create_task(m.flush())
    await asyncio.sleep(0.3)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert service.store.cursor() == 0
    assert m.patches[-1]["requestKeys"] == ["private"]
    assert "secret-url" not in str(m.patches)


async def test_steer_rejects_changed_turn_without_resubmission(service, tmp_path):
    service.sessions.read = AsyncMock(
        return_value={
            "thread": {
                **record()["thread"],
                "cwd": str(tmp_path),
                "turns": [record()["turn"]],
            }
        }
    )
    service.connection.rpc = AsyncMock()
    r = await service.operations.execute(
        "steer-once",
        "steer",
        {"threadId": "a", "text": "extra instruction", "expectedTurnId": "old"},
    )
    assert r["state"] == "failed"
    service.connection.rpc.assert_not_called()
    r = await service.operations.execute(
        "steer-current",
        "steer",
        {"threadId": "a", "text": "extra instruction", "expectedTurnId": "current"},
    )
    service.connection.rpc.assert_awaited_once_with(
        "turn/steer",
        {
            "threadId": "a",
            "expectedTurnId": "current",
            "input": [{"type": "text", "text": "extra instruction"}],
        },
    )


async def test_legacy_item_history_uses_official_read_fallback(service):
    from openai_codex.errors import JsonRpcError

    service.connection.rpc = AsyncMock(
        side_effect=JsonRpcError(-32601, "thread/items/list is not supported yet")
    )
    service.sessions.read = AsyncMock(
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
    first = await service.sessions.items("a", "current", limit=2)
    assert [r["item"]["id"] for r in first["data"]] == ["3", "2"]
    second = await service.sessions.items("a", "current", first["nextCursor"], limit=2)
    assert [r["item"]["id"] for r in second["data"]] == ["1", "0"]
    assert second["nextCursor"] is None
    assert service.connection.rpc.await_count == 1
    assert service.sessions.read.await_count == 2


def test_turn_summary_keeps_native_plan_and_isolates_old_events(service):
    m = service.monitor
    m.projection.records["a"] = record()
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
    before = copy.deepcopy(m.projection.records["a"])
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
    assert m.projection.records["a"] == before
    assert (
        m.turn_summary("a", "current")["plan"]["steps"][0]["step"] == "run regression"
    )
    assert m.turn_summary("other", "current")["plan"] is None


async def test_full_diff_on_demand_only_and_disconnect_invalidates(service):
    m = service.monitor
    m.projection.records["a"] = record()
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
    summary = service.monitor.turn_summary("a", "current")
    assert summary["diff"] == "private-diff" * 1000
    assert "private-diff" not in str(m.snapshot())
    assert "private-diff" not in str(service.store.events(0))
    summary["diff"] = "modified"
    assert m.turn_summary("a", "current")["diff"] != "modified"
    service.connection.state = "disconnected"
    m.event({"method": "samaya/connection"})
    assert m.turn_summary("a", "current")["diff"] is None
    assert m.projection.records["a"]["turn"]["status"] == "inProgress"


def test_summary_cache_is_bounded_and_oversize_is_explicitly_unavailable(service):
    m = service.monitor
    for i in range(110):
        m.projection.observe_summary("a", str(i), "turn/diff/updated", {"diff": "x"})
    assert len(m.projection.summaries) == 100
    assert m.turn_summary("a", "0")["notice"]
    m.projection.observe_summary(
        "a", "huge", "turn/diff/updated", {"diff": "x" * 8_000_001}
    )
    assert not m.projection.summaries
    assert m.turn_summary("a", "huge")["notice"]


async def test_first_plan_before_new_turn_read_is_retained_without_reviving_old_turn(
    service,
):
    m = service.monitor
    m.projection.records["a"] = record(status="completed")
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
    assert m.projection.records["a"]["turn"]["id"] == "current"
    assert m.projection.records["a"]["turn"]["status"] == "completed"
    service.connection.rpc = AsyncMock(return_value={"thread": record()["thread"]})
    service.sessions.turns = AsyncMock(
        return_value={"data": [record(turn="new")["turn"]]}
    )
    service.sessions.items = AsyncMock(return_value={"data": []})
    await m.refresh("a")
    assert m.projection.records["a"]["turn"]["id"] == "new"
    assert m.projection.records["a"]["plan"]["steps"][0]["step"] == "verify"


def deletion_event(state="succeeded"):
    return {
        "method": "samaya/operation",
        "params": {
            "threadId": "a",
            "action": "delete",
            "state": state,
            "result": {"scope": [{"id": "a"}, {"id": "child"}]},
        },
    }


def test_confirmed_delete_removes_entire_scope_immediately(service):
    projection = service.monitor.projection
    for tid in ("a", "child", "other"):
        projection.records[tid] = record()
        projection.touch(tid)
        projection.refresh_queue.add(tid)
    service.monitor.event(deletion_event())
    assert set(projection.records) == {"other"}
    assert projection.removed == {"a", "child"}
    assert projection.dirty == {"other"}
    assert projection.refresh_queue == {"other"}
    # Flushing the removal patch or receiving late native events cannot undo deletion.
    projection.removed.clear()
    service.monitor.event(
        {"method": "thread/started", "params": {"thread": {"id": "a"}}}
    )
    assert "a" not in projection.refresh_queue
    assert "a" not in projection.dirty


@pytest.mark.parametrize("state", ["failed", "uncertain", "pending"])
def test_unconfirmed_delete_keeps_conversation_visible(service, state):
    service.monitor.projection.records["a"] = record()
    service.monitor.event(deletion_event(state))
    assert "a" in service.monitor.projection.records
    assert not service.monitor.projection.deleted
    assert not service.monitor.projection.removed


@pytest.mark.asyncio
async def test_delete_invalidates_inflight_refresh_and_stale_catalog(service):
    monitor = service.monitor
    monitor.projection.records["a"] = record()
    entered, release = asyncio.Event(), asyncio.Event()

    async def read(method, params):
        assert method == "thread/read"
        entered.set()
        await release.wait()
        return {"thread": record()["thread"]}

    service.connection.rpc = AsyncMock(side_effect=read)
    service.sessions.turns = AsyncMock(return_value={"data": []})
    task = asyncio.create_task(monitor.refresh("a"))
    await entered.wait()
    monitor.event(deletion_event())
    release.set()
    await task
    assert "a" not in monitor.projection.records
    service.connection.rpc.reset_mock()
    await monitor.refresh("a")
    service.connection.rpc.assert_not_called()
    # Even a catalog response captured before deletion must not recreate the row.
    service.sessions.threads = AsyncMock(return_value={"data": [record()["thread"]]})
    monitor.loaded_ids = AsyncMock(return_value={"a"})
    assert await monitor.catalog() == set()
    assert monitor.snapshot()["records"] == []
    assert "a" not in monitor.projection.records


@pytest.mark.asyncio
async def test_delete_receipt_updates_snapshot_and_removal_patch(service):
    projection = service.monitor.projection
    projection.records["a"] = record()
    projection.records["child"] = record()
    service.actions.execute = AsyncMock(
        return_value=deletion_event()["params"]["result"]
    )
    result = await service.operations.execute(
        "delete-once", "delete", {"threadId": "a", "digest": "verified"}
    )
    assert result["state"] == "succeeded"
    assert service.monitor.snapshot()["records"] == []
    task = asyncio.create_task(service.monitor.flush())
    try:
        await asyncio.sleep(0.3)
        assert set(service.monitor.patches[-1]["removed"]) == {"a", "child"}
        assert service.monitor.patches[-1]["records"] == []
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    # Retry with the same operation ID reads the receipt, never replays deletion.
    await service.operations.execute(
        "delete-once", "delete", {"threadId": "a", "digest": "verified"}
    )
    assert service.actions.execute.await_count == 1


def test_partial_archive_removes_only_confirmed_items_and_restore_reappears(service):
    projection = service.monitor.projection
    for tid in ("a", "child"):
        projection.records[tid] = record()
    service.monitor.event(
        {
            "method": "samaya/operation",
            "params": {
                "threadId": "a",
                "action": "archive",
                "state": "succeeded",
                "result": {
                    "items": [
                        {"id": "a", "state": "succeeded"},
                        {"id": "child", "state": "failed"},
                    ]
                },
            },
        }
    )
    assert set(projection.records) == {"child"}
    assert projection.archived == {"a"}
    assert projection.removed == {"a"}
    service.monitor.event(
        {
            "method": "samaya/operation",
            "params": {
                "threadId": "a",
                "action": "unarchive",
                "state": "succeeded",
                "result": {},
            },
        }
    )
    assert not projection.archived
    assert not projection.removed
    assert "a" in projection.refresh_queue
