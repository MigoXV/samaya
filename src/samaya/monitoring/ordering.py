"""Persistent, once-per-turn ordering, separate from streaming activity."""

import time


class TurnOrdering:
    def __init__(self, store):
        self.store = store
        self.values = dict(
            store.db.execute("SELECT thread_id,ordered_at FROM thread_order")
        )

    def seed(self, records):
        rows = []
        missed = []
        for record in records:
            thread = record["thread"]
            tid = thread["id"]
            if tid not in self.values:
                at = thread.get("recencyAt") or thread.get("updatedAt") or 0
                self.values[tid] = at
                rows.append((tid, at))
            turn = record.get("turn") or {}
            started = turn.get("startedAt")
            if isinstance(started, (int, float)):
                started = started / 1000 if started > 1e12 else started
                if started > self.values[tid]:
                    missed.append(
                        {
                            "method": "turn/started",
                            "params": {"threadId": tid, "turn": turn},
                        }
                    )
        if rows:
            self.store.db.executemany(
                "INSERT OR IGNORE INTO thread_order VALUES(?,?)", rows
            )
            self.store.db.commit()
        # A reconnect can miss the live start notification. Native turn identity
        # and start time recover that one promotion without using reply recency.
        for event in missed:
            self.event(event)

    def event(self, event):
        if event.get("method") != "turn/started":
            return None
        params = event.get("params", {})
        tid, turn = params.get("threadId"), params.get("turn", {})
        if not tid or not turn.get("id"):
            return None
        db = self.store.db
        fresh = db.execute(
            "INSERT OR IGNORE INTO ordering_turns VALUES(?,?)", (tid, turn["id"])
        ).rowcount
        if not fresh:
            db.commit()
            return None
        at = turn.get("startedAt")
        if not isinstance(at, (float, int)):
            at = time.time()
        elif at > 1e12:
            at /= 1000
        # Late/replayed starts cannot move an older turn ahead of a newer one.
        at = max(self.values.get(tid, 0), at)
        self.values[tid] = at
        db.execute("INSERT OR REPLACE INTO thread_order VALUES(?,?)", (tid, at))
        db.commit()
        return tid
