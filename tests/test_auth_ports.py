from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import Cookies

from samaya.config import Settings
from samaya.web.auth import register_auth


def test_same_host_ports_keep_independent_sessions(tmp_path):
    clients = []
    for port in (8000, 8765):
        app = FastAPI()
        register_auth(
            app,
            Settings(data_dir=tmp_path / str(port), token="same-password", secure_cookie=True),
        )
        clients.append(TestClient(app, base_url=f"https://server:{port}"))
    first, second = clients
    browser = Cookies()
    for client in clients:
        client.cookies = browser
        response = client.post("/api/login", json={"token": "same-password"})
        assert response.status_code == 200
        browser.update(client.cookies)

    assert {cookie.name for cookie in browser.jar} == {
        "samaya_session_8000", "samaya_session_8765"
    }
    for client in clients:
        client.cookies = browser
        assert client.get("/api/auth").json()["authenticated"]

    csrf = second.get("/api/auth").json()["csrf"]
    response = second.post("/api/logout", headers={"X-Samaya-CSRF": csrf})
    assert "samaya_session_8765=" in response.headers["set-cookie"]
    assert not second.get("/api/auth").json()["authenticated"]
    assert first.get("/api/auth").json()["authenticated"]


def test_session_survives_app_restart(tmp_path):
    config = Settings(data_dir=tmp_path, token="password")
    app = FastAPI()
    register_auth(app, config)
    first = TestClient(app, base_url="https://server:8765")
    first.post("/api/login", json={"token": "password"})
    restarted = FastAPI()
    register_auth(restarted, config)
    second = TestClient(restarted, base_url="https://server:8765", cookies=first.cookies)
    assert second.get("/api/auth").json()["authenticated"]
