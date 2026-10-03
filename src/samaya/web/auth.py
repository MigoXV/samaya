"""Single-user browser authentication and request boundaries."""

import hashlib
import hmac
import secrets
import time
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from samaya.config import Settings


class Login(BaseModel):
    token: str = Field(max_length=512)


def register_auth(application: FastAPI, config: Settings) -> None:
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
