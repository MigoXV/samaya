from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import secrets
import time
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from openai_codex.errors import JsonRpcError
from pydantic import BaseModel, Field

from samaya.codex.service import CodexService
from samaya.config import Settings, settings
from samaya.store import Store

logger = logging.getLogger(__name__)


class Login(BaseModel):
    token: str = Field(max_length=512)


class Operation(BaseModel):
    operationId: str = Field(min_length=16, max_length=128, pattern=r"^[a-zA-Z0-9_-]+$")
    action: str = Field(max_length=30)
    body: dict


def create_app(config: Settings | None = None) -> FastAPI:
    config = config or settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        if not (config.dist / "index.html").is_file():
            raise RuntimeError(
                "缺少前端构建产物 src/web/dist/index.html；请先运行 pnpm --dir src/web run build"
            )
        store = Store(config.data_dir)
        service = CodexService(config, store)
        application.state.service, application.state.store = service, store
        await service.start()
        try:
            yield
        finally:
            await service.close()
            store.close()

    application = FastAPI(title="Samaya", lifespan=lifespan)
    # Stable session signing across restart, without storing plaintext browser tokens.
    config.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    secret_file = config.data_dir / "session.key"
    if not secret_file.exists():
        with secret_file.open("xb") as f:
            f.write(secrets.token_bytes(32))
        secret_file.chmod(0o600)
    secret = hashlib.sha256(secret_file.read_bytes() + config.token.encode()).digest()
    failures: dict[str, list[float]] = {}

    def signature(value: str) -> str:
        return hmac.new(secret, value.encode(), hashlib.sha256).hexdigest()

    def valid_session(request: Request) -> str | None:
        value = request.cookies.get("samaya_session", "")
        try:
            payload, sig = value.rsplit(".", 1)
            timestamp = int(payload.split(":")[0])
            if (
                hmac.compare_digest(sig, signature(payload))
                and 0 <= time.time() - timestamp < 86400
            ):
                return value
        except (ValueError, TypeError):
            pass
        return None

    def local(request: Request) -> bool:
        return (
            request.client is not None
            and request.client.host in ("127.0.0.1", "::1", "testclient")
            and request.url.hostname in ("127.0.0.1", "localhost", "::1", "testserver")
        )

    def auth(request: Request) -> str:
        if not config.token:
            if not local(request):
                raise HTTPException(403, "远程访问需要配置 SAMAYA_TOKEN")
            return "local"
        session = valid_session(request)
        if not session:
            raise HTTPException(401, "请先登录")
        return session

    @application.middleware("http")
    async def boundary(request: Request, call_next):
        try:
            if request.url.path.startswith(("/api", "/openapi", "/docs", "/redoc")):
                if request.method not in ("GET", "HEAD", "OPTIONS"):
                    origin = request.headers.get("origin")
                    if origin and urlsplit(origin).netloc != request.headers.get(
                        "host"
                    ):
                        raise HTTPException(403, "跨站请求被拒绝")
                    if request.url.path != "/api/login":
                        session = auth(request)
                        if not hmac.compare_digest(
                            request.headers.get("x-samaya-csrf", ""), signature(session)
                        ):
                            raise HTTPException(403, "页面凭证已变化，请刷新")
                if request.url.path not in ("/api/login", "/api/auth"):
                    auth(request)
            response = await call_next(request)
        except HTTPException as exc:
            response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        )
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @application.exception_handler(JsonRpcError)
    async def protocol_error(_request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=502)

    @application.exception_handler(ConnectionError)
    async def connection_error(_request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=503)

    @application.exception_handler(ValueError)
    async def value_error(_request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @application.get("/api/auth")
    async def authentication(request: Request):
        try:
            session = auth(request)
            return {"authenticated": True, "csrf": signature(session)}
        except HTTPException:
            return {
                "authenticated": False,
                "remoteRequiresToken": not bool(config.token),
            }

    @application.post("/api/login")
    async def login(body: Login, request: Request, response: Response):
        if not config.token:
            raise HTTPException(403, "服务器尚未配置访问口令")
        address = request.client.host if request.client else "unknown"
        attempts = [t for t in failures.get(address, []) if time.time() - t < 60]
        if len(attempts) >= 10:
            raise HTTPException(429, "尝试过于频繁，请稍后再试")
        if not hmac.compare_digest(body.token, config.token):
            failures[address] = attempts + [time.time()]
            raise HTTPException(401, "访问口令不正确")
        payload = f"{int(time.time())}:{secrets.token_hex(24)}"
        value = payload + "." + signature(payload)
        response.set_cookie(
            "samaya_session",
            value,
            httponly=True,
            secure=config.secure_cookie,
            samesite="strict",
            max_age=86400,
        )
        return {"authenticated": True, "csrf": signature(value)}

    @application.post("/api/logout")
    async def logout(response: Response):
        response.delete_cookie("samaya_session")
        return {"ok": True}

    def service() -> CodexService:
        return application.state.service

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
        return await service().turns(tid, cursor)

    @application.get("/api/threads/{tid}/turns/{turn_id}/items")
    async def turn_items(tid: str, turn_id: str, cursor: str | None = None):
        return await service().items(tid, turn_id, cursor)

    @application.get("/api/threads/{tid}/turns/{turn_id}/summary")
    async def turn_summary(tid: str, turn_id: str):
        return await service().turn_summary(tid, turn_id)

    @application.get("/api/threads")
    async def threads(
        archived: bool = False, cursor: str | None = None, search: str | None = None
    ):
        return await service().threads(archived, cursor, search)

    @application.get("/api/threads/{tid}")
    async def thread(tid: str, subscribe: bool = False):
        return await service().read(tid, subscribe)

    @application.get("/api/threads/{tid}/children")
    async def children(tid: str):
        return {"data": await service().children(tid)}

    @application.get("/api/threads/{tid}/terminals")
    async def terminals(tid: str):
        return await service().terminals(tid)

    @application.get("/api/threads/{tid}/cleanup-preview")
    async def preview(tid: str):
        return await service().preview(tid)

    @application.post("/api/operations")
    async def operation(body: Operation):
        # Bound message/request size independently of frontend controls.
        if len(json.dumps(body.body)) > 200000:
            raise HTTPException(413, "请求过大")
        return await service().execute(body.operationId, body.action, body.body)

    @application.get("/api/operations/{key}")
    async def receipt(key: str):
        result = application.state.store.receipt(key)
        if result is None:
            raise HTTPException(404, "尚未找到此请求；请核查会话，不会自动重复提交")
        return result

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

    @application.api_route(
        "/api",
        methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        include_in_schema=False,
    )
    @application.api_route(
        "/api/{path:path}",
        methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        include_in_schema=False,
    )
    async def unknown_api(path: str = ""):
        raise HTTPException(404, f"API route not found: /api/{path}")

    # The lifespan check supplies an actionable error before serving starts.
    if not (config.dist / "index.html").is_file():
        raise RuntimeError(
            "缺少前端构建产物 src/web/dist/index.html；请先运行 pnpm --dir src/web run build"
        )
    application.frontend("/", directory=config.dist, fallback="index.html")
    return application


app = create_app()
