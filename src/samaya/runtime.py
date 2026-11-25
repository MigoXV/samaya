"""Composition and lifecycle only; business operations belong to their services."""

import asyncio

from samaya.codex.connection import Connection
from samaya.codex.title_generation import is_title_thread
from samaya.composer.catalog import InputCatalog
from samaya.composer.commands import CommandService
from samaya.config import Settings
from samaya.decisions import mcp
from samaya.decisions.service import Decisions
from samaya.monitoring.activity import activity_thread
from samaya.monitoring.service import Monitor
from samaya.operations import Operations
from samaya.sessions.actions import SessionActions
from samaya.sessions.queries import SessionQueries
from samaya.sessions.titles import SessionTitles
from samaya.signals import ChangeSignal
from samaya.store import Store


class Runtime:
    def __init__(self, config: Settings, store: Store):
        self.maintenance: asyncio.Task | None = None
        self.store = store
        self.changed = ChangeSignal()
        self.connection = Connection(
            config, self.receive, self.restore, self.disconnected
        )
        self.decisions = Decisions(self.connection, self.publish)
        self.sessions = SessionQueries(self.connection, store, self.decisions)
        self.catalog = InputCatalog(config, self.connection, self.sessions)
        self.operations = Operations(store, self.dispatch, self.publish)
        self.monitor = Monitor(
            self.connection, self.sessions, self.decisions, store, self.changed
        )
        self.hidden_title_threads: dict[str, None] = {}
        self.titles = SessionTitles(
            config.socket,
            store,
            lambda tid: self.operations.locks[tid],
            self.monitor.is_thread_removed,
            self.monitor.request_name_refresh,
            self.hide_title_thread,
        )
        self.actions = SessionActions(
            config, self.connection, store, self.sessions, self.titles
        )
        self.actions.catalog = self.catalog
        self.commands = CommandService(self.catalog, self.actions)

    async def start(self) -> None:
        await self.connection.start()
        self.monitor.start()
        self.titles.start()
        self.maintenance = asyncio.create_task(self.compact_replay())

    async def compact_replay(self) -> None:
        while await asyncio.to_thread(self.store.compact_catalog_events):
            await asyncio.sleep(0.1)

    async def close(self) -> None:
        if self.maintenance:
            self.maintenance.cancel()
            await asyncio.gather(self.maintenance, return_exceptions=True)
        await self.titles.close()
        await self.monitor.close()
        await self.connection.close()
        await self.operations.close()

    def status(self) -> dict:
        return {**self.connection.status(), "cursor": self.store.cursor()}

    async def restore(self) -> None:
        await self.sessions.restore()

    def disconnected(self) -> None:
        # Capture unknown pending counts before discarding connection-scoped prompts.
        self.monitor.event({"method": "samaya/connection", "params": self.status()})
        self.decisions.disconnect()

    def hide_title_thread(self, tid: str) -> None:
        self.hidden_title_threads[tid] = None
        if len(self.hidden_title_threads) > 256:
            del self.hidden_title_threads[next(iter(self.hidden_title_threads))]

    async def receive(self, event: dict) -> None:
        method, params = event.get("method"), event.get("params", {})
        thread = params.get("thread") or {}
        tid = params.get("threadId") or thread.get("id")
        if tid and is_title_thread(thread):
            self.hide_title_thread(tid)
        if tid in self.hidden_title_threads:
            return
        if tid and (
            method in ("thread/archived", "thread/deleted")
            or (method == "thread/name/updated" and params.get("threadName"))
        ):
            self.titles.supersede(tid)
        self.sessions.observe_settings(event)
        if event.get("method") == "skills/changed":
            self.catalog.invalidate("skills")
        elif event.get("method") == "app/list/updated":
            self.catalog.observe_apps(event.get("params", {}))
        self.decisions.observe(event)
        if event.get("method") == "samaya/connection":
            event = {**event, "params": self.status()}
        await self.publish(event)

    async def dispatch(self, action: str, body: dict) -> dict:
        if action == "command":
            return await self.commands.execute(body)
        if action == "respond":
            return await self.decisions.respond(body)
        return await self.actions.execute(action, body)

    async def publish(self, event: dict) -> None:
        self.monitor.event(event)
        active_thread = activity_thread(event)
        if event.get("method") == "turn/diff/updated":
            # Large disposable diff observations are read on demand, not retained
            # in the durable journal or broadcast to every global monitor.
            event = {
                "method": "samaya/turnSummaryChanged",
                "params": {k: event["params"][k] for k in ("threadId", "turnId")},
            }
        if event.get("method") == mcp.METHOD:
            # Live prompts can contain authorization URLs and private defaults.
            # Browsers obtain them from the in-memory snapshot, never the journal.
            event = {
                "method": "samaya/requestChanged",
                "params": {"threadId": event.get("params", {}).get("threadId")},
            }
        seq = self.store.event(event, activity_thread=active_thread)
        if active_thread:
            self.monitor.activity(active_thread, seq)
        self.changed.notify()
