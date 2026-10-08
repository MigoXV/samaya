"""Configured settings and capability changes must agree across all entrypoints."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from samaya.composer.commands import CommandService
from samaya.sessions.queries import SessionQueries


@pytest.fixture
def native(tmp_path):
    thread = {
        "id": "t",
        "cwd": str(tmp_path),
        "model": "a",
        "turns": [{"id": "turn", "status": "inProgress"}],
    }
    values = {"model": "a", "reasoningEffort": "ultra", "serviceTier": "priority"}
    models = [
        {
            "model": "a",
            "displayName": "A",
            "isDefault": True,
            "defaultReasoningEffort": "medium",
            "supportedReasoningEfforts": [
                {"reasoningEffort": v, "description": v}
                for v in ("low", "medium", "ultra")
            ],
            "serviceTiers": [{"id": "priority", "name": "Fast"}],
        },
        {
            "model": "b",
            "defaultReasoningEffort": "medium",
            "supportedReasoningEfforts": [
                {"reasoningEffort": "medium", "description": "Medium"}
            ],
            "serviceTiers": [],
        },
        {
            "model": "c",
            "supportedReasoningEfforts": [],
            "serviceTiers": [{"id": "priority", "name": "Fast"}],
        },
        {"model": "hidden", "hidden": True},
    ]

    async def rpc(method, params):
        if method == "thread/read":
            return {"thread": dict(thread)}
        if method == "thread/resume":
            return dict(values)
        if method == "model/list":
            return {"data": models}
        if method == "thread/settings/update":
            values.update(
                {
                    ("reasoningEffort" if k == "effort" else k): v
                    for k, v in params.items()
                    if k != "threadId"
                }
            )
            return {}
        raise AssertionError(method)

    con = SimpleNamespace(connection_id="one", rpc=AsyncMock(side_effect=rpc))
    queries = SessionQueries(
        con, SimpleNamespace(cursor=lambda: 0), SimpleNamespace(pending={}, progress={})
    )
    catalog = SimpleNamespace(
        connection=con,
        queries=queries,
        config=SimpleNamespace(directory=lambda path: path),
    )
    cmd = CommandService(catalog, SimpleNamespace())
    return cmd, queries, con, values, models


async def test_complete_settings_use_resume_not_stale_thread(native):
    cmd, _, con, values, _ = native
    values["model"] = "b"
    result = await cmd.model_settings("t", refresh=True)
    assert result["current"] == {
        "model": "b",
        "reasoningEffort": "ultra",
        "serviceTier": "priority",
    }
    assert result["expectedTurnId"] == "turn"
    assert result["active"]
    assert not any(m["model"] == "hidden" for m in result["models"])
    assert sum(c.args[0] == "model/list" for c in con.rpc.call_args_list) == 1


@pytest.mark.parametrize(
    "target,effort,tier",
    [("a", "ultra", "priority"), ("b", "medium", "default"), ("c", None, "priority")],
)
async def test_model_switch_is_one_compatible_patch(native, target, effort, tier):
    cmd, _, con, _, _ = native
    result = await cmd.execute(
        {
            "threadId": "t",
            "command": "model",
            "args": {"value": target},
            "expectedTurnId": "turn",
            "expectedModel": "a",
        }
    )
    writes = [
        c.args[1]
        for c in con.rpc.call_args_list
        if c.args[0] == "thread/settings/update"
    ]
    assert writes == [
        {"threadId": "t", "model": target, "effort": effort, "serviceTier": tier}
    ]
    assert result["modelSettings"]["current"]["model"] == target
    assert not any(
        c.args[0] in ("turn/start", "turn/interrupt") for c in con.rpc.call_args_list
    )


async def test_fast_context_reads_current_and_off_means_standard(native):
    cmd, _, con, _, models = native
    models[0]["defaultServiceTier"] = "priority"
    context = await cmd.context("t", "fast")
    assert context["fields"][0]["value"] == "priority"
    result = await cmd.execute(
        {
            "threadId": "t",
            "command": "fast",
            "args": {"value": "default"},
            "expectedTurnId": "turn",
        }
    )
    assert result["modelSettings"]["current"]["serviceTier"] == "default"
    writes = [
        c.args[1]
        for c in con.rpc.call_args_list
        if c.args[0] == "thread/settings/update"
    ]
    assert writes[-1] == {"threadId": "t", "serviceTier": "default"}


async def test_changed_model_or_capability_rejects_without_write(native):
    cmd, _, con, _, _ = native
    with pytest.raises(ValueError, match="其他客户端"):
        await cmd.execute(
            {
                "threadId": "t",
                "command": "reasoning",
                "args": {"value": "medium"},
                "expectedTurnId": "turn",
                "expectedModel": "b",
            }
        )
    with pytest.raises(ValueError, match="选项已变化"):
        await cmd.execute(
            {
                "threadId": "t",
                "command": "reasoning",
                "args": {"value": "xhigh"},
                "expectedTurnId": "turn",
            }
        )
    assert not any(
        c.args[0] == "thread/settings/update" for c in con.rpc.call_args_list
    )


async def test_post_save_read_failure_does_not_reject_acknowledged_write(native):
    cmd, _, con, _, _ = native
    old = con.rpc.side_effect
    written = False

    async def rpc(method, params):
        nonlocal written
        if written and method == "thread/resume":
            raise ConnectionError("offline")
        result = await old(method, params)
        if method == "thread/settings/update":
            written = True
        return result

    con.rpc.side_effect = rpc
    result = await cmd.execute(
        {
            "threadId": "t",
            "command": "reasoning",
            "args": {"value": "medium"},
            "expectedTurnId": "turn",
        }
    )
    assert result["settingsPending"]
    assert (
        sum(c.args[0] == "thread/settings/update" for c in con.rpc.call_args_list) == 1
    )


async def test_native_event_wins_over_inflight_resume_and_connection_invalidates(
    native,
):
    _, queries, con, _, _ = native
    old = con.rpc.side_effect

    async def rpc(method, params):
        response = await old(method, params)
        if method == "thread/resume":
            queries.observe_settings(
                {
                    "method": "thread/settings/updated",
                    "params": {
                        "threadId": "t",
                        "threadSettings": {
                            "model": "b",
                            "effort": "medium",
                            "serviceTier": "default",
                        },
                    },
                }
            )
        return response

    con.rpc.side_effect = rpc
    assert (await queries.settings("t"))["model"] == "b"
    assert queries.with_settings({"id": "t", "model": "a"})["model"] == "b"
    con.connection_id = "two"
    assert queries.with_settings({"id": "t", "model": "a"})["model"] == "a"
    con.rpc.side_effect = old
    assert (await queries.settings("t"))["model"] == "a"
