"""Resolve explicit input references using the same daemon as task execution."""

import asyncio
import hashlib
import json
import os
import re
from pathlib import Path

from samaya.cache import ReadCache
from samaya.codex.connection import Connection
from samaya.config import Settings
from samaya.sessions.queries import SessionQueries

from .files import attachment_text, file_ids
from .images import message_inputs


class InputCatalog:
    def __init__(
        self, config: Settings, connection: Connection, queries: SessionQueries
    ):
        self.config, self.connection, self.queries = config, connection, queries
        self.skills_cache = ReadCache()
        self.apps_cache = ReadCache()
        self.apps_signature: str | None = None

    def invalidate(self, kind=None):
        if kind != "apps":
            self.skills_cache.invalidate()
        if kind != "skills":
            self.apps_cache.invalidate()

    def observe_apps(self, params: dict):
        # The daemon also emits list notifications after a read. An identical
        # list must not invalidate the very read that is populating the cache.
        if not isinstance(params.get("data"), list):
            self.invalidate("apps")
            return
        rows = sorted(
            (self.app_summary(item) for item in params["data"]),
            key=lambda r: r.get("id", ""),
        )
        signature = hashlib.sha256(
            json.dumps(rows, sort_keys=True).encode()
        ).hexdigest()
        if signature != self.apps_signature:
            self.apps_signature = signature
            self.invalidate("apps")

    @staticmethod
    def app_summary(item: dict) -> dict:
        return {
            k: (v[:512] if k == "description" and isinstance(v, str) else v)
            for k, v in item.items()
            if k in ("id", "name", "description", "isEnabled", "isAccessible")
        }

    async def directory(self, tid: str | None, cwd: str | None) -> str:
        if tid:
            cwd = (await self.queries.read(tid, include_turns=False))["thread"]["cwd"]
        if not cwd:
            raise ValueError("先选择工作目录")
        return str(self.config.directory(cwd))

    async def discover(
        self, tid: str | None = None, cwd: str | None = None, refresh=False
    ):
        cwd = await self.directory(tid, cwd)
        generation = self.connection.generation
        self.connection.connected()
        skills, apps = await asyncio.gather(
            self.skills_cache.get(
                (generation, cwd),
                lambda: self.connection.rpc(
                    "skills/list", {"cwds": [cwd], "forceReload": refresh}
                ),
                refresh,
            ),
            self.apps_cache.get(
                (generation, tid), lambda: self._apps(tid, refresh), refresh
            ),
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
                            "description": (
                                item.get("shortDescription")
                                or item.get("description", "")
                            )[:512],
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
                        "description": (item.get("description") or "已连接应用")[:512],
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
            data.extend(self.app_summary(item) for item in page.get("data", []))
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

    async def inputs(
        self,
        tid: str,
        text: str,
        references: list,
        expected_cwd=None,
        images=None,
        files=None,
    ):
        if not isinstance(references, list) or len(references) > 32:
            raise ValueError("无效的技能或应用引用")
        uploaded = files if files is not None else []
        if file_ids(uploaded):
            directory = await self.directory(tid, None)
            if not isinstance(expected_cwd, str) or self.config.directory(
                expected_cwd
            ) != Path(directory):
                raise ValueError("工作目录已变化，请重新上传附件")
            text = text + await asyncio.to_thread(
                attachment_text, Path(directory), uploaded
            )
        inputs = message_inputs(text, images if images is not None else [])
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
