import asyncio
import json
import uuid
from pathlib import Path

import httpx


async def main():
    path = Path(".samaya/acceptance/api-report.json")
    report = json.loads(path.read_text())
    async with httpx.AsyncClient(
        base_url="http://127.0.0.1:8765", timeout=80
    ) as client:
        client.headers["X-Samaya-CSRF"] = (await client.get("/api/auth")).json()["csrf"]

        async def get(p):
            response = await client.get("/api" + p)
            response.raise_for_status()
            return response.json()

        async def op(action, body):
            result = (
                await client.post(
                    "/api/operations",
                    json={
                        "operationId": uuid.uuid4().hex,
                        "action": action,
                        "body": body,
                    },
                )
            ).json()
            print(action, json.dumps(result, ensure_ascii=False), flush=True)
            return result

        tid = report["fixture"]
        archived = await get("/threads?archived=true")
        report["archived_correct"] = any(t["id"] == tid for t in archived["data"])
        # Archived history should remain readable without accidentally restoring it.
        read = await client.get("/api/threads/" + tid + "?subscribe=true")
        report["archived_read_status"] = read.status_code
        report["unarchive"] = await op("unarchive", {"threadId": tid})
        active = await get("/threads")
        report["unarchive_visible"] = any(t["id"] == tid for t in active["data"])
        preview = await get("/threads/" + tid + "/cleanup-preview")
        report["delete"] = await op(
            "delete", {"threadId": tid, "digest": preview["digest"]}
        )
        active = await get("/threads")
        report["delete_absent"] = not any(t["id"] == tid for t in active["data"])
        busy = report["batchFixture"]
        thread = (await get("/threads/" + busy))["thread"]
        if thread["status"]["type"] == "active":
            await op("interrupt", {"threadId": busy, "turnId": report["batchTurn"]})
            await asyncio.sleep(1)
        for command in (await get("/threads/" + busy + "/terminals"))["data"]:
            await op("terminate", {"threadId": busy, "processId": command["processId"]})
        # Read-only verification on an existing child: never mutate user sessions.
        cursor = None
        child = None
        for _ in range(10):
            rows = await get("/threads" + ("?cursor=" + cursor if cursor else ""))
            child = next((t for t in rows["data"] if t.get("parentThreadId")), None)
            if child or not rows.get("nextCursor"):
                break
            cursor = rows["nextCursor"]
        if child:
            related = await get("/threads/" + child["parentThreadId"] + "/children")
            report["existing_hierarchy"] = {
                "parent": child["parentThreadId"],
                "child": child["id"],
                "foundInDescendants": any(
                    t["id"] == child["id"] for t in related["data"]
                ),
            }
        original = json.loads(Path(".samaya/acceptance/thread.json").read_text())[
            "threadId"
        ]
        last = (await get("/threads/" + original))["thread"]["turns"][-1]
        report["python_restart_final"] = {
            "sameTurn": last["id"] == report["interrupt_isolated"]["otherTurn"],
            "status": last["status"],
            "text": "\n".join(i.get("text", "") for i in last["items"]),
        }
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print("REPORT SAVED", flush=True)


asyncio.run(main())
