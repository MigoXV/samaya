import asyncio

from samaya.codex.adapter import Adapter
from samaya.config import settings


async def main():
    adapter = Adapter(settings().socket)
    try:
        await adapter.start()
        print(adapter.sdk.metadata.model_dump())
        print(await adapter.request("thread/loaded/list", {"limit": 100}))
        result = await adapter.sdk.thread_list(limit=1, use_state_db_only=True)
        print("SDK list:", len(result.data))
    finally:
        await adapter.close()


asyncio.run(main())
