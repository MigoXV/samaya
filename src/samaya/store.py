"""Samaya metadata only: receipts, browser event replay and watched IDs.

Execution status remains authoritative in app-server, never in this database.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import sqlite3
import time
from pathlib import Path


class Store:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        directory.chmod(0o700)
        self._lock = (directory / "instance.lock").open("a+b")
        try:
            fcntl.flock(self._lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            self._lock.close()
            raise RuntimeError(
                "此 SAMAYA_DATA_DIR 已被另一实例使用；请仅运行一个 worker"
            ) from exc
        self.path = directory / "samaya.sqlite3"
        self.db = sqlite3.connect(self.path)
        os.chmod(directory / "samaya.sqlite3", 0o600)
        self.db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, fingerprint TEXT, state TEXT, result TEXT, created REAL);
        CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT, created REAL);
        CREATE TABLE IF NOT EXISTS watched(id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS token_usage(thread_id TEXT PRIMARY KEY, payload TEXT, observed REAL);
        """)
        self.db.execute("UPDATE operations SET state='uncertain' WHERE state='pending'")
        self.db.commit()

    def reserve(self, key: str, body: dict) -> tuple[bool, dict]:
        fingerprint = hashlib.sha256(
            json.dumps(body, sort_keys=True).encode()
        ).hexdigest()
        row = self.db.execute(
            "SELECT fingerprint,state,result FROM operations WHERE id=?", (key,)
        ).fetchone()
        if row:
            if row[0] != fingerprint:
                raise ValueError("操作编号已用于不同请求")
            return False, {
                "operationId": key,
                "state": row[1],
                "result": json.loads(row[2]) if row[2] else None,
            }
        self.db.execute(
            "INSERT INTO operations VALUES(?,?,?,?,?)",
            (key, fingerprint, "pending", None, time.time()),
        )
        self.db.commit()
        return True, {}

    def finish(self, key: str, state: str, result: dict) -> dict:
        self.db.execute(
            "UPDATE operations SET state=?,result=? WHERE id=?",
            (state, json.dumps(result), key),
        )
        self.db.commit()
        return {"operationId": key, "state": state, "result": result}

    def receipt(self, key: str) -> dict | None:
        row = self.db.execute(
            "SELECT state,result FROM operations WHERE id=?", (key,)
        ).fetchone()
        return (
            {
                "operationId": key,
                "state": row[0],
                "result": json.loads(row[1]) if row[1] else None,
            }
            if row
            else None
        )

    def token_usage(self, thread_id: str) -> dict | None:
        row = self.db.execute(
            "SELECT payload,observed FROM token_usage WHERE thread_id=?", (thread_id,)
        ).fetchone()
        return {"usage": json.loads(row[0]), "observedAt": row[1]} if row else None

    def event(self, payload: dict) -> int:
        if payload.get("method") == "app/list/updated":
            payload = {"method": "samaya/catalogChanged", "params": {}}
        if payload.get("method") == "thread/tokenUsage/updated":
            params = payload.get("params", {})
            if params.get("threadId") and isinstance(params.get("tokenUsage"), dict):
                self.db.execute(
                    "INSERT OR REPLACE INTO token_usage VALUES(?,?,?)",
                    (params["threadId"], json.dumps(params["tokenUsage"]), time.time()),
                )
        cursor = self.db.execute(
            "INSERT INTO events(payload,created) VALUES(?,?)",
            (json.dumps(payload), time.time()),
        )
        seq = cursor.lastrowid or 0
        self.db.execute("DELETE FROM events WHERE id < ?", (seq - 10000,))
        self.db.commit()
        return seq

    def events(self, after: int) -> list[dict]:
        return [
            {"id": row[0], "data": json.loads(row[1])}
            for row in self.db.execute(
                "SELECT id, CASE WHEN substr(payload,1,100) LIKE ? "
                'THEN \'{"method":"samaya/catalogChanged","params":{}}\' ELSE payload END '
                "FROM events WHERE id>? ORDER BY id LIMIT 500",
                ('%"method": "app/list/updated"%', after),
            )
        ]

    def event_floor(self) -> int:
        return self.db.execute("SELECT COALESCE(MIN(id),0) FROM events").fetchone()[0]

    def compact_catalog_events(self, limit: int = 20) -> bool:
        """Bounded upgrade of disposable replay data, preserving cursor identities."""
        with sqlite3.connect(self.path, timeout=5) as db:
            rows = db.execute(
                "SELECT id FROM events WHERE substr(payload,1,100) LIKE ? LIMIT ?",
                ('%"method": "app/list/updated"%', limit),
            ).fetchall()
            if rows:
                db.executemany(
                    "UPDATE events SET payload=? WHERE id=?",
                    [
                        ("{" + '"method":"samaya/catalogChanged","params":{}}', row[0])
                        for row in rows
                    ],
                )
        return bool(rows)

    def cursor(self) -> int:
        return self.db.execute("SELECT COALESCE(MAX(id),0) FROM events").fetchone()[0]

    def watch(self, thread_id: str) -> None:
        self.db.execute("INSERT OR IGNORE INTO watched VALUES(?)", (thread_id,))
        self.db.commit()

    def watched(self) -> list[str]:
        return [row[0] for row in self.db.execute("SELECT id FROM watched")]

    def close(self) -> None:
        self.db.close()
        self._lock.close()
