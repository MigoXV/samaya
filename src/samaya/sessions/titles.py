"""Best-effort automatic names for newly created Samaya conversations."""

from __future__ import annotations

import asyncio
import logging
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass

from samaya.codex.adapter import Adapter
from samaya.codex.title_generation import fallback_title, generate_title
from samaya.store import Store

logger = logging.getLogger(__name__)
SAVE_TIMEOUT = 5


@dataclass
class TitleJob:
    thread: dict
    text: str
    superseded: bool = False


class SessionTitles:
    def __init__(
        self,
        socket: str,
        store: Store,
        lock: Callable[[str], asyncio.Lock],
        unavailable: Callable[[str], bool],
        refresh: Callable[[str], None],
        hide: Callable[[str], None],
    ) -> None:
        self.socket = socket
        self.store = store
        self.lock = lock
        self.unavailable = unavailable
        self.refresh = refresh
        self.hide = hide
        self.pending: dict[str, TitleJob] = {}
        self.queue: asyncio.Queue[TitleJob] = asyncio.Queue(maxsize=16)
        self.worker: asyncio.Task | None = None
        self.stopping = False

    def start(self) -> None:
        self.worker = asyncio.create_task(self.run())

    async def close(self) -> None:
        self.stopping = True
        if self.worker:
            self.worker.cancel()
            await asyncio.gather(self.worker, return_exceptions=True)

    def register(self, tid: str) -> None:
        try:
            self.store.allow_title(tid)
        except sqlite3.Error as exc:
            logger.warning("Could not register automatic title: %s", type(exc).__name__)

    def enqueue(self, thread: dict, text: str) -> None:
        if self.stopping or not text.strip():
            return
        tid = thread["id"]
        try:
            claimed = self.store.claim_title(tid)
        except sqlite3.Error as exc:
            logger.warning("Could not claim automatic title: %s", type(exc).__name__)
            return
        if not claimed or thread.get("name"):
            return
        if self.queue.full():
            logger.warning("Automatic title queue is full")
            return
        # The generator and fallback both use a bounded excerpt.
        job = TitleJob(
            {key: thread.get(key) for key in ("id", "cwd", "model", "modelProvider")},
            text.lstrip()[:2000],
        )
        self.queue.put_nowait(job)
        self.pending[tid] = job

    def supersede(self, tid: str) -> None:
        if job := self.pending.get(tid):
            job.superseded = True

    def skip(self, job: TitleJob) -> bool:
        return job.superseded or self.unavailable(job.thread["id"])

    async def run(self) -> None:
        while True:
            job = await self.queue.get()
            tid = job.thread["id"]
            try:
                if not self.skip(job):
                    await self.apply(job)
            except Exception as exc:  # noqa: BLE001 - cannot fail or replay the accepted send
                logger.warning("Automatic title not saved: %s", type(exc).__name__)
            finally:
                self.pending.pop(tid, None)
                self.queue.task_done()

    async def apply(self, job: TitleJob) -> None:
        tid = job.thread["id"]
        try:
            title = await generate_title(self.socket, job.thread, job.text, self.hide)
        except Exception as exc:  # noqa: BLE001 - Codex or schema failure uses the CLI-style fallback
            logger.info("Automatic title generation fell back: %s", type(exc).__name__)
            title = fallback_title(job.text)
        if not title or self.skip(job):
            return
        adapter = Adapter(self.socket)
        try:
            await asyncio.wait_for(adapter.start(), SAVE_TIMEOUT)
            saved = await asyncio.wait_for(
                self.save_when_idle(adapter, job, title), SAVE_TIMEOUT
            )
            if saved:
                self.refresh(tid)
        finally:
            await adapter.close()

    async def save_when_idle(self, adapter: Adapter, job: TitleJob, title: str) -> bool:
        async with self.lock(job.thread["id"]):
            return await self.save(adapter, job, title)

    async def save(self, adapter: Adapter, job: TitleJob, title: str) -> bool:
        tid = job.thread["id"]
        if self.skip(job):
            return False
        thread = (
            await adapter.request(
                "thread/read", {"threadId": tid, "includeTurns": False}
            )
        )["thread"]
        if thread.get("name") or thread.get("archived") or self.skip(job):
            return False
        await adapter.request("thread/name/set", {"threadId": tid, "name": title})
        return True
