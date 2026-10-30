"""Scoped browser SSE replay and live monitor patches."""

import asyncio
import json
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

GLOBAL_METHODS = {
    "thread/settings/updated",
    "samaya/connection",
    "samaya/requestChanged",
    "samaya/operation",
    "serverRequest/resolved",
    "turn/completed",
    "turn/started",
}


def scoped_event(event: dict, scope: str, thread_id: str | None, turn_id: str | None):
    method, params = event.get("method"), event.get("params", {})
    if scope == "global":
        if method not in GLOBAL_METHODS:
            return None
        if method == "thread/settings/updated":
            return {
                "method": method,
                "params": {
                    "threadId": params.get("threadId"),
                    "mode": (
                        params.get("threadSettings", {}).get("collaborationMode") or {}
                    ).get("mode"),
                },
            }
        if method in ("turn/completed", "turn/started"):
            # Completion listeners need identity/status, never full turn history.
            turn = params.get("turn", {})
            return {
                "method": method,
                "params": {
                    "threadId": params.get("threadId"),
                    "turn": {k: turn[k] for k in ("id", "status") if k in turn},
                },
            }
    elif scope == "thread":
        if params.get("threadId") != thread_id:
            return None
        if (
            turn_id
            and (params.get("turnId") or params.get("turn", {}).get("id")) != turn_id
        ):
            return None
    return event


def register_events(application: FastAPI) -> None:
    def service():
        return application.state.runtime

    @application.get("/api/events")
    async def events(
        request: Request,
        after: int | None = None,
        scope: Literal["all", "global", "thread"] = "all",
        threadId: str | None = None,
        turnId: str | None = None,
    ):
        if scope == "thread" and not threadId:
            raise HTTPException(400, "对话订阅需要 threadId")
        store = application.state.store
        head = store.cursor()
        try:
            explicit = after is not None or bool(request.headers.get("last-event-id"))
            cursor = (
                max(after or 0, int(request.headers.get("last-event-id", "0")))
                if explicit
                else head
            )
            if cursor < 0 or cursor > head:
                raise ValueError
        except ValueError:
            raise HTTPException(400, "无效事件游标")

        async def stream():
            nonlocal cursor
            monitor_cursor = service().monitor.revision
            # Capture before the browser fetches a snapshot: events racing that
            # fetch remain replayable. First connections never replay old work.
            yield f"event: snapshot\ndata: {json.dumps({'cursor': head})}\n\n"
            while not await request.is_disconnected():
                wake = service().changed.event
                monitor = service().monitor
                if store.event_floor() > cursor + 1:
                    cursor = store.cursor()
                    yield f"event: snapshot\ndata: {json.dumps({'cursor': cursor, 'reason': 'cursor-expired'})}\n\n"
                if scope != "thread":
                    if (
                        monitor.patches
                        and monitor_cursor < monitor.patches[0]["revision"] - 1
                    ):
                        yield f"event: snapshot\ndata: {json.dumps({'cursor': store.cursor()})}\n\n"
                        monitor_cursor = monitor.revision
                    for patch in list(monitor.patches):
                        if patch["revision"] > monitor_cursor:
                            monitor_cursor = patch["revision"]
                            yield f"event: monitor\ndata: {json.dumps(patch, ensure_ascii=False)}\n\n"
                rows = store.events(cursor)
                for row in rows:
                    cursor = row["id"]
                    event = scoped_event(row["data"], scope, threadId, turnId)
                    if event is not None:
                        yield f"id: {cursor}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                if rows:
                    # Advance Last-Event-ID even when all records were filtered.
                    yield f"id: {cursor}\nevent: cursor\ndata: {{}}\n\n"
                    continue
                try:
                    await asyncio.wait_for(wake.wait(), 15)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"X-Accel-Buffering": "no"},
        )
