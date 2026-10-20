"""Workspace defaults, explicit first-turn settings and durable usage snapshots."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from samaya.composer.commands import CommandService
from samaya.composer.models import draft_settings, validate_selection
from samaya.sessions.actions import SessionActions
from samaya.store import Store


@pytest.fixture
def models():
    return [
        {
            "model": "a",
            "isDefault": True,
            "defaultReasoningEffort": "medium",
            "supportedReasoningEfforts": [
                {"reasoningEffort": x, "description": x}
                for x in ("low", "medium", "high")
            ],
            "serviceTiers": [{"id": "priority", "name": "Fast"}],
        }
    ]


async def test_draft_reads_cwd_defaults_each_time(models):
    configs = {
        "/a": {"model": "a", "model_reasoning_effort": "high"},
        "/b": {"model": "a", "model_reasoning_effort": "low"},
    }

    async def rpc(method, params):
        if method == "config/read":
            assert params["includeLayers"] is False
            return {"config": configs[params["cwd"]]}
        return {"data": models}

    con = SimpleNamespace(rpc=AsyncMock(side_effect=rpc))
    assert (await draft_settings(con, "/a"))["current"]["reasoningEffort"] == "high"
    assert (await draft_settings(con, "/b"))["current"]["reasoningEffort"] == "low"
    configs["/a"]["model_reasoning_effort"] = "medium"
    assert (await draft_settings(con, "/a"))["current"]["reasoningEffort"] == "medium"


async def test_first_thread_start_receives_validated_selection(tmp_path, models):
    async def rpc(method, params):
        if method == "config/read":
            return {"config": {"model": "a"}}
        if method == "model/list":
            return {"data": models}
        if method == "thread/start":
            return {"thread": {"id": "fresh"}, "model": params["model"]}
        return {}

    con = SimpleNamespace(connected=lambda: object(), rpc=AsyncMock(side_effect=rpc))
    queries = SimpleNamespace(created=lambda _: None)
    store = Store(tmp_path / "state")
    try:
        actions = SessionActions(
            SimpleNamespace(directory=lambda x: x), con, store, queries
        )
        await actions.execute(
            "create",
            {
                "cwd": str(tmp_path),
                "modelSettings": {
                    "model": "a",
                    "reasoningEffort": "low",
                    "serviceTier": "fast",
                },
            },
        )
        start = next(
            c.args[1] for c in con.rpc.call_args_list if c.args[0] == "thread/start"
        )
        assert start["model"] == "a"
        assert start["config"] == {"model_reasoning_effort": "low"}
        assert start["serviceTier"] == "priority"
        assert store.watched() == ["fresh"]
        con.rpc.reset_mock()
        with pytest.raises(ValueError, match="思考强度"):
            await actions.execute(
                "create",
                {
                    "cwd": str(tmp_path),
                    "modelSettings": {"model": "a", "reasoningEffort": "ultra"},
                },
            )
        assert not any(c.args[0] == "thread/start" for c in con.rpc.call_args_list)
    finally:
        store.close()


def test_selection_rejects_disappeared_model():
    with pytest.raises(ValueError, match="模型目录"):
        validate_selection({"models": []}, {"model": "gone"})


async def test_status_persists_usage_without_starting_turn_and_survives_quota_error(
    tmp_path,
):
    store = Store(tmp_path)
    store.event(
        {
            "method": "thread/tokenUsage/updated",
            "params": {
                "threadId": "t",
                "tokenUsage": {
                    "total": {"totalTokens": 2500},
                    "last": {"totalTokens": 500},
                    "modelContextWindow": 4000,
                },
            },
        }
    )
    store.close()
    store = Store(tmp_path)
    con = SimpleNamespace(
        rpc=AsyncMock(side_effect=ConnectionError("quota unavailable"))
    )
    queries = SimpleNamespace(
        read=AsyncMock(
            return_value={"thread": {"id": "t", "cwd": "/project", "turns": []}}
        ),
        settings=AsyncMock(return_value={"model": "a", "reasoningEffort": "high"}),
    )
    service = CommandService(
        SimpleNamespace(
            connection=con,
            queries=queries,
            config=SimpleNamespace(directory=lambda x: x),
        ),
        SimpleNamespace(store=store),
    )
    try:
        result = await service.context("t", "status")
        assert result["readOnly"]
        assert result["data"]["tokenUsage"]["usage"]["last"]["totalTokens"] == 500
        assert result["data"]["rateLimits"] is None
        assert result["data"]["rateLimitsError"] == "quota unavailable"
        assert [c.args[0] for c in con.rpc.call_args_list] == [
            "account/rateLimits/read"
        ]
        assert store.token_usage("missing") is None
    finally:
        store.close()
