"""Run against a local Samaya; mutate only acceptance fixtures."""

from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path

import httpx

from samaya.codex.adapter import Adapter
from samaya.config import settings

BASE = Path(".samaya/acceptance")
REPORT = BASE / "api-report.json"
report = {}


async def main():
    async with httpx.AsyncClient(
        base_url="http://127.0.0.1:8765", timeout=80
    ) as client:
        csrf = (await client.get("/api/auth")).json()["csrf"]
        client.headers["X-Samaya-CSRF"] = csrf

        async def get(path):
            r = await client.get("/api" + path)
            r.raise_for_status()
            return r.json()

        async def op(action, body, key=None):
            r = await client.post(
                "/api/operations",
                json={
                    "operationId": key or uuid.uuid4().hex,
                    "action": action,
                    "body": body,
                },
            )
            r.raise_for_status()
            data = r.json()
            print(action, json.dumps(data, ensure_ascii=False), flush=True)
            return data

        async def wait(tid, seconds=180):
            for _ in range(seconds):
                d = await get("/threads/" + tid)
                if d["pendingRequests"]:
                    return d
                turns = d["thread"]["turns"]
                if turns and turns[-1]["status"] != "inProgress":
                    return d
                await asyncio.sleep(1)
            raise TimeoutError(tid)

        async def send(tid, text, key=None):
            t = (await get("/threads/" + tid))["thread"]
            return await op(
                "send",
                {
                    "threadId": tid,
                    "text": text,
                    "expectedTurnId": t["turns"][-1]["id"] if t["turns"] else None,
                },
                key,
            )

        async def setup(tid, params):
            a = Adapter(settings().socket)
            await a.start()
            try:
                await a.request("thread/settings/update", {"threadId": tid, **params})
            finally:
                await a.close()

        d = json.loads((BASE / "thread.json").read_text())
        tid = d["threadId"]
        # Verify automatic project instruction loading without asking the model to read AGENTS.
        await op("workspace", {"threadId": tid, "cwd": d["a"], "expectedCwd": d["b"]})
        key = uuid.uuid4().hex
        t = (await get("/threads/" + tid))["thread"]
        body = {
            "threadId": tid,
            "text": "Run only pwd. Then say Ready, following your already-loaded project instructions. Do not read any files.",
            "expectedTurnId": t["turns"][-1]["id"],
        }
        first = await op("send", body, key)
        second = await op("send", body, key)
        assert first == second
        finished = await wait(tid)
        items = finished["thread"]["turns"][-1]["items"]
        text = "\n".join(i.get("text", "") for i in items)
        report["workspace_auto_instructions"] = {
            "passed": "SAMAYA_ALPHA" in text,
            "text": text,
            "cwd": finished["thread"]["cwd"],
        }
        report["duplicate_send"] = {
            "passed": first == second,
            "turnId": first["result"]["turn"]["id"],
        }
        # A separate fixture is safe to interrupt and archive/delete.
        created = await op(
            "create", {"cwd": d["a"], "name": "Samaya 验收 · 后台命令与审批"}
        )
        other = created["result"]["threadId"]
        report["fixture"] = other
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        await send(
            other,
            "Start two distinct background commands using exec_command with yield_time_ms=1000: sleep 240 and sleep 241. Keep both running, do not wait or poll them, and immediately return both process session IDs. Do not use shell ampersands.",
        )
        await wait(other)
        terms = (await get("/threads/" + other + "/terminals"))["data"]
        report["background_before"] = terms
        if len(terms) >= 2:
            killed = await op(
                "terminate", {"threadId": other, "processId": terms[0]["processId"]}
            )
            remaining = (await get("/threads/" + other + "/terminals"))["data"]
            report["targeted_terminate"] = {
                "passed": killed["result"].get("terminated")
                and any(p["processId"] == terms[1]["processId"] for p in remaining),
                "remaining": remaining,
            }
            # workspace operation must not kill old cwd processes.
            await op(
                "workspace", {"threadId": other, "cwd": d["b"], "expectedCwd": d["a"]}
            )
            report["old_process_cwd"] = (await get("/threads/" + other + "/terminals"))[
                "data"
            ]
            for p in remaining:
                await op("terminate", {"threadId": other, "processId": p["processId"]})
        # Force a supported user approval on the disposable thread only.
        await setup(
            other,
            {
                "approvalPolicy": "untrusted",
                "approvalsReviewer": "user",
                "sandboxPolicy": {"type": "readOnly"},
            },
        )
        await send(
            other,
            "Run python3 -c \"print('SAMAYA_APPROVAL')\" using the command tool. Do not use any other command.",
        )
        awaiting = await wait(other)
        report["approval_pending"] = awaiting["pendingRequests"]
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print("AWAITING_BROWSER_APPROVAL", other, flush=True)


asyncio.run(main())
