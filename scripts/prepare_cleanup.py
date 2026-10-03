import asyncio
import json
import uuid
from pathlib import Path

import httpx


async def main():
    path = Path(".samaya/acceptance/api-report.json")
    report = json.loads(path.read_text())
    cwd = json.loads(Path(".samaya/acceptance/thread.json").read_text())["a"]
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

        tid = report["fixture"]
        for p in (await c.get("/api/threads/" + tid + "/terminals")).json()["data"]:
            await op("terminate", {"threadId": tid, "processId": p["processId"]})
        r = await op("create", {"cwd": cwd, "name": "Samaya 验收 · 批量运行中"})
        busy = r["result"]["threadId"]
        r = await op(
            "send",
            {
                "threadId": busy,
                "expectedTurnId": None,
                "text": "Run sleep 150 and wait for it to complete. Do not do anything else.",
            },
        )
        report["batchFixture"] = busy
        report["batchTurn"] = r["result"]["turn"]["id"]
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(busy, flush=True)


asyncio.run(main())
