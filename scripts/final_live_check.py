import asyncio
import json
import uuid
from pathlib import Path

import httpx


async def main():
    report_path = Path(".samaya/acceptance/api-report.json")
    report = json.loads(report_path.read_text())
    tid = report["batchFixture"]
    async with httpx.AsyncClient(
        base_url="http://127.0.0.1:8765", timeout=80
    ) as client:
        client.headers["X-Samaya-CSRF"] = (await client.get("/api/auth")).json()["csrf"]

        async def get(p):
            r = await client.get("/api" + p)
            r.raise_for_status()
            return r.json()

        async def op(action, body):
            r = (
                await client.post(
                    "/api/operations",
                    json={
                        "operationId": uuid.uuid4().hex,
                        "action": action,
                        "body": body,
                    },
                )
            ).json()
            print(action, json.dumps(r, ensure_ascii=False), flush=True)
            assert r["state"] == "succeeded", r
            return r

        preview = await get("/threads/" + tid + "/cleanup-preview")
        await op("archive", {"threadId": tid, "digest": preview["digest"]})
        archived_read = await get("/threads/" + tid + "?subscribe=true")
        assert archived_read["thread"]["id"] == tid and archived_read.get(
            "subscriptionNotice"
        )
        report["archived_history_fixed"] = True
        await op("unarchive", {"threadId": tid})
        thread = (await get("/threads/" + tid + "?subscribe=true"))["thread"]
        # SDK turn_start (not raw RPC) after the final adapter refinement.
        sent = await op(
            "send",
            {
                "threadId": tid,
                "expectedTurnId": thread["turns"][-1]["id"],
                "text": "Reply with exactly SAMAYA_SDK_FINAL_OK, while following project instructions. Do not run tools.",
            },
        )
        for _ in range(60):
            await asyncio.sleep(1)
            last = (await get("/threads/" + tid))["thread"]["turns"][-1]
            if last["status"] != "inProgress":
                break
        report["sdk_typed_turn"] = {
            "sameTurn": last["id"] == sent["result"]["turn"]["id"],
            "status": last["status"],
            "text": "\n".join(i.get("text", "") for i in last["items"]),
        }
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(report["sdk_typed_turn"], flush=True)


asyncio.run(main())
