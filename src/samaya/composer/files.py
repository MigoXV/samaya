"""Workspace-scoped file storage and native text references for uploaded files."""

import asyncio
import json
import re
import shutil
import stat
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_FILE_BYTES = 50 * 1024 * 1024
MAX_FILES = 5


class UploadTooLarge(ValueError):
    pass


def file_ids(files: list) -> list[str]:
    if not isinstance(files, list) or len(files) > MAX_FILES:
        raise ValueError("每条消息最多添加 5 个文件")
    ids = []
    for entry in files:
        value = entry.get("id") if isinstance(entry, dict) else None
        if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{32}", value):
            raise ValueError("无效的文件附件，请重新上传")
        if value in ids:
            raise ValueError("文件附件重复")
        ids.append(value)
    return ids


def upload_root(cwd: Path) -> Path:
    root = cwd / ".samaya" / "uploads"
    if not root.resolve().is_relative_to(cwd.resolve()):
        raise ValueError("附件目录不在当前工作区内")
    return root


async def save_upload(cwd: Path, name: str, chunks: AsyncIterator[bytes]) -> dict:
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    if (
        not name.strip()
        or name in (".", "..")
        or len(name.encode("utf-8")) > 240
        or any(ord(c) < 32 or ord(c) == 127 for c in name)
    ):
        raise ValueError("文件名无效")
    root = upload_root(cwd)
    await asyncio.to_thread(root.mkdir, parents=True, exist_ok=True, mode=0o700)
    identity = uuid.uuid4().hex
    folder = root / identity
    folder.mkdir(mode=0o700)
    suffix = Path(name).suffix
    stored = "payload" + (suffix if len(suffix) <= 16 else "")
    total, complete = 0, False
    try:
        with (folder / stored).open("xb") as output:
            (folder / stored).chmod(0o600)
            async for chunk in chunks:
                total += len(chunk)
                if total > MAX_FILE_BYTES:
                    raise UploadTooLarge("单个文件不能超过 20 MB")
                await asyncio.to_thread(output.write, chunk)
        metadata = {"id": identity, "name": name, "size": total, "cwd": str(cwd)}
        (folder / "metadata.json").write_text(
            json.dumps({**metadata, "stored": stored}, ensure_ascii=False),
            encoding="utf-8",
        )
        (folder / "metadata.json").chmod(0o600)
        complete = True
        return metadata
    finally:
        if not complete:
            await asyncio.to_thread(shutil.rmtree, folder, ignore_errors=True)


def attachment_text(cwd: Path, files: list) -> str:
    attachments, total = [], 0
    root = upload_root(cwd)
    for identity in file_ids(files):
        folder = root / identity
        if folder.is_symlink() or not folder.is_dir():
            raise ValueError("附件不存在，请重新上传")
        try:
            metadata_path = folder / "metadata.json"
            if metadata_path.is_symlink() or metadata_path.stat().st_size > 4096:
                raise ValueError("附件元信息无效")
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            path = folder / metadata["stored"]
            if (
                metadata["id"] != identity
                or metadata["cwd"] != str(cwd)
                or path.is_symlink()
                or path.resolve().parent != folder.resolve()
                or not stat.S_ISREG(path.stat().st_mode)
                or path.stat().st_size != metadata["size"]
                or not 0 <= metadata["size"] <= MAX_FILE_BYTES
            ):
                raise ValueError("附件已变化，请重新上传")
            total += metadata["size"]
            attachments.append(
                {
                    "id": identity,
                    "name": metadata["name"],
                    "size": metadata["size"],
                    "path": str(path),
                }
            )
        except (OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
            raise ValueError("附件不可用，请重新上传") from exc
    if total > MAX_TOTAL_FILE_BYTES:
        raise ValueError("文件总大小不能超过 50 MB")
    return (
        (
            "\n\n<samaya_attachments>\n"
            + json.dumps({"files": attachments}, ensure_ascii=False)
            + "\n</samaya_attachments>"
        )
        if attachments
        else ""
    )
