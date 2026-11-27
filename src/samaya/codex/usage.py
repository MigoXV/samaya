"""Read-only account data for the usage dashboard."""

from openai_codex.errors import JsonRpcError

from .connection import Connection


def _text(row: dict, key: str) -> str | None:
    value = row.get(key)
    return (value.strip() or None) if isinstance(value, str) else None


async def read_usage_account(connection: Connection) -> dict:
    result = await connection.rpc("account/read", {"refreshToken": False})
    account = result.get("account")
    if not account:
        return {"account": None}
    identity = {
        "type": account.get("type"),
        "displayName": _text(account, "displayName"),
        "username": _text(account, "username"),
        "email": _text(account, "email"),
        "planType": _text(account, "planType"),
    }
    if identity["type"] != "chatgpt" or (
        identity["displayName"] and identity["username"]
    ):
        return {"account": identity}

    try:
        sessions = await connection.rpc(
            "accountSession/list", {"refreshWorkspaceMetadata": False}
        )
    except (ConnectionError, JsonRpcError):
        # Older daemons may only expose the account's email and plan.
        return {"account": identity}

    active_id = sessions.get("activeSessionId")
    active = next(
        (
            row
            for row in sessions.get("sessions", [])
            if row.get("isActive")
            and (active_id is None or row.get("sessionId") == active_id)
        ),
        {},
    )
    user_id = _text(result, "userId")
    active_user_id = _text(active, "userId")
    email = identity["email"]
    active_email = _text(active, "email")
    # The active account may have changed between the two native reads.
    same_account = (
        user_id == active_user_id
        if user_id and active_user_id
        else email and active_email and email.casefold() == active_email.casefold()
    )
    if same_account:
        for field in ("displayName", "username", "email"):
            identity[field] = identity[field] or _text(active, field)
    return {"account": identity}
