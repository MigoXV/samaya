"""Input identity and command side effects must survive a UI redesign."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from samaya.composer.catalog import InputCatalog
from samaya.composer.commands import CommandService, registry
from samaya.config import Settings


@pytest.fixture
def services(tmp_path):
    thread = {
        "id": "t",
        "cwd": str(tmp_path),
        "model": "test-model",
        "status": {"type": "idle"},
        "turns": [{"id": "last", "status": "completed"}],
    }
    refs = [
        {
            "name": "train",
            "path": "/skills/train/SKILL.md",
            "enabled": True,
            "description": "train",
            "scope": "user",
        },
        {"name": "disabled", "path": "/skills/no/SKILL.md", "enabled": False},
    ]

    async def rpc(method, params):
        if method == "skills/list":
            return {"data": [{"cwd": str(tmp_path), "skills": refs}]}
        if method == "app/list":
            return {
                "data": [
                    {
                        "name": "Example App",
                        "id": "app-one",
                        "isEnabled": True,
                        "isAccessible": True,
                    }
                ],
                "nextCursor": None,
            }
        if method == "model/list":
            return {
                "data": [
                    {
                        "model": "test-model",
                        "displayName": "Test",
                        "defaultReasoningEffort": "high",
                        "supportedReasoningEfforts": [
                            {"reasoningEffort": "high", "description": "High"}
                        ],
                        "serviceTiers": [{"id": "priority", "name": "Fast"}],
                    }
                ]
            }
        if method == "permissionProfile/list":
            return {
                "data": [
                    {"id": ":read-only", "allowed": True},
                    {"id": ":danger-full-access", "allowed": False},
                ]
            }
        if method == "collaborationMode/list":
            return {
                "data": [
                    {"mode": "plan", "name": "Plan"},
                    {"mode": "default", "name": "Default"},
                ]
            }
        if method == "thread/goal/get":
            return {"goal": None}
        return {}

    connection = SimpleNamespace(
        generation=1, connected=lambda: True, rpc=AsyncMock(side_effect=rpc)
    )
    queries = SimpleNamespace(read=AsyncMock(return_value={"thread": thread}))
    catalog = InputCatalog(Settings(roots=[tmp_path]), connection, queries)
    commands = CommandService(
        catalog, SimpleNamespace(store=SimpleNamespace(watch=lambda _: None))
    )
    return catalog, commands, connection, thread, refs


async def test_explicit_skill_and_app_inputs(services):
    c, _, con, t, _ = services
    r = await c.discover("t")
    refs = [
        {"type": x["type"], "name": x["name"], "path": x["path"]}
        for x in r["references"]
        if x["enabled"]
    ]
    inputs = await c.inputs("t", "$train $example-app inspect", refs, t["cwd"])
    assert [i["type"] for i in inputs] == ["text", "skill", "mention"]
    assert inputs[-1]["path"] == "app://app-one"
    assert not any(
        m.args[0] in ("turn/start", "turn/steer") for m in con.rpc.call_args_list
    )


@pytest.mark.parametrize("change", ["forged", "disabled", "cwd", "removed"])
async def test_reject_stale_or_forged_reference(services, change):
    c, _, _, t, skills = services
    ref = {"type": "skill", "name": "train", "path": "/skills/train/SKILL.md"}
    text, cwd = "$train run", t["cwd"]
    if change == "forged":
        ref["path"] = "/etc/passwd"
    if change == "disabled":
        skills[0]["enabled"] = False
    if change == "cwd":
        cwd = "/other"
    if change == "removed":
        text = "run"
    with pytest.raises(ValueError):
        await c.inputs("t", text, [ref], cwd)


async def test_no_references_does_not_depend_on_app_catalog(services):
    c, _, con, _, _ = services
    con.rpc.side_effect = ConnectionError("offline")
    assert await c.inputs("t", "hello", []) == [{"type": "text", "text": "hello"}]
    con.rpc.assert_not_called()


async def test_partial_discovery_error(services):
    c, _, con, _, _ = services
    old = con.rpc.side_effect

    async def rpc(method, params):
        if method == "app/list":
            raise ConnectionError("private token must not be leaked")
        return await old(method, params)

    con.rpc.side_effect = rpc
    result = await c.discover("t")
    assert len(result["references"]) == 2
    assert "private token" not in str(result)
    assert result["errors"]


async def test_commands_do_not_start_turn_on_discovery(services):
    _, cmd, con, _, _ = services
    await cmd.context("t", "model")
    assert all(
        c.args[0] not in ("turn/start", "thread/settings/update")
        for c in con.rpc.call_args_list
    )


@pytest.mark.parametrize(
    "command,args,method",
    [
        ("model", {"value": "test-model"}, "thread/settings/update"),
        ("reasoning", {"value": "high"}, "thread/settings/update"),
        ("plan", {"value": "plan"}, "thread/settings/update"),
        ("fast", {"value": "priority"}, "thread/settings/update"),
        ("memories", {"value": "disabled"}, "thread/memoryMode/set"),
        ("compact", {}, "thread/compact/start"),
        ("review", {"target": "baseBranch", "value": "dev"}, "review/start"),
        (
            "goal",
            {"operation": "set", "objective": "test", "tokenBudget": "123"},
            "thread/goal/set",
        ),
        ("goal", {"operation": "pause"}, "thread/goal/set"),
        ("goal", {"operation": "clear"}, "thread/goal/clear"),
        ("stop", {}, "thread/backgroundTerminals/clean"),
    ],
)
async def test_command_routes_to_native_method(services, command, args, method):
    _, cmd, con, _, _ = services
    await cmd.execute(
        {"threadId": "t", "command": command, "expectedTurnId": "last", "args": args}
    )
    assert con.rpc.call_args.args[0] == method
    assert not any(c.args[0] == "turn/interrupt" for c in con.rpc.call_args_list)


@pytest.mark.parametrize(
    "args", [{"value": ":danger-full-access"}, {"value": "unknown"}]
)
async def test_permission_choices_validated_at_execution(services, args):
    _, cmd, con, _, _ = services
    with pytest.raises(ValueError):
        await cmd.execute(
            {
                "threadId": "t",
                "command": "permissions",
                "expectedTurnId": "last",
                "args": args,
            }
        )
    assert not any(
        c.args[0] == "thread/settings/update" for c in con.rpc.call_args_list
    )


async def test_stale_turn_rejected(services):
    _, cmd, con, _, _ = services
    with pytest.raises(ValueError):
        await cmd.execute(
            {"threadId": "t", "command": "compact", "expectedTurnId": "old"}
        )
    con.rpc.assert_not_called()


async def test_no_implicit_queuing(services):
    _, cmd, con, t, _ = services
    t["status"] = {"type": "active"}
    t["turns"][0]["status"] = "inProgress"
    with pytest.raises(ValueError):
        await cmd.execute(
            {"threadId": "t", "command": "compact", "expectedTurnId": "last"}
        )
    con.rpc.assert_not_called()


def test_registry_is_complete_and_explicit():
    rows = registry()
    assert len({r["name"] for r in rows}) == len(rows)
    assert all(
        r["description"] and r["kind"] in ("ui", "native", "unavailable") for r in rows
    )
    assert next(r for r in rows if r["name"] == "cloud")["enabled"] is False


async def test_empty_permission_catalog_cannot_be_bypassed(services):
    _, commands, con, _, _ = services
    con.rpc.return_value = {"data": []}
    con.rpc.side_effect = None
    with pytest.raises(ValueError, match="选项已变化"):
        await commands.execute(
            {
                "threadId": "t",
                "command": "permissions",
                "expectedTurnId": "last",
                "args": {"value": ":danger-full-access"},
            }
        )
    assert not any(
        c.args[0] == "thread/settings/update" for c in con.rpc.call_args_list
    )


@pytest.mark.parametrize("command", ["fork", "side"])
async def test_fork_goal_continuation_parameters(services, command):
    _, commands, con, _, _ = services
    con.rpc.side_effect = None
    con.rpc.return_value = {"thread": {"id": "forked"}}
    await commands.execute(
        {"threadId": "t", "command": command, "expectedTurnId": "last", "args": {}}
    )
    method, params = con.rpc.call_args.args
    assert method == "thread/fork"
    assert params["ephemeral"] == (command == "side")
    assert params.get("deferGoalContinuation") == (True if command == "fork" else None)


async def test_reasoning_context_exposes_model_default(services):
    _, cmd, con, _, _ = services
    context = await cmd.context("t", "reasoning")
    assert context["defaultValue"] == "high"
    assert context["fields"][0]["value"] == "high"
    assert all(c.args[0] != "thread/settings/update" for c in con.rpc.call_args_list)
