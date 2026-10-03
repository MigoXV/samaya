"""JSONL transport for the pinned SDK; execution stays in the existing daemon.

All daemon notifications are wrapped to retain newer protocol fields. Server
requests are never passed to the SDK's default (auto-accept) approval handler.
"""

from __future__ import annotations

import asyncio
import json
import sys

from websockets.asyncio.client import unix_connect


async def run(socket: str) -> None:
    reader = asyncio.StreamReader(limit=32 * 1024 * 1024)
    await asyncio.get_running_loop().connect_read_pipe(
        lambda: asyncio.StreamReaderProtocol(reader), sys.stdin.buffer
    )
    pending: set[str] = set()

    def emit(message: dict) -> None:
        sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    async with unix_connect(socket, max_size=32 * 1024 * 1024) as ws:

        async def upstream() -> None:
            while line := await reader.readline():
                message = json.loads(line)
                if message.get("method") == "samaya/serverRequest/respond":
                    params = message["params"]
                    key = json.dumps(params["id"])
                    if key not in pending:
                        emit(
                            {
                                "id": message["id"],
                                "error": {
                                    "code": -32602,
                                    "message": "请求已处理或连接已变化",
                                },
                            }
                        )
                        continue
                    await ws.send(
                        json.dumps({"id": params["id"], "result": params["result"]})
                    )
                    pending.discard(key)
                    emit({"id": message["id"], "result": {"sent": True}})
                else:
                    await ws.send(line.decode())

        async def downstream() -> None:
            async for raw in ws:
                message = json.loads(raw)
                if message.get("method") == "serverRequest/resolved":
                    pending.discard(
                        json.dumps(message.get("params", {}).get("requestId"))
                    )
                if "method" in message:
                    if "id" in message:
                        pending.add(json.dumps(message["id"]))
                    emit({"method": "samaya/event", "params": message})
                else:
                    emit(message)

        tasks = [asyncio.create_task(upstream()), asyncio.create_task(downstream())]
        done, waiting = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in waiting:
            task.cancel()
        await asyncio.gather(*waiting, return_exceptions=True)
        for task in done:
            task.result()


if __name__ == "__main__":
    asyncio.run(run(sys.argv[1]))
