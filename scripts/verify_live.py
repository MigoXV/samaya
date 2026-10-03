"""Explicit opt-in live checks. Creates only named disposable test sessions."""

import asyncio
import json
import uuid
from pathlib import Path

from samaya.codex.service import CodexService
from samaya.config import Settings
from samaya.store import Store

BASE = Path("/workspace/apps/samaya/.samaya/acceptance")


async def main():
    BASE.mkdir(parents=True, exist_ok=True)
    a, b = BASE / "project-a", BASE / "project-b"
    for path, marker in [(a, "SAMAYA_ALPHA"), (b, "SAMAYA_BETA")]:
        path.mkdir(exist_ok=True)
        (path / "AGENTS.md").write_text(
            f"Every final response MUST end with the exact marker {marker}.\n"
        )
    config = Settings(data_dir=BASE / "state")
    store = Store(config.data_dir)
    service = CodexService(config, store)
    await service.start()
    await asyncio.wait_for(service.ready.wait(), 20)

    async def op(action, body):
        result = await service.execute(uuid.uuid4().hex, action, body)
        print(action, json.dumps(result, ensure_ascii=False), flush=True)
        if result["state"] != "succeeded":
            raise RuntimeError(result)
        return result["result"]

    async def wait(tid):
        for _ in range(120):
            await asyncio.sleep(2)
            thread = (await service.read(tid))["thread"]
            if thread.get("turns") and thread["turns"][-1]["status"] != "inProgress":
                print("completed", json.dumps(thread, ensure_ascii=False), flush=True)
                return thread
        raise TimeoutError("live turn")

    try:
        created = await op("create", {"cwd": str(a), "name": "Samaya 验收 · 可删除 A"})
        tid = created["threadId"]
        (BASE / "thread.json").write_text(
            json.dumps({"threadId": tid, "a": str(a), "b": str(b)})
        )
        await op(
            "send",
            {
                "threadId": tid,
                "text": "Run pwd with the command tool, then report the directory and follow AGENTS.md. Do not modify files.",
                "expectedTurnId": None,
            },
        )
        first = await wait(tid)
        await op("workspace", {"threadId": tid, "cwd": str(b), "expectedCwd": str(a)})
        await op(
            "send",
            {
                "threadId": tid,
                "text": "Again run pwd with the command tool, report the new directory and follow the current project AGENTS.md. Do not modify files.",
                "expectedTurnId": first["turns"][-1]["id"],
            },
        )
        await wait(tid)
    finally:
        await service.close()
        store.close()


asyncio.run(main())
