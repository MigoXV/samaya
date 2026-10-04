from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


@dataclass
class Settings:
    socket: str = field(
        default_factory=lambda: os.getenv(
            "SAMAYA_SOCKET",
            str(Path.home() / ".codex/app-server-control/app-server-control.sock"),
        )
    )
    roots: list[Path] = field(
        default_factory=lambda: [
            Path(p).resolve()
            for p in os.getenv("SAMAYA_ROOTS", "/workspace").split(os.pathsep)
            if p
        ]
    )
    data_dir: Path = field(
        default_factory=lambda: Path(os.getenv("SAMAYA_DATA_DIR", ".samaya")).resolve()
    )
    token: str = field(default_factory=lambda: os.getenv("SAMAYA_TOKEN", ""))
    secure_cookie: bool = field(
        default_factory=lambda: (
            os.getenv("SAMAYA_SECURE_COOKIE", "false").lower() == "true"
        )
    )
    dist: Path = field(
        default_factory=lambda: Path(__file__).resolve().parents[1] / "web/dist"
    )

    def directory(self, value: str) -> Path:
        path = Path(value).expanduser().resolve()
        if not path.is_dir():
            raise ValueError("目录不存在或不是文件夹")
        return path


def settings() -> Settings:
    load_dotenv()
    return Settings()
