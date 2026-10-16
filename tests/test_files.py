import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from samaya.composer.catalog import InputCatalog
from samaya.composer.files import UploadTooLarge, attachment_text, file_ids, save_upload
from samaya.config import Settings
from samaya.operations import Operations
from samaya.runtime import Runtime
from samaya.web.app import create_app


async def chunks(*values):
    for value in values:
        yield value


async def test_upload_bytes_scoping_and_reference(tmp_path):
    metadata = await save_upload(
        tmp_path, "C:\\资料\\需求.pdf", chunks(b"hello", b" world")
    )
    assert metadata["name"] == "需求.pdf" and metadata["size"] == 11
    content = attachment_text(tmp_path, [{"id": metadata["id"]}])
    files = json.loads(content.split("\n")[3])["files"]
    from pathlib import Path

    assert Path(files[0]["path"]).read_bytes() == b"hello world"
    other = tmp_path / "other"
    other.mkdir()
    with pytest.raises(ValueError):
        attachment_text(other, [{"id": metadata["id"]}])
    Operations.validate_action(
        "send",
        {
            "threadId": "t",
            "text": "",
            "files": [{"id": metadata["id"]}],
            "expectedTurnId": None,
        },
    )


async def test_limits_abort_and_missing_file_cleanup(tmp_path, monkeypatch):
    monkeypatch.setattr("samaya.composer.files.MAX_FILE_BYTES", 4)
    with pytest.raises(UploadTooLarge):
        await save_upload(tmp_path, "large.txt", chunks(b"123", b"45"))
    assert not list((tmp_path / ".samaya/uploads").iterdir())

    async def interrupted():
        yield b"a"
        raise ConnectionError("disconnected")

    with pytest.raises(ConnectionError):
        await save_upload(tmp_path, "partial.txt", interrupted())
    assert not list((tmp_path / ".samaya/uploads").iterdir())
    m = await save_upload(tmp_path, "small.txt", chunks(b"123"))
    folder = tmp_path / ".samaya/uploads" / m["id"]
    (folder / "payload.txt").unlink()
    with pytest.raises(ValueError):
        attachment_text(tmp_path, [{"id": m["id"]}])


def test_invalid_ids_and_directory_escape(tmp_path):
    for files in [
        None,
        [{"id": "../escape"}],
        [{"id": "a" * 32}] * 2,
        [{}],
        [{"id": "a" * 32}] * 6,
    ]:
        with pytest.raises(ValueError):
            file_ids(files)
    outside = tmp_path / "outside"
    outside.mkdir()
    cwd = tmp_path / "work"
    cwd.mkdir()
    (cwd / ".samaya").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        attachment_text(cwd, [])


@pytest.mark.parametrize("action", ["send", "steer"])
async def test_uploaded_files_reach_native_inputs(tmp_path, action):
    from samaya.sessions.actions import SessionActions

    m = await save_upload(tmp_path, "notes.txt", chunks(b"uploaded document"))
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
    config = Settings(roots=[tmp_path])
    actions = SessionActions(
        config, connection, SimpleNamespace(watch=lambda _: None), queries
    )
    actions.catalog = InputCatalog(config, connection, queries)
    body = {
        "threadId": "t",
        "text": "",
        "files": [{"id": m["id"]}],
        "expectedCwd": str(tmp_path),
        "expectedTurnId": "turn",
    }
    await actions.execute(action, body)
    method, params = connection.rpc.call_args.args
    assert method == "turn/" + ("start" if action == "send" else "steer")
    assert (
        params["input"][0]["type"] == "text"
        and "notes.txt" in params["input"][0]["text"]
    )
    body["expectedCwd"] = str(tmp_path / "missing")
    with pytest.raises(ValueError):
        await actions.execute(action, body)


def test_http_upload_auth_and_stream_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(Runtime, "start", AsyncMock())
    app = create_app(
        Settings(data_dir=tmp_path / "state", token="", secure_cookie=False)
    )
    with TestClient(app) as client:
        assert (
            client.post(
                "/api/uploads",
                params={"filename": "x.txt", "cwd": str(tmp_path)},
                content=b"x",
            ).status_code
            == 403
        )
        headers = {
            "X-Samaya-CSRF": client.get("/api/auth").json()["csrf"],
            "Content-Type": "application/octet-stream",
        }
        response = client.post(
            "/api/uploads",
            params={"filename": "x.txt", "cwd": str(tmp_path)},
            content=b"hello",
            headers=headers,
        )
        assert response.status_code == 200
        metadata = response.json()
        assert metadata["size"] == 5 and "path" not in metadata
        assert "x.txt" in attachment_text(tmp_path, [{"id": metadata["id"]}])
        monkeypatch.setattr("samaya.composer.files.MAX_FILE_BYTES", 4)
        assert (
            client.post(
                "/api/uploads",
                params={"filename": "large.txt", "cwd": str(tmp_path)},
                content=b"12345",
                headers=headers,
            ).status_code
            == 413
        )
        app.state.runtime.sessions.read = AsyncMock(
            return_value={"thread": {"cwd": str(tmp_path)}}
        )
        other = tmp_path / "other"
        other.mkdir()
        assert (
            client.post(
                "/api/uploads",
                params={"filename": "x.txt", "cwd": str(other), "threadId": "t"},
                content=b"x",
                headers=headers,
            ).status_code
            == 409
        )


async def test_total_size_and_payload_symlink_are_rejected(tmp_path, monkeypatch):
    first = await save_upload(tmp_path, "one.txt", chunks(b"123"))
    second = await save_upload(tmp_path, "two.txt", chunks(b"456"))
    monkeypatch.setattr("samaya.composer.files.MAX_TOTAL_FILE_BYTES", 5)
    with pytest.raises(ValueError, match="50 MB"):
        attachment_text(tmp_path, [{"id": first["id"]}, {"id": second["id"]}])
    payload = tmp_path / ".samaya/uploads" / first["id"] / "payload.txt"
    payload.unlink()
    outside = tmp_path / "private.txt"
    outside.write_bytes(b"123")
    payload.symlink_to(outside)
    with pytest.raises(ValueError, match="已变化"):
        attachment_text(tmp_path, [{"id": first["id"]}])


async def test_cancelled_upload_is_cleaned_up(tmp_path):
    import asyncio

    async def cancelled():
        yield b"partial"
        raise asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        await save_upload(tmp_path, "cancelled.txt", cancelled())
    assert not list((tmp_path / ".samaya/uploads").iterdir())
