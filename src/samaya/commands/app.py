from __future__ import annotations

import asyncio
import logging

import typer
import uvicorn
from dotenv import load_dotenv

from samaya.codex.adapter import Adapter
from samaya.config import settings

load_dotenv()
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s"
)
logger = logging.getLogger(__name__)
app = typer.Typer(help="Samaya · Codex 网页工作台")


@app.command()
def serve(
    host: str = typer.Option("0.0.0.0", envvar="SAMAYA_HOST", help="监听地址"),
    port: int = typer.Option(8000, envvar="SAMAYA_PORT", help="监听端口"),
) -> None:
    config = settings()
    if host not in ("127.0.0.1", "localhost", "::1") and not config.token:
        raise typer.BadParameter("远程监听必须设置 SAMAYA_TOKEN")
    logger.info("Starting Samaya at %s:%d", host, port)
    uvicorn.run(
        "samaya.web.app:app",
        host=host,
        port=port,
        workers=1,
        proxy_headers=False,
        timeout_graceful_shutdown=5,
    )


@app.command()
def doctor() -> None:
    """只读核查 SDK 与常驻 app-server 的连接。"""

    async def check():
        adapter = Adapter(settings().socket)
        try:
            await adapter.start()
            loaded = await adapter.request("thread/loaded/list", {"limit": 100})
            logger.info(
                "Connected: %s; loaded threads: %d",
                adapter.sdk.metadata.userAgent,
                len(loaded["data"]),
            )
        finally:
            await adapter.close()

    asyncio.run(check())


if __name__ == "__main__":
    app()
