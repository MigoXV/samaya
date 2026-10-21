from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from samaya.decisions.service import Decisions


async def test_advertised_approval_choices_are_enforced_and_sent_once():
    rule = {
        "acceptWithExecpolicyAmendment": {
            "execpolicy_amendment": ["git", "add", "example.txt"]
        }
    }
    connection = SimpleNamespace(
        connection_id="generation",
        connected=lambda: object(),
        rpc=AsyncMock(return_value={"sent": True}),
    )
    service = Decisions(connection, AsyncMock())
    request = {
        "id": 22,
        "method": "item/commandExecution/requestApproval",
        "params": {
            "threadId": "t",
            "turnId": "turn",
            "availableDecisions": ["accept", rule, "cancel"],
        },
    }
    service.observe(request)
    key = next(iter(service.pending))
    for decision in [
        "decline",
        "acceptForSession",
        {"acceptWithExecpolicyAmendment": {"execpolicy_amendment": ["git"]}},
    ]:
        with pytest.raises(ValueError, match="授权选项"):
            await service.respond(
                {"threadId": "t", "requestKey": key, "response": {"decision": decision}}
            )
    connection.rpc.assert_not_awaited()
    await service.respond(
        {"threadId": "t", "requestKey": key, "response": {"decision": rule}}
    )
    connection.rpc.assert_awaited_once_with(
        "samaya/serverRequest/respond", {"id": 22, "result": {"decision": rule}}
    )
    assert service.pending[key]["responseState"] == "sent"
    with pytest.raises(ValueError, match="已经提交"):
        await service.respond(
            {"threadId": "t", "requestKey": key, "response": {"decision": "accept"}}
        )
    service.observe(
        {
            "method": "serverRequest/resolved",
            "params": {"threadId": "t", "requestId": 22},
        }
    )
    assert not service.pending
