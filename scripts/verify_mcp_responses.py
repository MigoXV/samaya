"""Real standalone MCP requests: no turn, decline/cancel, and lost browser reply."""

import asyncio
import json
import sys
import uuid
from pathlib import Path

from samaya.config import Settings
from samaya.runtime import Runtime
from samaya.store import Store

BASE = Path(__file__).resolve().parents[1] / ".samaya/acceptance/mcp-responses"


async def main():
    BASE.mkdir(parents=True, exist_ok=True)
    (BASE / "calls.jsonl").unlink(missing_ok=True)
    store = Store(BASE / "state")
    service = Runtime(Settings(data_dir=BASE / "state"), store)
    report = {"cases": []}
    await service.start()
    try:
        await asyncio.wait_for(service.connection.ready.wait(), 20)
        r = await service.connection.rpc(
            "thread/start",
            {
                "cwd": str(BASE),
                "approvalPolicy": "on-request",
                "sandbox": "workspace-write",
                "config": {
                    "mcp_servers.samaya_acceptance": {
                        "command": sys.executable,
                        "args": [
                            str(Path(__file__).with_name("fixtures") / "mcp_server.py"),
                            str(BASE),
                        ],
                        "tool_timeout_sec": 120,
                    }
                },
            },
        )
        tid = r["thread"]["id"]
        report["threadId"] = tid
        await service.connection.rpc(
            "thread/name/set",
            {"threadId": tid, "name": "Samaya MCP 独立请求验收 · 可删除"},
        )
        for action in ["decline", "cancel"]:
            call = asyncio.create_task(
                service.connection.rpc(
                    "mcpServer/tool/call",
                    {
                        "threadId": tid,
                        "server": "samaya_acceptance",
                        "tool": "collect",
                        "arguments": {"mode": "form"},
                    },
                )
            )
            seen = set()
            answered = False
            for _ in range(200):
                if call.done():
                    break
                for key, req in list(service.decisions.pending.items()):
                    if key in seen or req["params"]["threadId"] != tid:
                        continue
                    seen.add(key)
                    assert req["params"].get("turnId") is None, req
                    business = bool(
                        req["params"].get("requestedSchema", {}).get("properties")
                    )
                    decision = action if business else "accept"
                    body = {
                        "threadId": tid,
                        "requestKey": key,
                        "response": {
                            "action": decision,
                            "content": {} if decision == "accept" else None,
                        },
                    }
                    opid = uuid.uuid4().hex
                    result = await service.operations.execute(opid, "respond", body)
                    assert result["state"] == "succeeded", result
                    assert (
                        await service.operations.execute(opid, "respond", body)
                    ) == result
                    if business:
                        answered = True
                await asyncio.sleep(0.1)
            result = await call
            assert answered, result
            serialized = json.dumps(result)
            assert action in serialized, result
            report["cases"].append(
                {
                    "action": action,
                    "noTurn": True,
                    "duplicateReceipt": True,
                    "result": result,
                }
            )
        # Drop only this test client's bridge while a standalone input is pending.
        generation = service.connection.generation
        call = asyncio.create_task(
            service.connection.rpc(
                "mcpServer/tool/call",
                {
                    "threadId": tid,
                    "server": "samaya_acceptance",
                    "tool": "collect",
                    "arguments": {"mode": "form"},
                },
            )
        )
        stale = None
        for _ in range(200):
            for key, req in list(service.decisions.pending.items()):
                if req["params"].get("requestedSchema", {}).get("properties"):
                    stale = key
                    break
                await service.operations.execute(
                    uuid.uuid4().hex,
                    "respond",
                    {
                        "threadId": tid,
                        "requestKey": key,
                        "response": {"action": "accept", "content": {}},
                    },
                )
            if stale:
                break
            await asyncio.sleep(0.1)
        assert stale
        await service.connection.adapter.close()
        await asyncio.gather(call, return_exceptions=True)
        for _ in range(200):
            if (
                service.connection.generation > generation
                and service.connection.state == "connected"
            ):
                break
            await asyncio.sleep(0.1)
        assert service.connection.generation > generation
        result = await service.operations.execute(
            uuid.uuid4().hex,
            "respond",
            {
                "threadId": tid,
                "requestKey": stale,
                "response": {"action": "accept", "content": {}},
            },
        )
        assert result["state"] == "failed", result
        assert len((BASE / "calls.jsonl").read_text().splitlines()) == 3
        report["disconnect"] = {
            "reconnected": True,
            "staleRequestRejected": True,
            "toolCalls": 3,
            "replayed": False,
        }
        (BASE / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2)
        )
        print(json.dumps(report, ensure_ascii=False), flush=True)
    finally:
        await service.close()
        store.close()


if __name__ == "__main__":
    asyncio.run(main())
