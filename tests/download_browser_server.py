"""Isolated real HTTP file downloads for the Playwright regression test."""

import json
import os
import socket
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, patch

import uvicorn


def main():
    with TemporaryDirectory(prefix="samaya-download-test-") as directory:
        root = Path(directory)
        os.environ.update(
            SAMAYA_TOKEN="isolated-download-test",
            SAMAYA_SECURE_COOKIE="false",
            SAMAYA_DATA_DIR=str(root / "state"),
            SAMAYA_SOCKET=str(root / "unused.sock"),
        )
        from samaya.config import Settings
        from samaya.runtime import Runtime
        from samaya.web.app import create_app

        data = "音频,差异\nrita.wav,3\n\x00binary\n".encode()
        (root / "exports").mkdir()
        for name in [
            "识别结果 对比.csv",
            "exports/报告 结果.csv",
            "app.py",
            "retry.csv",
            "long.csv",
        ]:
            (root / name).write_bytes(data)

        async def offline_start(runtime):
            # Native conversations remain untouched; only cwd lookup is stubbed.
            runtime.sessions.read = AsyncMock(
                return_value={"thread": {"cwd": str(root)}}
            )

        with patch.object(Runtime, "start", offline_start):
            app = create_app(Settings())
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
                print(
                    "SAMAYA_DOWNLOAD_TEST="
                    + json.dumps(
                        {"url": f"http://127.0.0.1:{port}", "root": str(root)}
                    ),
                    flush=True,
                )
                uvicorn.Server(
                    uvicorn.Config(app, log_level="error", timeout_graceful_shutdown=1)
                ).run(sockets=[sock])


if __name__ == "__main__":
    main()
