import asyncio
import json
from unittest.mock import AsyncMock, Mock

import pytest

from samaya.codex import title_generation as titles


def test_prompt_budget_and_title_normalization():
    prompt = titles.title_prompt("配置中文标题" * 400)
    assert len(prompt.encode()) <= 960
    assert "\ufffd" not in prompt
    assert (
        titles.parse_title(json.dumps({"title": " “验证\n中文标题。” "}))
        == "验证 中文标题"
    )
    assert (
        titles.fallback_title("# [查看记录](https://example.com)\n`git diff`")
        == "查看记录 git diff"
    )
    assert len(titles.fallback_title("长" * 120)) == 60
    with pytest.raises(ValueError):
        titles.parse_title('{"title": " ", "extra": 1}')


@pytest.fixture
def adapter(monkeypatch):
    client = Mock(
        start=AsyncMock(),
        close=AsyncMock(),
        structured_turn_start=AsyncMock(return_value={"turn": {"id": "title-turn"}}),
        event=AsyncMock(),
    )

    async def request(method, _params):
        return {
            "config/read": {
                "config": {"mcp_servers": {"configured": {"enabled": True}}}
            },
            "account/read": {"account": {"type": "chatgpt"}},
            "model/list": {"data": [{"model": titles.TITLE_MODEL}]},
            "thread/start": {
                "thread": {
                    "id": "helper",
                    "ephemeral": True,
                    "threadSource": titles.TITLE_THREAD_SOURCE,
                },
                "sandbox": {"type": "readOnly"},
                "approvalPolicy": "never",
            },
            "turn/interrupt": {},
            "thread/unsubscribe": {},
        }[method]

    client.request = AsyncMock(side_effect=request)
    monkeypatch.setattr(titles, "Adapter", lambda _socket: client)
    return client


async def test_background_turn_uses_cli_model_and_no_tools(adapter):
    adapter.event.side_effect = [
        {
            "method": "turn/completed",
            "params": {
                "threadId": "other",
                "turn": {"id": "title-turn", "status": "failed"},
            },
        },
        {
            "method": "item/completed",
            "params": {
                "threadId": "helper",
                "turnId": "title-turn",
                "item": {"type": "agentMessage", "text": '{"title":"验证标题"}'},
            },
        },
        {
            "method": "turn/completed",
            "params": {
                "threadId": "helper",
                "turn": {"id": "title-turn", "status": "completed"},
            },
        },
    ]
    register = Mock()
    assert (
        await titles.generate_title("socket", {"cwd": "/demo"}, "检查标题", register)
        == "验证标题"
    )
    register.assert_called_once_with("helper")
    start = next(
        params
        for (method, params), _ in adapter.request.await_args_list
        if method == "thread/start"
    )
    assert start["model"] == titles.TITLE_MODEL and start["permissions"] == ":read-only"
    assert start["environments"] == start["dynamicTools"] == []
    assert start["config"]["mcp_servers"] == {"configured": {"enabled": False}}
    assert start["config"]["features.shell_tool"] is False
    turn = adapter.structured_turn_start.await_args.args[0]
    assert turn["outputSchema"] == titles.TITLE_SCHEMA and turn["effort"] == "low"
    adapter.request.assert_awaited_with("thread/unsubscribe", {"threadId": "helper"})
    adapter.close.assert_awaited_once()


async def test_generation_timeout_interrupts_and_detaches_only_helper(
    adapter, monkeypatch
):
    monkeypatch.setattr(titles, "GENERATION_TIMEOUT", 0.05)
    started = asyncio.Event()
    adapter.structured_turn_start.side_effect = lambda _params: (
        started.set(),
        {"turn": {"id": "title-turn"}},
    )[1]
    adapter.event.side_effect = asyncio.Event().wait
    with pytest.raises(asyncio.TimeoutError):
        await titles.generate_title("socket", {"cwd": "/demo"}, "标题")
    assert started.is_set()
    adapter.request.assert_any_await(
        "turn/interrupt", {"threadId": "helper", "turnId": "title-turn"}
    )
    adapter.request.assert_awaited_with("thread/unsubscribe", {"threadId": "helper"})
    adapter.close.assert_awaited_once()
