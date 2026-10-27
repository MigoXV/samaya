"""Small, generation-keyed cache for read-only capability catalogs."""

import asyncio
import time
from collections.abc import Awaitable, Callable


class ReadCache:
    def __init__(self, ttl: float = 30, limit: int = 64):
        self.ttl, self.limit = ttl, limit
        self.values: dict = {}
        self.pending: dict = {}
        self.revision = 0

    def invalidate(self):
        self.revision += 1
        self.values.clear()

    async def get(self, key, loader: Callable[[], Awaitable], refresh=False):
        revision = self.revision
        cached = self.values.get(key)
        if not refresh and cached and time.monotonic() - cached[0] < self.ttl:
            return cached[1]
        flight = (revision, key)
        if flight not in self.pending:

            async def load():
                try:
                    value = await loader()
                    if revision == self.revision:
                        if len(self.values) >= self.limit:
                            self.values.pop(next(iter(self.values)))
                        self.values[key] = (time.monotonic(), value)
                    return value
                finally:
                    self.pending.pop(flight, None)

            task = asyncio.create_task(load())
            # A disconnected reader must not cancel another reader's shared load.
            task.add_done_callback(
                lambda t: t.exception() if not t.cancelled() else None
            )
            self.pending[flight] = task
        return await asyncio.shield(self.pending[flight])
