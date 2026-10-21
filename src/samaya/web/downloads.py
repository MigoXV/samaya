"""Authenticated browser downloads of files referenced in a conversation."""

import re
import stat
from pathlib import Path
from urllib.parse import unquote, urlsplit

from fastapi import HTTPException
from fastapi.responses import FileResponse

_LOCATION = re.compile(
    r"(?::[1-9]\d*(?::[1-9]\d*)?|#L[1-9]\d*(?:C[1-9]\d*)?"
    r"(?:-L?[1-9]\d*(?:C[1-9]\d*)?)?)$"
)
_SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z\d+.-]*:")
_RELATIVE_SOURCE = re.compile(r"^[^/:]+\.[^/:]+:[1-9]\d*(?::[1-9]\d*)?$")


def download_response(directory: Path, link: str) -> FileResponse:
    value = link.strip()
    if value.lower().startswith(("file:", "sandbox:")):
        try:
            url = urlsplit(value)
        except ValueError as exc:
            raise HTTPException(400, "文件链接格式不正确") from exc
        if url.netloc.lower() not in ("", "localhost") or url.query:
            raise HTTPException(400, "只支持服务器本地文件链接")
        value = url.path + ("#" + url.fragment if url.fragment else "")
        if not value.startswith("/"):
            raise HTTPException(400, "文件链接需要绝对路径")
    elif _SCHEME.match(value) and not _RELATIVE_SOURCE.fullmatch(value):
        raise HTTPException(400, "只支持服务器本地文件链接")
    if not value or value.startswith(("//", "#", "?")):
        raise HTTPException(400, "文件链接格式不正确")

    # Prefer literal names (including '%' and ':12') before URL decoding or
    # removing editor line/column locations. Decode once, never recursively.
    values = list(dict.fromkeys([value, unquote(value)]))
    if any(any(ord(c) < 32 or ord(c) == 127 for c in v) for v in values):
        raise HTTPException(400, "文件路径包含无效字符")
    candidates = list(dict.fromkeys(values + [_LOCATION.sub("", v) for v in values]))
    for candidate in candidates:
        try:
            path = Path(candidate).expanduser()
            if not path.is_absolute():
                path = directory / path
            resolved = path.resolve(strict=True)
            info = resolved.stat()
            if not stat.S_ISREG(info.st_mode):
                raise HTTPException(400, "只能下载普通文件，不能下载目录或特殊文件")
            # Check readability before sending headers, including HEAD requests.
            with resolved.open("rb"):
                pass
            return FileResponse(
                resolved,
                filename=path.name,
                media_type="application/octet-stream",
                content_disposition_type="attachment",
                stat_result=info,
            )
        except (FileNotFoundError, NotADirectoryError):
            continue
        except PermissionError as exc:
            raise HTTPException(403, "没有权限读取文件") from exc
        except (OSError, RuntimeError) as exc:
            raise HTTPException(400, "文件路径无效或无法读取") from exc
    raise HTTPException(404, "文件不存在或已移动")
