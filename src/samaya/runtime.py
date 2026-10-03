"""Composition and lifecycle only; business operations belong to their services."""

import asyncio

from samaya.codex.connection import Connection
from samaya.config import Settings
from samaya.decisions import mcp
from samaya.decisions.service import Decisions
from samaya.monitoring.service import Monitor
from samaya.operations import Operations
from samaya.sessions.actions import SessionActions
from samaya.sessions.queries import SessionQueries
from samaya.store import Store


class Runtime:
    def __init__(self, config: Settings, store: Store):
        self.store = store
        self.changed = asyncio.Condition()
        self.connection = Connection(
            config, self.receive, self.restore, self.disconnected
        )
        self.decisions = Decisions(self.connection, self.publish)
        self.sessions = SessionQueries(self.connection, store, self.decisions)
        self.actions = SessionActions(config, self.connection, store, self.sessions)
        self.operations = Operations(store, self.dispatch, self.publish)
        self.monitor = Monitor(
            self.connection, self.sessions, self.decisions, store, self.changed
        )

    async def start(self) -> None:
        await self.connection.start()
        self.monitor.start()

    async def close(self) -> None:
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

    async def receive(self, event: dict) -> None:
        self.decisions.observe(event)
        if event.get("method") == "samaya/connection":
            event = {**event, "params": self.status()}
        await self.publish(event)

    async def dispatch(self, action: str, body: dict) -> dict:
        if action == "respond":
            return await self.decisions.respond(body)
        return await self.actions.execute(action, body)

    async def publish(self, event: dict) -> None:
        self.monitor.event(event)
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
        self.store.event(event)
        async with self.changed:
            self.changed.notify_all()
