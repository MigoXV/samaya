"""Browser SSE replay and live monitor patches."""

import asyncio
import json

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse


def register_events(application: FastAPI) -> None:
    def service():
        return application.state.runtime

    @application.get("/api/events")
    async def events(request: Request, after: int = 0):
        try:
            cursor = max(after, int(request.headers.get("last-event-id", "0")))
        except ValueError:
            raise HTTPException(400, "无效事件游标")

        async def stream():
            nonlocal cursor
            monitor_cursor = service().monitor.revision
            # Every reconnect requests authoritative snapshots; replay alone is insufficient.
            yield "event: snapshot\ndata: {}\n\n"
            while not await request.is_disconnected():
                monitor = service().monitor
                if (
                    monitor.patches
                    and monitor_cursor < monitor.patches[0]["revision"] - 1
                ):
                    yield "event: snapshot\ndata: {}\n\n"
                    monitor_cursor = monitor.revision
                for patch in list(monitor.patches):
                    if patch["revision"] > monitor_cursor:
                        monitor_cursor = patch["revision"]
                        yield f"event: monitor\ndata: {json.dumps(patch, ensure_ascii=False)}\n\n"
                rows = application.state.store.events(cursor)
                for row in rows:
                    cursor = row["id"]
                    yield f"id: {cursor}\ndata: {json.dumps(row['data'], ensure_ascii=False)}\n\n"
                if rows:
                    continue
                try:
                    async with service().changed:
                        await asyncio.wait_for(service().changed.wait(), 15)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"X-Accel-Buffering": "no"},
        )
