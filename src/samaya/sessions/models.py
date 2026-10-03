"""Native thread identity and turn helpers shared by session consumers."""


def parent_id(thread: dict) -> str | None:
    source = thread.get("source")
    spawn = (
        source.get("subAgent", {}).get("thread_spawn", {})
        if isinstance(source, dict)
        else {}
    )
    return thread.get("parentThreadId") or spawn.get("parent_thread_id")


def normalize(thread: dict) -> dict:
    thread["parentThreadId"] = parent_id(thread)
    return thread


def active_turn(thread: dict) -> dict | None:
    return next(
        (
            t
            for t in reversed(thread.get("turns", []))
            if t.get("status") == "inProgress"
        ),
        None,
    )
