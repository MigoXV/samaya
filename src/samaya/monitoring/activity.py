"""Only real conversation activity advances browser recency/hide watermarks."""


def activity_thread(event: dict) -> str | None:
    method, params = event.get("method", ""), event.get("params", {})
    tid = params.get("threadId") or params.get("thread", {}).get("id")
    if not tid:
        return None
    if method in (
        "turn/started",
        "turn/completed",
        "turn/plan/updated",
        "turn/diff/updated",
    ):
        return tid
    if method.startswith("item/") and (
        method.endswith(("/started", "/completed", "/delta", "Delta")) or "id" in event
    ):
        return tid
    if "id" in event and method.startswith("mcpServer/"):
        return tid
    if (
        method == "samaya/operation"
        and params.get("state") == "succeeded"
        and params.get("action") in ("send", "steer", "respond")
    ):
        return tid
    return None
