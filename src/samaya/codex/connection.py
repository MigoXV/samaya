"""Main daemon connection and isolated app discovery; no product state or persistence."""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from importlib.metadata import version

from openai_codex.errors import TransportClosedError

from samaya.config import Settings

from .adapter import Adapter

logger = logging.getLogger(__name__)
RPC_TIMEOUT = 60
APP_LIST_TIMEOUT = 15
USAGE_HISTORY_TIMEOUT = 15
RECONNECT_DELAY = 3


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
        self.catalog_lock = asyncio.Lock()
        self.usage_lock = asyncio.Lock()
        self.isolated_tasks: set[asyncio.Task] = set()

    async def start(self) -> None:
        self.runner = asyncio.create_task(self._connect())

    async def close(self) -> None:
        self.stopping = True
        for task in list(self.isolated_tasks):
            task.cancel()
        await asyncio.gather(*self.isolated_tasks, return_exceptions=True)
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
            "sdkVersion": version("openai-codex"),
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
                await asyncio.sleep(RECONNECT_DELAY)

    def connected(self) -> Adapter:
        if self.state != "connected" or self.adapter is None:
            raise ConnectionError("Codex 连接已断开；请等待恢复")
        return self.adapter

    async def rpc(self, method: str, params: dict | None = None) -> dict:
        adapter = self.connected()
        if method == "app/list":
            # App discovery can stall while the daemon contacts external services.
            # Keep its blocking SDK waiter off the transport that owns live work.
            return await self._isolated_read(
                method, params, self.catalog_lock, APP_LIST_TIMEOUT, "应用目录查询"
            )
        if method == "account/usage/read":
            return await self._isolated_read(
                method, params, self.usage_lock, USAGE_HISTORY_TIMEOUT, "历史用量读取"
            )
        try:
            return await asyncio.wait_for(adapter.request(method, params), RPC_TIMEOUT)
        except asyncio.TimeoutError as exc:
            logger.warning(
                "Codex RPC timed out method=%s thread=%s generation=%s",
                method,
                (params or {}).get("threadId", "-"),
                self.generation,
            )
            if (
                self.adapter is adapter
                and self.state == "connected"
                and not self.stopping
            ):
                # Cancelling asyncio.to_thread doesn't stop the SDK's blocking
                # response waiter. Closing this transport wakes those waiters
                # and lets the existing connection loop restore subscriptions.
                self.state, self.error = "disconnected", "Codex 请求超时，正在重新连接"
                self.ready.clear()
                self.on_disconnected()
                await asyncio.shield(adapter.close())
            raise ConnectionError(
                "Codex 请求超时，正在重新连接；本次操作结果待确认，不会自动重发。"
            ) from exc
        except TransportClosedError as exc:
            raise ConnectionError("Codex 连接已断开；请等待恢复") from exc

    async def _isolated_read(
        self,
        method: str,
        params: dict | None,
        lock: asyncio.Lock,
        timeout: int,
        label: str,
    ) -> dict:
        async def read():
            async with lock:
                adapter = Adapter(self.config.socket)
                try:
                    await adapter.start()
                    return await adapter.request(method, params)
                finally:
                    # Closing releases the SDK waiter even when the request times out.
                    await adapter.close()

        task = asyncio.create_task(read())
        self.isolated_tasks.add(task)
        try:
            return await asyncio.wait_for(task, timeout)
        except asyncio.TimeoutError as exc:
            logger.warning("Codex %s timed out; main connection preserved", method)
            raise ConnectionError(f"{label}超时，请稍后重试") from exc
        except TransportClosedError as exc:
            raise ConnectionError(f"{label}连接已断开，请稍后重试") from exc
        finally:
            self.isolated_tasks.discard(task)
