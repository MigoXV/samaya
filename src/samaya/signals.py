"""Broadcast wake-ups without sharing browser-owned locks with native readers."""

import asyncio


class ChangeSignal:
    def __init__(self) -> None:
        self.event = asyncio.Event()

    def notify(self) -> None:
        # Capture event before reading snapshots/journal. Each notification
        # releases every existing listener; later listeners watch the next event.
        previous, self.event = self.event, asyncio.Event()
        previous.set()
