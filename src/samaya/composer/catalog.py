"""Resolve explicit input references using the same daemon as task execution."""

import asyncio
import os
import re
import time
from pathlib import Path

from samaya.codex.connection import Connection
from samaya.config import Settings
from samaya.sessions.queries import SessionQueries


class InputCatalog:
    def __init__(
        self, config: Settings, connection: Connection, queries: SessionQueries
    ):
        self.config, self.connection, self.queries = config, connection, queries
        self.cache: dict[tuple, tuple[float, dict]] = {}

    def invalidate(self):
        self.cache.clear()

    async def directory(self, tid: str | None, cwd: str | None) -> str:
        if tid:
            cwd = (await self.queries.read(tid))["thread"]["cwd"]
        if not cwd:
            raise ValueError("先选择工作目录")
        return str(self.config.directory(cwd))

    async def discover(
        self, tid: str | None = None, cwd: str | None = None, refresh=False
    ):
        cwd = await self.directory(tid, cwd)
        key = (self.connection.generation, tid, cwd)
        cached = self.cache.get(key)
        if cached and not refresh and time.monotonic() - cached[0] < 30:
            return cached[1]
        self.connection.connected()
        skills, apps = await asyncio.gather(
            self.connection.rpc("skills/list", {"cwds": [cwd], "forceReload": refresh}),
            self._apps(tid, refresh),
            return_exceptions=True,
        )
        references, errors = [], []
        if isinstance(skills, BaseException):
            errors.append("技能目录加载失败，请刷新重试。")
        else:
            for entry in skills.get("data", []):
                if entry.get("cwd") != cwd:
                    continue
                if entry.get("errors"):
                    errors.append("部分技能无法解析；请核对技能文件。")
                for item in entry.get("skills", []):
                    references.append(
                        {
                            "type": "skill",
                            "name": item["name"],
                            "path": item["path"],
                            "label": (item.get("interface") or {}).get("displayName")
                            or item["name"],
                            "description": item.get("shortDescription")
                            or item.get("description", ""),
                            "enabled": item.get("enabled", False),
                            "source": item.get("pluginId")
                            or item.get("scope", "local"),
                        }
                    )
        if isinstance(apps, BaseException):
            errors.append(
                "应用目录当前不可用（服务端访问失败）；技能和普通输入仍可使用。"
            )
        else:
            for item in apps:
                slug = (
                    re.sub(r"[^\w-]+", "-", item["name"].lower()).strip("-")
                    or item["id"]
                )
                references.append(
                    {
                        "type": "mention",
                        "name": slug,
                        "path": "app://" + item["id"],
                        "label": item["name"],
                        "description": item.get("description") or "已连接应用",
                        "enabled": item.get("isEnabled", True)
                        and item.get("isAccessible", False),
                        "source": "app",
                    }
                )
        result = {
            "cwd": cwd,
            "references": references,
            "errors": errors,
            "prompts": self.prompts(),
        }
        if len(self.cache) >= 64:
            self.cache.pop(next(iter(self.cache)))
        self.cache[key] = (time.monotonic(), result)
        return result

    async def _apps(self, tid, refresh):
        data, cursor = [], None
        while True:
            page = await self.connection.rpc(
                "app/list",
                {
                    "threadId": tid,
                    "limit": 100,
                    "cursor": cursor,
                    "forceRefetch": refresh,
                },
            )
            data.extend(page.get("data", []))
            cursor = page.get("nextCursor")
            if not cursor:
                return data

    @staticmethod
    def prompts():
        # Only the user's Codex prompt directory; never arbitrary client paths.
        root = (
            Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "prompts"
        ).resolve()
        result = []
        for path in sorted(root.glob("*.md"))[:100]:
            try:
                if path.resolve().parent != root or path.stat().st_size > 32768:
                    continue
                body = path.read_text()
                if body.startswith("---\n"):
                    _, _, body = body.partition("\n---\n")
                result.append({"name": path.stem, "text": body.strip()})
            except (OSError, UnicodeError):
                continue
        return result

    async def inputs(self, tid: str, text: str, references: list, expected_cwd=None):
        if not isinstance(references, list) or len(references) > 32:
            raise ValueError("无效的技能或应用引用")
        inputs = [{"type": "text", "text": text}]
        if not references:
            return inputs
        current = await self.discover(tid, refresh=True)
        if expected_cwd != current["cwd"]:
            raise ValueError("工作目录已变化，请重新选择技能或应用")
        allowed = {
            (r["type"], r["name"], r["path"])
            for r in current["references"]
            if r["enabled"]
        }
        seen = set()
        for r in references:
            if not isinstance(r, dict):
                raise ValueError("无效引用")  # noqa: TRY004 - definite operation rejection
            key = tuple(r.get(k) for k in ("type", "name", "path"))
            if not all(isinstance(k, str) for k in key) or key not in allowed:
                raise ValueError("技能或应用已失效，请刷新目录并重新选择")
            if not re.search(r"(?<![\w$])\$" + re.escape(key[1]) + r"(?![\w:-])", text):
                raise ValueError("引用文本已删除，请移除对应引用后重试")
            if key not in seen:
                inputs.append(dict(zip(("type", "name", "path"), key)))
                seen.add(key)
        return inputs
