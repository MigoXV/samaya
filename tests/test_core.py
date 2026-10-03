import asyncio
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from samaya.config import Settings
from samaya.runtime import Runtime
from samaya.sessions.models import parent_id
from samaya.store import Store
from samaya.web.app import create_app


def test_receipt_survives_restart_without_replay(tmp_path):
    store = Store(tmp_path)
    assert store.reserve("submission", {"text": "run once"})[0]
    store.close()
    reopened = Store(tmp_path)
    fresh, receipt = reopened.reserve("submission", {"text": "run once"})
    assert not fresh and receipt["state"] == "uncertain"
    with pytest.raises(ValueError):
        reopened.reserve("submission", {"text": "different"})
    reopened.close()


@pytest.mark.asyncio
async def test_browser_disconnect_does_not_cancel_submission(tmp_path):
    store = Store(tmp_path)
    service = Runtime(Settings(data_dir=tmp_path), store)
    started, release = asyncio.Event(), asyncio.Event()

    async def work(action, body):
        started.set()
        await release.wait()
        return {"turn": "one"}

    service.operations.dispatch = AsyncMock(side_effect=work)
    request = asyncio.create_task(
        service.operations.execute(
            "once",
            "send",
            {"threadId": "a", "text": "run once", "expectedTurnId": None},
        )
    )
    await started.wait()
    request.cancel()
    with pytest.raises(asyncio.CancelledError):
        await request
    duplicate = await service.operations.execute(
        "once", "send", {"threadId": "a", "text": "run once", "expectedTurnId": None}
    )
    assert duplicate["state"] == "pending"
    release.set()
    await asyncio.gather(*service.operations.tasks)
    receipt = await service.operations.execute(
        "once", "send", {"threadId": "a", "text": "run once", "expectedTurnId": None}
    )
    assert receipt["state"] == "succeeded"
    assert service.operations.dispatch.await_count == 1
    store.close()


@pytest.mark.asyncio
async def test_interrupt_rejects_stale_turn_without_touching_others(tmp_path):
    store = Store(tmp_path)
    service = Runtime(Settings(data_dir=tmp_path), store)
    service.connection.state = "connected"
    service.connection.adapter = object()
    service.sessions.read = AsyncMock(
        return_value={"thread": {"turns": [{"id": "new", "status": "inProgress"}]}}
    )
    service.connection.rpc = AsyncMock()
    result = await service.operations.execute(
        "stale", "interrupt", {"threadId": "only-a", "turnId": "old"}
    )
    assert result["state"] == "failed"
    service.connection.rpc.assert_not_called()
    store.close()


def test_directory_symlink_escape_and_relationship(tmp_path):
    allowed = tmp_path / "root"
    allowed.mkdir()
    outside = tmp_path / "private"
    outside.mkdir()
    (allowed / "link").symlink_to(outside)
    config = Settings(roots=[allowed])
    with pytest.raises(ValueError):
        config.directory(str(allowed / "link"))
    assert (
        parent_id(
            {"source": {"subAgent": {"thread_spawn": {"parent_thread_id": "parent"}}}}
        )
        == "parent"
    )
    assert parent_id({"forkedFromId": "source", "source": "cli"}) is None


@pytest.fixture
def web(tmp_path, monkeypatch):
    monkeypatch.setattr(Runtime, "start", AsyncMock())
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>Samaya</html>")
    (dist / "assets").mkdir()
    (dist / "assets/app.js").write_text("export const samaya = true")
    config = Settings(data_dir=tmp_path / "data", dist=dist, roots=[tmp_path])
    return config


def test_spa_api_and_actual_assets(web):
    with TestClient(create_app(web)) as client:
        for path in ["/", "/sessions", "/settings/deep"]:
            assert (
                client.get(path, headers={"Accept": "text/html"}).text
                == "<html>Samaya</html>"
            )
        assert client.get("/assets/app.js").status_code == 200
        assert client.get("/assets/no.js").status_code == 404
        assert client.get("/openapi.json").json()["info"]["title"] == "Samaya"
        for accept in ["text/html", "application/json"]:
            r = client.get("/api/unknown", headers={"Accept": accept})
            assert r.status_code == 404 and r.headers["content-type"].startswith(
                "application/json"
            )
        assert client.post("/api/logout").status_code == 403
        csrf = client.get("/api/auth").json()["csrf"]
        assert (
            client.post("/api/logout", headers={"X-Samaya-CSRF": csrf}).status_code
            == 200
        )
        assert (
            client.get("/api/status", headers={"Host": "attacker.example"}).status_code
            == 403
        )


def test_auth_csrf_and_cross_site(web):
    web.token = "test-only-long-token"
    with TestClient(create_app(web)) as client:
        assert client.get("/api/status").status_code == 401
        assert client.get("/openapi.json").status_code == 401
        assert client.post("/api/login", json={"token": "wrong"}).status_code == 401
        r = client.post("/api/login", json={"token": web.token})
        assert r.status_code == 200 and "HttpOnly" in r.headers["set-cookie"]
        csrf = r.json()["csrf"]
        assert client.get("/api/status").status_code == 200
        assert (
            client.post(
                "/api/logout",
                headers={"Origin": "https://evil.example", "X-Samaya-CSRF": csrf},
            ).status_code
            == 403
        )
        assert (
            client.post("/api/logout", headers={"X-Samaya-CSRF": csrf}).status_code
            == 200
        )
        assert client.get("/api/status").status_code == 401


def test_missing_dist_has_actionable_error(web):
    (web.dist / "index.html").unlink()
    with (
        pytest.raises(RuntimeError, match="pnpm --dir src/web run build"),
        TestClient(create_app(web)),
    ):
        pass


def test_debug_config():
    import json

    launch = json.loads(Path(".vscode/launch.json").read_text())["configurations"]
    task = json.loads(Path(".vscode/tasks.json").read_text())["tasks"][0]
    assert task["label"] == "web: build" and task["options"]["cwd"].endswith("/src/web")
    for item in launch:
        assert item["envFile"] == "${workspaceFolder}/.env"
        assert ("preLaunchTask" in item) == (item["name"] == "backend")


@pytest.mark.asyncio
async def test_archived_history_stays_readable_when_subscription_rejected(tmp_path):
    from openai_codex.errors import InvalidRequestError

    store = Store(tmp_path)
    service = Runtime(Settings(data_dir=tmp_path), store)
    service.sessions.join = AsyncMock(
        side_effect=InvalidRequestError(-32600, "thread is archived")
    )
    service.connection.rpc = AsyncMock(
        return_value={
            "thread": {
                "id": "archived",
                "preview": "history",
                "source": "cli",
                "turns": [{"id": "past", "status": "completed", "items": []}],
            }
        }
    )
    result = await service.sessions.read("archived", subscribe=True)
    assert result["thread"]["turns"][0]["id"] == "past"
    assert "archived" in result["subscriptionNotice"]
    store.close()


def test_second_instance_cannot_reclassify_live_receipts(tmp_path):
    store = Store(tmp_path)
    store.reserve("inflight", {"action": "send"})
    with pytest.raises(RuntimeError, match="一个 worker"):
        Store(tmp_path)
    assert store.receipt("inflight")["state"] == "pending"
    store.close()


@pytest.mark.asyncio
async def test_created_thread_identity_survives_optional_setup_failure(tmp_path):
    from types import SimpleNamespace

    from openai_codex.errors import InvalidRequestError

    store = Store(tmp_path)
    service = Runtime(Settings(data_dir=tmp_path, roots=[tmp_path]), store)
    service.connection.state = "connected"
    service.connection.adapter = SimpleNamespace(
        sdk=SimpleNamespace(
            thread_start=AsyncMock(return_value=SimpleNamespace(id="created-once"))
        )
    )
    service.connection.rpc = AsyncMock(
        side_effect=InvalidRequestError(-32600, "settings unavailable")
    )
    result = await service.operations.execute(
        "create-once", "create", {"cwd": str(tmp_path)}
    )
    assert result["state"] == "succeeded"
    assert result["result"]["threadId"] == "created-once"
    assert result["result"]["warning"]
    store.close()


def test_moved_routes_keep_monitor_history_and_operation_contracts(web):
    with TestClient(create_app(web)) as client:
        runtime = client.app.state.runtime
        snapshot = client.get("/api/monitor").json()
        assert snapshot["initialized"] is False
        assert snapshot["records"] == []
        runtime.sessions.read = AsyncMock(return_value={"thread": {"id": "one"}})
        runtime.sessions.turns = AsyncMock(return_value={"data": [{"id": "turn"}]})
        runtime.sessions.items = AsyncMock(
            return_value={"data": [], "nextCursor": None}
        )
        assert client.get("/api/threads/one").json() == {"thread": {"id": "one"}}
        assert client.get("/api/threads/one/turns").json()["data"] == [{"id": "turn"}]
        assert client.get("/api/threads/one/turns/turn/items").json()["data"] == []
        summary = client.get("/api/threads/one/turns/turn/summary").json()
        assert summary["threadId"] == "one" and summary["turnId"] == "turn"
        csrf = client.get("/api/auth").json()["csrf"]
        runtime.operations.dispatch = AsyncMock(return_value={"threadId": "one"})
        body = {
            "operationId": "test-operation-identity",
            "action": "send",
            "body": {"threadId": "one", "text": "once", "expectedTurnId": None},
        }
        first = client.post(
            "/api/operations", json=body, headers={"X-Samaya-CSRF": csrf}
        )
        again = client.post(
            "/api/operations", json=body, headers={"X-Samaya-CSRF": csrf}
        )
        assert first.json() == again.json()
        assert first.json()["state"] == "succeeded"
        assert (
            client.get("/api/operations/test-operation-identity").json() == first.json()
        )
        runtime.operations.dispatch.assert_awaited_once()
