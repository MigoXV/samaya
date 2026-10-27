"""A plan action is bound to the completed native plan, not stale UI state."""

from unittest.mock import AsyncMock

import pytest

from samaya.config import Settings
from samaya.runtime import Runtime
from samaya.store import Store


@pytest.mark.parametrize("clear", [False, True])
async def test_execute_completed_plan_with_verified_scope(tmp_path, clear):
    store = Store(tmp_path)
    runtime = Runtime(Settings(data_dir=tmp_path), store)
    runtime.connection.state = "connected"
    runtime.connection.adapter = object()
    thread = {
        "id": "t",
        "cwd": str(tmp_path),
        "model": "test",
        "turns": [{"id": "last", "status": "completed"}],
        "status": {"type": "idle"},
    }
    runtime.sessions.idle = AsyncMock(return_value=thread)
    runtime.sessions.settings = AsyncMock(
        return_value={
            "model": "test",
            "reasoningEffort": "high",
            "collaborationMode": {"mode": "plan"},
            "activePermissionProfile": {"id": ":workspace"},
            "approvalPolicy": "on-request",
            "approvalsReviewer": "auto_review",
        }
    )
    runtime.sessions.items = AsyncMock(
        return_value={
            "data": [{"item": {"type": "plan", "id": "p", "text": "计划正文"}}],
            "nextCursor": None,
        }
    )
    runtime.catalog.inputs = AsyncMock(return_value=[{"type": "text", "text": "plan"}])

    async def rpc(method, params):
        if method == "thread/start":
            return {"thread": {"id": "new"}}
        if method == "turn/start":
            return {"turn": {"id": "started"}}
        return {}

    runtime.connection.rpc = AsyncMock(side_effect=rpc)
    body = {"threadId": "t", "turnId": "last", "planItemId": "p", "clearContext": clear}
    try:
        result = await runtime.operations.execute("plan", "plan_execute", body)
        assert result["state"] == "succeeded"
        assert result["result"]["threadId"] == ("new" if clear else "t")
        calls = runtime.connection.rpc.call_args_list
        if clear:
            start = next(c.args[1] for c in calls if c.args[0] == "thread/start")
            assert (
                start["permissions"] == ":workspace"
                and start["approvalsReviewer"] == "auto_review"
            )
            assert "计划正文" in runtime.catalog.inputs.await_args.args[1]
        else:
            assert any(c.args[0] == "thread/settings/update" for c in calls)
        assert sum(c.args[0] == "turn/start" for c in calls) == 1
        runtime.connection.rpc.reset_mock()
        body["turnId"] = "stale"
        failed = await runtime.operations.execute("stale", "plan_execute", body)
        assert failed["state"] == "failed"
        runtime.connection.rpc.assert_not_called()
    finally:
        await runtime.operations.close()
        store.close()
