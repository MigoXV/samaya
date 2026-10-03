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
    other = json.loads(Path(".samaya/acceptance/thread.json").read_text())["threadId"]
    a = Adapter(settings().socket)
    await a.start()
    await a.request(
        "thread/settings/update",
        {
            "threadId": tid,
            "approvalPolicy": "never",
            "collaborationMode": {
                "mode": "default",
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

        async def op(action, body):
            return (
                await c.post(
                    "/api/operations",
                    json={
                        "operationId": uuid.uuid4().hex,
                        "action": action,
                        "body": body,
                    },
                )
            ).json()

        t = (await c.get("/api/threads/" + tid)).json()["thread"]
        r = await op(
            "send",
            {
                "threadId": tid,
                "expectedTurnId": t["turns"][-1]["id"],
                "text": "Run sleep 120 and wait until it completes. Do not do any other work.",
            },
        )
        turn = r["result"]["turn"]["id"]
        await asyncio.sleep(3)
        before = (await c.get("/api/threads/" + other)).json()["thread"]
        stopped = await op("interrupt", {"threadId": tid, "turnId": turn})
        after = (await c.get("/api/threads/" + other)).json()["thread"]
        report["interrupt_isolated"] = {
            "result": stopped,
            "otherBefore": before["status"],
            "otherAfter": after["status"],
            "otherTurn": after["turns"][-1]["id"],
        }
        Path(".samaya/acceptance/api-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2)
        )
        print(json.dumps(report["interrupt_isolated"]), flush=True)


asyncio.run(main())
