"""Plan switching uses current native settings and never starts an execution turn."""

import pytest

from tests.test_model_settings import native as native_fixture

native = native_fixture


async def with_modes(native):
    cmd, queries, con, values, models = native
    original = con.rpc.side_effect

    async def rpc(method, params):
        if method == "collaborationMode/list":
            return {
                "data": [
                    {"mode": "default", "name": "默认"},
                    {"mode": "plan", "name": "计划"},
                ]
            }
        return await original(method, params)

    con.rpc.side_effect = rpc
    return cmd, queries, con, values, models


async def test_plan_switch_confirms_native_mode_and_preserves_model(native):
    cmd, _, con, values, _ = await with_modes(native)
    values["collaborationMode"] = {"mode": "default"}
    result = await cmd.execute(
        {
            "threadId": "t",
            "command": "plan",
            "args": {"value": "plan"},
            "expectedTurnId": "turn",
            "expectedMode": "default",
        }
    )
    assert result["mode"] == "plan"
    assert result["settingsPending"] is False
    patches = [
        c.args[1]
        for c in con.rpc.call_args_list
        if c.args[0] == "thread/settings/update"
    ]
    assert patches == [
        {
            "threadId": "t",
            "collaborationMode": {
                "mode": "plan",
                "settings": {
                    "model": "a",
                    "reasoning_effort": "ultra",
                    "developer_instructions": None,
                },
            },
        }
    ]
    assert not any(
        c.args[0] in ("turn/start", "turn/steer") for c in con.rpc.call_args_list
    )
    context = await cmd.context("t", "plan")
    assert context["fields"][0]["value"] == "plan"


async def test_concurrent_mode_change_rejects_before_write(native):
    cmd, _, con, values, _ = await with_modes(native)
    values["collaborationMode"] = {"mode": "plan"}
    with pytest.raises(ValueError, match="其他客户端"):
        await cmd.execute(
            {
                "threadId": "t",
                "command": "plan",
                "args": {"value": "plan"},
                "expectedTurnId": "turn",
                "expectedMode": "default",
            }
        )
    assert not any(
        c.args[0] == "thread/settings/update" for c in con.rpc.call_args_list
    )


async def test_post_write_failure_is_pending_not_replayable_failure(native):
    cmd, _, con, _, _ = await with_modes(native)
    original = con.rpc.side_effect
    written = False

    async def rpc(method, params):
        nonlocal written
        if written and method == "thread/resume":
            raise ConnectionError("unavailable")
        result = await original(method, params)
        if method == "thread/settings/update":
            written = True
        return result

    con.rpc.side_effect = rpc
    result = await cmd.execute(
        {
            "threadId": "t",
            "command": "plan",
            "args": {"value": "plan"},
            "expectedTurnId": "turn",
        }
    )
    assert result["settingsPending"] is True
