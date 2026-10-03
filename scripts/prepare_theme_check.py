"""显式运行才创建主题验收会话并调用一次真实 Codex；不清理用户记录。"""

import asyncio
import json
import os
import uuid
from pathlib import Path

import httpx


async def main():
    directory = Path(".samaya/acceptance/themes").resolve()
    directory.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(
        base_url=os.getenv("SAMAYA_TEST_URL", "http://127.0.0.1:8765"), timeout=80
    ) as client:
        client.headers["X-Samaya-CSRF"] = (await client.get("/api/auth")).json()[
            "csrf"
        ]

        async def operation(action, body):
            response = await client.post(
                "/api/operations",
                json={
                    "operationId": uuid.uuid4().hex,
                    "action": action,
                    "body": body,
                },
            )
            response.raise_for_status()
            receipt = response.json()
            if receipt["state"] != "succeeded":
                raise RuntimeError(receipt)
            return receipt["result"]

        thread = await operation(
            "create", {"cwd": str(directory), "name": "Samaya 双主题验收 · 可删除"}
        )
        tid = thread["threadId"]
        Path(".samaya/acceptance/theme-thread.json").write_text(json.dumps(thread))
        print(f"主题验收会话：{tid}", flush=True)
        await operation(
            "send",
            {
                "threadId": tid,
                "expectedTurnId": None,
                "text": "Run pwd once and reply SAMAYA_THEME_READY. This is a browser theme acceptance test; do not modify files.",
            },
        )
        for _ in range(120):
            await asyncio.sleep(1)
            response = await client.get(f"/api/threads/{tid}")
            response.raise_for_status()
            turns = response.json()["thread"]["turns"]
            if turns and turns[-1]["status"] != "inProgress":
                if turns[-1]["status"] != "completed":
                    raise RuntimeError(turns[-1])
                print("真实轮次已完成，可运行 tests/themes.mjs", flush=True)
                return
        raise TimeoutError("轮次尚未完成；查询已有会话，不要自动重新发送任务。")


if __name__ == "__main__":
    asyncio.run(main())
