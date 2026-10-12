import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from samaya.composer.catalog import InputCatalog
from samaya.composer.images import MAX_IMAGE_BYTES, message_inputs
from samaya.config import Settings
from samaya.operations import Operations
from samaya.sessions.actions import SessionActions

PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4AWJiYGD4D8IgBpBmYAAAAAD//7vS9wEAAAAGSURBVAMAGDACA6ybwrYAAAAASUVORK5CYII="


def test_text_and_image_only_inputs():
    image = {"url": PNG}
    assert message_inputs("检查图片", [image]) == [
        {"type": "text", "text": "检查图片"},
        {"type": "image", "url": PNG},
    ]
    assert message_inputs("", [image]) == [{"type": "image", "url": PNG}]
    Operations.validate_action(
        "send", {"threadId": "t", "text": "", "images": [image], "expectedTurnId": None}
    )


@pytest.mark.parametrize(
    "images",
    [
        None,
        [{"url": "https://example.com/image.png"}],
        [{"url": "data:image/svg+xml;base64,AAAA"}],
        [{"url": "data:image/png;base64,AAAA"}],
        [{"url": "data:image/png;base64,A="}],
        [{"url": PNG}] * 6,
        [{"url": "data:image/png;base64," + "A" * (MAX_IMAGE_BYTES * 2)}],
    ],
)
def test_invalid_images_are_rejected(images):
    with pytest.raises(ValueError):
        message_inputs("查看", images)
    with pytest.raises(ValueError):
        Operations.validate_action(
            "steer",
            {
                "threadId": "t",
                "text": "查看",
                "images": images,
                "expectedTurnId": "turn",
            },
        )


def test_empty_messages_and_total_limit():
    with pytest.raises(ValueError, match="不能为空"):
        message_inputs(" ", [])
    data = b"\x89PNG\r\n\x1a\n" + b"x" * (4 * 1024 * 1024)
    url = "data:image/png;base64," + base64.b64encode(data).decode()
    with pytest.raises(ValueError, match="10 MB"):
        message_inputs("查看", [{"url": url}] * 3)


@pytest.mark.parametrize("action", ["send", "steer"])
async def test_images_reach_native_turn_calls(tmp_path, action):
    thread = {
        "id": "t",
        "cwd": str(tmp_path),
        "turns": [{"id": "turn", "status": "inProgress"}],
    }
    connection = SimpleNamespace(
        connected=lambda: True, connection_id="test", rpc=AsyncMock(return_value={})
    )
    queries = SimpleNamespace(
        join=AsyncMock(),
        idle=AsyncMock(return_value=thread),
        read=AsyncMock(return_value={"thread": thread}),
        fresh_threads=set(),
    )
    store = SimpleNamespace(watch=lambda _: None)
    config = Settings(roots=[tmp_path])
    actions = SessionActions(config, connection, store, queries)
    actions.catalog = InputCatalog(config, connection, queries)
    await actions.execute(
        action,
        {
            "threadId": "t",
            "text": "",
            "images": [{"url": PNG}],
            "expectedTurnId": "turn",
        },
    )
    params = {"threadId": "t", "input": [{"type": "image", "url": PNG}]}
    if action == "steer":
        params["expectedTurnId"] = "turn"
    connection.rpc.assert_awaited_once_with(
        "turn/" + ("start" if action == "send" else "steer"), params
    )
