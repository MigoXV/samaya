"""HTTP endpoints; native Codex protocol stays behind services."""

import json

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from samaya.config import Settings
from samaya.runtime import Runtime


class Operation(BaseModel):
    operationId: str = Field(min_length=16, max_length=128, pattern=r"^[a-zA-Z0-9_-]+$")
    action: str = Field(max_length=30)
    body: dict


def register_routes(application: FastAPI, config: Settings) -> None:
    def service() -> Runtime:
        return application.state.runtime

    @application.get("/api/status")
    async def status():
        return service().status()

    @application.get("/api/directories")
    async def directories(path: str | None = None):
        if path is None:
            return {
                "path": None,
                "parent": None,
                "data": [{"name": str(p), "path": str(p)} for p in config.roots],
            }
        directory = config.directory(path)
        try:
            entries = []
            for item in sorted(directory.iterdir(), key=lambda p: p.name.lower()):
                if item.name.startswith("."):
                    continue
                try:
                    checked = config.directory(str(item))
                    entries.append({"name": item.name, "path": str(checked)})
                except (ValueError, OSError):
                    continue
                if len(entries) >= 200:
                    break
            parent = str(directory.parent) if directory not in config.roots else None
            return {"path": str(directory), "parent": parent, "data": entries}
        except PermissionError:
            raise HTTPException(403, "没有权限读取目录")

    @application.get("/api/monitor")
    async def monitor():
        return service().monitor.snapshot()

    @application.get("/api/threads/{tid}/turns")
    async def turns(tid: str, cursor: str | None = None):
        return await service().sessions.turns(tid, cursor)

    @application.get("/api/threads/{tid}/turns/{turn_id}/items")
    async def turn_items(tid: str, turn_id: str, cursor: str | None = None):
        return await service().sessions.items(tid, turn_id, cursor)

    @application.get("/api/threads/{tid}/turns/{turn_id}/summary")
    async def turn_summary(tid: str, turn_id: str):
        return service().monitor.turn_summary(tid, turn_id)

    @application.get("/api/threads")
    async def threads(
        archived: bool = False, cursor: str | None = None, search: str | None = None
    ):
        return await service().sessions.threads(archived, cursor, search)

    @application.get("/api/threads/{tid}")
    async def thread(tid: str, subscribe: bool = False):
        return await service().sessions.read(tid, subscribe)

    @application.get("/api/threads/{tid}/children")
    async def children(tid: str):
        return {"data": await service().sessions.children(tid)}

    @application.get("/api/threads/{tid}/terminals")
    async def terminals(tid: str):
        return await service().sessions.terminals(tid)

    @application.get("/api/threads/{tid}/cleanup-preview")
    async def preview(tid: str):
        return await service().sessions.preview(tid)

    @application.post("/api/operations")
    async def operation(body: Operation):
        # Bound message/request size independently of frontend controls.
        if len(json.dumps(body.body)) > 200000:
            raise HTTPException(413, "请求过大")
        return await service().operations.execute(
            body.operationId, body.action, body.body
        )

    @application.get("/api/operations/{key}")
    async def receipt(key: str):
        result = application.state.store.receipt(key)
        if result is None:
            raise HTTPException(404, "尚未找到此请求；请核查会话，不会自动重复提交")
        return result
