from __future__ import annotations

import asyncio
import logging
import ssl
from pathlib import Path
from typing import Annotated

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
    ssl_certfile: Annotated[
        Path | None,
        typer.Option(
            envvar="SAMAYA_SSL_CERTFILE",
            help="HTTPS PEM 证书路径",
            exists=True,
            file_okay=True,
            dir_okay=False,
            readable=True,
        ),
    ] = None,
    ssl_keyfile: Annotated[
        Path | None,
        typer.Option(
            envvar="SAMAYA_SSL_KEYFILE",
            help="HTTPS PEM 私钥路径",
            exists=True,
            file_okay=True,
            dir_okay=False,
            readable=True,
        ),
    ] = None,
    ssl_keyfile_password: Annotated[
        str | None,
        typer.Option(
            envvar="SAMAYA_SSL_KEYFILE_PASSWORD",
            help="加密私钥密码",
            hide_input=True,
        ),
    ] = None,
) -> None:
    config = settings()
    if host not in ("127.0.0.1", "localhost", "::1") and not config.token:
        raise typer.BadParameter("远程监听必须设置 SAMAYA_TOKEN")
    if bool(ssl_certfile) != bool(ssl_keyfile):
        raise typer.BadParameter("HTTPS 证书和私钥必须同时配置")
    if ssl_keyfile_password and not ssl_keyfile:
        raise typer.BadParameter("私钥密码需要同时配置 HTTPS 证书和私钥")
    if ssl_certfile and ssl_keyfile:
        try:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(
                ssl_certfile, ssl_keyfile, ssl_keyfile_password or ""
            )
        except (OSError, ssl.SSLError) as exc:
            raise typer.BadParameter(f"无法加载 HTTPS 证书或私钥：{exc}") from exc
    logger.info(
        "Starting Samaya at %s://%s:%d", "https" if ssl_certfile else "http", host, port
    )
    uvicorn.run(
        "samaya.web.app:app",
        host=host,
        port=port,
        workers=1,
        proxy_headers=False,
        timeout_graceful_shutdown=5,
        ssl_certfile=str(ssl_certfile) if ssl_certfile else None,
        ssl_keyfile=str(ssl_keyfile) if ssl_keyfile else None,
        ssl_keyfile_password=ssl_keyfile_password,
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
