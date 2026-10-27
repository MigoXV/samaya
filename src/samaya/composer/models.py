"""Model capabilities and workspace defaults shared by drafts and live threads."""

from samaya.cache import ReadCache
from samaya.codex.connection import Connection


def model_options(rows: list[dict], current_model: str | None) -> list[dict]:
    return [
        {
            "model": m["model"],
            "displayName": m.get("displayName") or m["model"],
            "isDefault": bool(m.get("isDefault")),
            "effortOptions": [
                {"value": e["reasoningEffort"], "label": e["description"]}
                for e in m.get("supportedReasoningEfforts") or []
            ],
            "defaultEffort": m.get("defaultReasoningEffort"),
            "serviceTiers": m.get("serviceTiers") or [],
            "defaultServiceTier": m.get("defaultServiceTier"),
        }
        for m in rows
        if not m.get("hidden") or m["model"] == current_model
    ]


async def model_rows(connection: Connection) -> list[dict]:
    cache = getattr(connection, "model_catalog", None)
    if cache is None:
        connection.model_catalog = cache = ReadCache(limit=1)

    async def load():
        rows, cursor = [], None
        while True:
            page = await connection.rpc("model/list", {"limit": 100, "cursor": cursor})
            rows.extend(page.get("data", []))
            cursor = page.get("nextCursor")
            if not cursor:
                return rows

    return await cache.get(getattr(connection, "generation", 0), load)


async def draft_settings(connection: Connection, cwd: str) -> dict:
    config = (
        await connection.rpc("config/read", {"cwd": cwd, "includeLayers": False})
    )["config"]
    rows = await model_rows(connection)
    model = config.get("model") or next(
        (m["model"] for m in rows if m.get("isDefault")), None
    )
    models = model_options(rows, model)
    selected = next((m for m in models if m["model"] == model), {})
    return {
        "cwd": cwd,
        "models": models,
        "current": {
            "model": model,
            "reasoningEffort": config.get("model_reasoning_effort")
            or selected.get("defaultEffort"),
            "serviceTier": config.get("service_tier")
            or selected.get("defaultServiceTier")
            or "default",
        },
        "expectedTurnId": None,
        "active": False,
        "editable": True,
    }


def validate_selection(settings: dict, choice: dict) -> dict:
    if not isinstance(choice, dict):
        raise ValueError("无效的模型设置")  # noqa: TRY004 - definite operation rejection
    selected = next(
        (m for m in settings["models"] if m["model"] == choice.get("model")), None
    )
    if not selected:
        raise ValueError("模型目录已变化，请重新选择模型")
    effort = choice.get("reasoningEffort")
    efforts = {e["value"] for e in selected["effortOptions"]}
    if effort not in efforts and (effort is not None or efforts):
        raise ValueError("当前模型不支持此思考强度，请重新选择")
    tier = choice.get("serviceTier", "default")
    tiers = {t["id"] for t in selected["serviceTiers"]}
    # Config can use either spelling for the native fast lane.
    if tier in ("fast", "priority") and tier not in tiers:
        tier = next((t for t in ("fast", "priority") if t in tiers), tier)
    if tier != "default" and tier not in tiers:
        raise ValueError("当前模型不支持此服务档位，请重新选择")
    return {"model": selected["model"], "reasoningEffort": effort, "serviceTier": tier}
