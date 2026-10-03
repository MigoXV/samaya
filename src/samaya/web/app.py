from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from openai_codex.errors import JsonRpcError

from samaya.config import Settings, settings
from samaya.runtime import Runtime
from samaya.store import Store

from .auth import register_auth
from .events import register_events
from .routes import register_routes


def create_app(config: Settings | None = None) -> FastAPI:
    config = config or settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        if not (config.dist / "index.html").is_file():
            raise RuntimeError(
                "缺少前端构建产物 src/web/dist/index.html；请先运行 pnpm --dir src/web run build"
            )
        store = Store(config.data_dir)
        service = Runtime(config, store)
        application.state.runtime, application.state.store = service, store
        await service.start()
        try:
            yield
        finally:
            await service.close()
            store.close()

    application = FastAPI(title="Samaya", lifespan=lifespan)

    @application.exception_handler(JsonRpcError)
    async def protocol_error(_request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=502)

    @application.exception_handler(ConnectionError)
    async def connection_error(_request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=503)

    @application.exception_handler(ValueError)
    async def value_error(_request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    register_auth(application, config)
    register_routes(application, config)
    register_events(application)

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
