from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from samaya.operations import Operations
from samaya.sessions.actions import SessionActions
from samaya.store import Store


async def test_shell_uses_native_thread_command_and_preserves_syntax(tmp_path):
    connection = SimpleNamespace(
        connected=lambda: object(), connection_id="g", rpc=AsyncMock(return_value={})
    )
    queries = SimpleNamespace(
        join=AsyncMock(),
        read=AsyncMock(return_value={"thread": {"cwd": str(tmp_path)}}),
        fresh_threads={("g", "t")},
    )
    store = Store(tmp_path / "state")
    try:
        actions = SessionActions(
            SimpleNamespace(directory=lambda p: p), connection, store, queries
        )
        command = "printf '%s\\n' 'a b' | cat; printf error >&2; exit 7"
        await actions.execute(
            "shell", {"threadId": "t", "command": command, "expectedCwd": str(tmp_path)}
        )
        connection.rpc.assert_awaited_once_with(
            "thread/shellCommand", {"threadId": "t", "command": command}
        )
        assert ("g", "t") not in queries.fresh_threads
        connection.rpc.reset_mock()
        with pytest.raises(ValueError, match="工作目录"):
            await actions.execute(
                "shell", {"threadId": "t", "command": "pwd", "expectedCwd": "/other"}
            )
        connection.rpc.assert_not_awaited()
        queries.read.return_value["thread"]["canAcceptDirectInput"] = False
        with pytest.raises(ValueError, match="子智能体"):
            await actions.execute(
                "shell",
                {"threadId": "t", "command": "pwd", "expectedCwd": str(tmp_path)},
            )
        connection.rpc.assert_not_awaited()
    finally:
        store.close()


@pytest.mark.parametrize(
    "change",
    [
        {"command": " "},
        {"expectedCwd": ""},
        {"images": [{"url": "x"}]},
        {"files": ["x"]},
        {"references": [{"name": "x"}]},
    ],
)
def test_shell_rejects_empty_command_and_attachments(change):
    with pytest.raises(ValueError):
        Operations.validate_action(
            "shell",
            {"threadId": "t", "command": "pwd", "expectedCwd": "/tmp", **change},
        )
