"""One SDK connection to the independent daemon; no product state or persistence."""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable

from samaya.config import Settings

from .adapter import Adapter

logger = logging.getLogger(__name__)


class Connection:
    def __init__(
        self,
        config: Settings,
        on_event: Callable[[dict], Awaitable[None]],
        on_connected: Callable[[], Awaitable[None]],
        on_disconnected: Callable[[], None],
    ):
        self.config = config
        self.on_event, self.on_connected, self.on_disconnected = (
            on_event,
            on_connected,
            on_disconnected,
        )
        self.adapter: Adapter | None = None
        self.state = "connecting"
        self.error: str | None = None
        self.metadata: dict = {}
        self.ready = asyncio.Event()
        self.generation = 0
        self.connection_id = ""
        self.runner: asyncio.Task | None = None
        self.stopping = False

    async def start(self) -> None:
        self.runner = asyncio.create_task(self._connect())

    async def close(self) -> None:
        self.stopping = True
        if self.runner:
            self.runner.cancel()
        if self.adapter:
            await self.adapter.close()
        if self.runner:
            await asyncio.gather(self.runner, return_exceptions=True)

    def status(self) -> dict:
        return {
            "connection": self.state,
            "error": self.error,
            "generation": self.generation,
            "sdkVersion": "0.160.0",
            "runtime": self.metadata,
            "socket": self.config.socket,
            "roots": [str(p) for p in self.config.roots],
        }

    async def _connect(self) -> None:
        while not self.stopping:
            adapter = Adapter(self.config.socket)
            self.adapter = adapter
            self.state = "connecting" if not self.generation else "reconnecting"
            await self.on_event(
                {"method": "samaya/connection", "params": self.status()}
            )
            try:
                await asyncio.wait_for(adapter.start(), 15)
                self.generation += 1
                self.connection_id = uuid.uuid4().hex
                self.metadata = adapter.sdk.metadata.model_dump(by_alias=True)
                self.state, self.error = "connected", None
                self.ready.set()
                await self.on_connected()
                await self.on_event(
                    {
                        "method": "samaya/connection",
                        "params": self.status(),
                        "snapshotRequired": True,
                    }
                )
                while not self.stopping:
                    await self.on_event(await adapter.event())
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - reconnect transport without replaying work
                logger.warning("Codex connection interrupted: %s", type(exc).__name__)
                self.state, self.error = (
                    "disconnected",
                    "无法连接 Codex；正在重连，执行状态未知",
                )
                self.ready.clear()
                self.on_disconnected()
                await self.on_event(
                    {
                        "method": "samaya/connection",
                        "params": self.status(),
                        "snapshotRequired": True,
                    }
                )
            finally:
                await adapter.close()
            if not self.stopping:
                await asyncio.sleep(3)

    def connected(self) -> Adapter:
        if self.state != "connected" or self.adapter is None:
            raise ConnectionError("Codex 连接已断开；请等待恢复")
        return self.adapter

    async def rpc(self, method: str, params: dict | None = None) -> dict:
        return await asyncio.wait_for(self.connected().request(method, params), 60)
