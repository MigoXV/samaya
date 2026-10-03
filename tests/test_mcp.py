import asyncio
import copy
from unittest.mock import AsyncMock

import pytest

from samaya.codex import mcp
from samaya.codex.service import CodexService
from samaya.config import Settings
from samaya.store import Store

SCHEMA = {
    "type": "object",
    "properties": {
        "text": {"type": "string", "minLength": 2, "maxLength": 8},
        "count": {"type": "integer", "minimum": 0, "maximum": 3},
        "ratio": {"type": "number", "minimum": 0, "maximum": 1},
        "flag": {"type": "boolean"},
        "choice": {"type": "string", "enum": ["a", "b"], "enumNames": ["甲", "乙"]},
        "titled": {"type": "string", "oneOf": [{"const": "x", "title": "选项"}]},
        "many": {
            "type": "array",
            "items": {"type": "string", "enum": ["x", "y"]},
            "minItems": 1,
            "maxItems": 2,
        },
        "titledMany": {
            "type": "array",
            "items": {"anyOf": [{"const": "x", "title": "选项"}]},
        },
        "email": {"type": "string", "format": "email"},
        "uri": {"type": "string", "format": "uri"},
        "date": {"type": "string", "format": "date"},
        "time": {"type": "string", "format": "date-time"},
        "optional": {"type": "boolean", "default": None},
    },
    "required": ["text", "count", "flag", "many"],
}
VALUES = {
    "text": "报告",
    "count": 0,
    "ratio": 0.5,
    "flag": False,
    "choice": "a",
    "titled": "x",
    "many": ["x"],
    "titledMany": ["x"],
    "email": "a@example.com",
    "uri": "urn:example:test",
    "date": "2026-10-03",
    "time": "2026-10-03T12:00:00Z",
}
PARAMS = {
    "threadId": "fixture",
    "turnId": None,
    "mode": "form",
    "serverName": "fixture",
    "requestedSchema": SCHEMA,
}


def test_standard_form_preserves_types_and_omissions():
    assert mcp.presentation(PARAMS)["mode"] == "form"
    r = mcp.validate_response(PARAMS, {"action": "accept", "content": VALUES})
    assert r["content"]["flag"] is False and r["content"]["count"] == 0
    assert "optional" not in r["content"]
    assert SCHEMA["properties"]["optional"]["default"] is None


@pytest.mark.parametrize(
    "field,value",
    [
        ("text", "a"),
        ("text", "long" * 3),
        ("count", True),
        ("count", -1),
        ("count", 1.2),
        ("ratio", float("nan")),
        ("flag", "false"),
        ("choice", "c"),
        ("many", []),
        ("many", ["z"]),
        ("email", "bad"),
        ("uri", "relative"),
        ("date", "2026-02-30"),
        ("time", "2026-10-03T12:00:00"),
        ("extra", "undeclared"),
    ],
)
def test_form_rejects_invalid_responses(field, value):
    with pytest.raises(ValueError):
        mcp.validate_response(
            PARAMS, {"action": "accept", "content": {**VALUES, field: value}}
        )


def test_unsupported_modes_and_schemas_fail_closed_but_can_cancel():
    for mode in ["openai/form", "openaiForm", "openai/userVerification", "future"]:
        params = {**PARAMS, "mode": mode}
        assert mcp.presentation(params)["mode"] == "unsupported"
        with pytest.raises(ValueError):
            mcp.validate_response(params, {"action": "accept", "content": {}})
        for action in ["decline", "cancel"]:
            assert mcp.validate_response(
                params, {"action": action, "content": "secret"}
            ) == {"action": action, "content": None}
    for field in [
        {"type": "object"},
        {"type": "string", "$ref": "https://example.com/schema"},
        {"type": "string", "pattern": ".*"},
    ]:
        assert (
            mcp.presentation(
                {
                    **PARAMS,
                    "requestedSchema": {"type": "object", "properties": {"x": field}},
                }
            )["mode"]
            == "unsupported"
        )


def test_url_accept_is_only_a_decision():
    params = {**PARAMS, "mode": "url", "url": "https://example.com/auth?token=private"}
    assert mcp.presentation(params)["host"] == "example.com"
    assert mcp.validate_response(
        params, {"action": "accept", "content": {"authorized": True}}
    ) == {"action": "accept", "content": None}
    for url in [
        "javascript:alert(1)",
        "//example.com",
        "https://user:pass@example.com",
        "https://",
        "https://example.com\n",
    ]:
        assert mcp.presentation({**params, "url": url})["mode"] == "unsupported"


def test_mcp_identity_is_independent_of_turn():
    for turn in [None, "t"]:
        req = {"id": 1, "method": mcp.METHOD, "params": {**PARAMS, "turnId": turn}}
        assert not mcp.resolved_by(
            req, "turn/completed", {"threadId": "fixture", "turn": {"id": "t"}}
        )
        assert not mcp.resolved_by(req, "serverRequest/resolved", {"requestId": 2})
        assert not mcp.resolved_by(
            req, "serverRequest/resolved", {"requestId": 1, "threadId": "other"}
        )
        assert mcp.resolved_by(
            req, "serverRequest/resolved", {"requestId": 1, "threadId": "fixture"}
        )


@pytest.mark.asyncio
async def test_multiple_pages_and_uncertain_response_do_not_resubmit(tmp_path):
    store = Store(tmp_path)
    service = CodexService(Settings(data_dir=tmp_path), store)
    service.connection = "connected"
    service.adapter = object()
    request = {
        "id": 7,
        "method": mcp.METHOD,
        "params": copy.deepcopy(PARAMS),
        "key": "connection:7",
    }
    body = {
        "threadId": "fixture",
        "requestKey": request["key"],
        "response": {"action": "accept", "content": VALUES},
    }
    service.pending[request["key"]] = request
    service.rpc = AsyncMock(return_value={"sent": True})
    result = await asyncio.gather(
        service.execute("a", "respond", body), service.execute("b", "respond", body)
    )
    assert sorted(r["state"] for r in result) == ["failed", "succeeded"]
    assert service.rpc.await_count == 1
    assert service.pending[request["key"]]["responseState"] == "sent"
    assert (await service.execute("a", "respond", body))["state"] == "succeeded"
    service.pending[request["key"]] = {**request, "responseState": None}
    service.rpc = AsyncMock(side_effect=TimeoutError("response lost"))
    assert (await service.execute("c", "respond", body))["state"] == "uncertain"
    assert (await service.execute("d", "respond", body))["state"] == "failed"
    assert service.rpc.await_count == 1
    await service.publish(
        {
            "id": 8,
            "method": mcp.METHOD,
            "params": {**PARAMS, "url": "https://example.com/?secret=PRIVATE"},
        }
    )
    assert "PRIVATE" not in str(store.events(0))
    assert "requestedSchema" not in str(store.events(0))
    store.close()
