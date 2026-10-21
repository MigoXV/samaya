import os
from pathlib import Path
from unittest.mock import AsyncMock
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from samaya.config import Settings
from samaya.runtime import Runtime
from samaya.web.app import create_app


@pytest.fixture
def download_client(tmp_path, monkeypatch):
    monkeypatch.setattr(Runtime, "start", AsyncMock())
    app = create_app(
        Settings(
            data_dir=tmp_path / "state", token="download-test", secure_cookie=False
        )
    )
    with TestClient(app) as client:
        app.state.runtime.catalog.directory = AsyncMock(return_value=str(tmp_path))
        client.post("/api/login", json={"token": "download-test"})
        yield client


URL = "/api/threads/example/files/download"


@pytest.mark.parametrize(
    "link",
    [
        "报告 结果.csv",
        "./报告%20结果.csv",
        "{root}/报告 结果.csv",
        "file://{root}/报告%20结果.csv",
        "file://localhost{root}/报告%20结果.csv",
        "sandbox:{root}/报告%20结果.csv",
        "{root}/报告 结果.csv:12",
        "{root}/报告 结果.csv:12:3",
        "报告%20结果.csv#L12",
        "报告%20结果.csv#L12-L30",
        "报告%20结果.csv#L12C2-L30C5",
        "报告%20结果.csv:12",
    ],
)
def test_download_links(download_client, tmp_path, link):
    data = "音频,差异\nrita.wav,3\n".encode()
    (tmp_path / "报告 结果.csv").write_bytes(data)
    response = download_client.get(URL, params={"path": link.format(root=tmp_path)})
    assert response.status_code == 200
    assert response.content == data
    assert response.headers["content-disposition"] == (
        "attachment; filename*=utf-8''" + quote("报告 结果.csv")
    )
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize("name", ["report:12", "report#L12", "100%20results.csv"])
def test_literal_filename_wins(download_client, tmp_path, name):
    (tmp_path / name).write_bytes(b"literal")
    (tmp_path / "report").write_bytes(b"wrong")
    (tmp_path / "100 results.csv").write_bytes(b"wrong")
    response = download_client.get(URL, params={"path": str(tmp_path / name)})
    assert response.status_code == 200
    assert response.content == b"literal"


def test_head_range_and_large_file(download_client, tmp_path):
    path = tmp_path / "large.bin"
    with path.open("wb") as stream:
        for _ in range(33):
            stream.write(b"a" * 1024 * 1024)
    head = download_client.head(URL, params={"path": path.name})
    assert head.status_code == 200 and head.content == b""
    assert int(head.headers["content-length"]) == path.stat().st_size
    partial = download_client.get(
        URL, params={"path": path.name}, headers={"Range": "bytes=65530-65540"}
    )
    assert partial.status_code == 206 and partial.content == b"a" * 11
    assert (
        partial.headers["content-range"] == f"bytes 65530-65540/{path.stat().st_size}"
    )
    full = download_client.get(URL, params={"path": path.name})
    assert len(full.content) == path.stat().st_size


def test_authenticated_filesystem_scope(download_client, tmp_path):
    outside = tmp_path.parent / (tmp_path.name + "-outside.txt")
    outside.write_bytes(b"outside workspace")
    try:
        link = tmp_path / "linked.txt"
        link.symlink_to(outside)
        for path in [str(outside), "../" + outside.name, "linked.txt"]:
            response = download_client.get(URL, params={"path": path})
            assert response.status_code == 200
            assert response.content == b"outside workspace"
        assert 'filename="linked.txt"' in response.headers["content-disposition"]
    finally:
        outside.unlink()
    download_client.cookies.clear()
    for method in [download_client.get, download_client.head]:
        assert method(URL, params={"path": "linked.txt"}).status_code == 401


@pytest.mark.parametrize(
    "path,status",
    [
        ("missing.txt", 404),
        (".", 400),
        ("https://example.com/file", 400),
        ("file://remote-host/a.txt", 400),
        ("sandbox://remote-host/a.txt", 400),
        ("file:relative.txt", 400),
        ("javascript:alert(1)", 400),
        ("//example.com/a.txt", 400),
        ("#anchor", 400),
        ("%00", 400),
        ("a\nb.txt", 400),
        ("~samaya_missing_download_user/file.txt", 400),
    ],
)
def test_invalid_or_missing_file(download_client, path, status):
    response = download_client.get(
        URL, params={"path": path}, headers={"Accept": "text/html"}
    )
    assert response.status_code == status
    assert "detail" in response.json()
    assert download_client.head(URL, params={"path": path}).status_code == status


def test_special_files_and_permission_errors(download_client, tmp_path, monkeypatch):
    fifo = tmp_path / "pipe"
    os.mkfifo(fifo)
    assert download_client.get(URL, params={"path": "pipe"}).status_code == 400
    (tmp_path / "loop").symlink_to("loop")
    assert download_client.get(URL, params={"path": "loop"}).status_code == 400
    (tmp_path / "private.txt").write_text("private")
    original = Path.open

    def denied(path, *args, **kwargs):
        if path.name == "private.txt":
            raise PermissionError("denied")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", denied)
    assert download_client.get(URL, params={"path": "private.txt"}).status_code == 403
    assert download_client.head(URL, params={"path": "private.txt"}).status_code == 403
