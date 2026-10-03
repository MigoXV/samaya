"""Opt-in: real Codex/MCP/browser test harness; thread-scoped MCP configuration."""

import asyncio
import json
import sys
import uuid
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import HTMLResponse

from samaya.config import Settings
from samaya.web.app import create_app

BASE = Path(__file__).resolve().parents[1] / ".samaya/acceptance/mcp"


async def main():
    BASE.mkdir(parents=True, exist_ok=True)
    for name in ("finish", "authorized", "responses.jsonl", "calls.jsonl"):
        (BASE / name).unlink(missing_ok=True)
    (BASE / "project").mkdir(exist_ok=True)
    app = create_app(Settings(data_dir=BASE / "state"))
    auth = FastAPI()

    @auth.get("/authorize", response_class=HTMLResponse)
    async def authorize():
        return '<html lang="zh"><title>MCP 本地验收授权</title><body><form method="post"><button>完成测试授权</button></form></body></html>'

    @auth.post("/authorize", response_class=HTMLResponse)
    async def authorized():
        (BASE / "authorized").touch()
        return '<html lang="zh"><title>已完成</title><body>本地测试授权已完成。可返回 Samaya。</body></html>'

    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=8766, log_level="warning")
    )
    auth_server = uvicorn.Server(
        uvicorn.Config(auth, host="127.0.0.1", port=8767, log_level="warning")
    )
    tasks = [asyncio.create_task(s.serve()) for s in [server, auth_server]]
    try:
        while not server.started:
            await asyncio.sleep(0.1)
        service = app.state.service
        await asyncio.wait_for(service.ready.wait(), 20)
        created = await service.rpc(
            "thread/start",
            {
                "cwd": str(BASE / "project"),
                "approvalPolicy": "on-request",
                "sandbox": "workspace-write",
                "config": {
                    "mcp_servers.samaya_acceptance": {
                        "command": sys.executable,
                        "args": [
                            str(Path(__file__).with_name("fixtures") / "mcp_server.py"),
                            str(BASE),
                        ],
                        "tool_timeout_sec": 300,
                    }
                },
            },
        )
        tid = created["thread"]["id"]
        await service.rpc(
            "thread/name/set", {"threadId": tid, "name": "Samaya MCP 真实验收 · 可删除"}
        )
        service.store.watch(tid)
        (BASE / "fixture.json").write_text(
            json.dumps({"threadId": tid, "url": f"http://127.0.0.1:8766/?thread={tid}"})
        )
        print("FIXTURE", tid, flush=True)
        result = await service.execute(
            uuid.uuid4().hex,
            "send",
            {
                "threadId": tid,
                "text": "Call the MCP tool samaya_acceptance collect with mode form exactly once. Wait for the user form response. Report the result. Do not use other tools.",
                "expectedTurnId": None,
            },
        )
        print("SEND", result["state"], flush=True)
        while not (BASE / "finish").exists():
            await asyncio.sleep(1)
    finally:
        server.should_exit = auth_server.should_exit = True
        await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(main())
