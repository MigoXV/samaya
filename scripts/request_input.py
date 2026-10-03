import asyncio
import json
import uuid
from pathlib import Path

import httpx

from samaya.codex.adapter import Adapter
from samaya.config import settings


async def main():
    report = json.loads(Path(".samaya/acceptance/api-report.json").read_text())
    tid = report["fixture"]
    a = Adapter(settings().socket)
    await a.start()
    await a.request(
        "thread/settings/update",
        {
            "threadId": tid,
            "approvalPolicy": "on-request",
            "collaborationMode": {
                "mode": "plan",
                "settings": {
                    "model": "gpt-6.1-sol",
                    "reasoning_effort": "low",
                    "developer_instructions": None,
                },
            },
        },
    )
    await a.close()
    async with httpx.AsyncClient(base_url="http://127.0.0.1:8765", timeout=80) as c:
        c.headers["X-Samaya-CSRF"] = (await c.get("/api/auth")).json()["csrf"]
        t = (await c.get("/api/threads/" + tid)).json()["thread"]
        r = await c.post(
            "/api/operations",
            json={
                "operationId": uuid.uuid4().hex,
                "action": "send",
                "body": {
                    "threadId": tid,
                    "expectedTurnId": t["turns"][-1]["id"],
                    "text": "Use the request_user_input tool now to ask me to choose between Small and Large for a test layout. This is a tool integration test. Do not proceed until I answer. Do not write any code or files.",
                },
            },
        )
        print(r.text, flush=True)
        for _ in range(90):
            d = (await c.get("/api/threads/" + tid)).json()
            if d["pendingRequests"]:
                print(json.dumps(d["pendingRequests"], ensure_ascii=False), flush=True)
                return
            await asyncio.sleep(1)


asyncio.run(main())
