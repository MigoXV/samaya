"""MCP elicitation boundary for Codex 0.160.0, not an MCP execution engine."""

import copy
import json
import math
from pathlib import Path
from urllib.parse import urlsplit

from jsonschema import Draft7Validator, FormatChecker
from jsonschema.exceptions import SchemaError

METHOD = "mcpServer/elicitation/request"
_schema = json.loads(Path(__file__).with_name("mcp_form_schema.json").read_text())
_form_validator = Draft7Validator(_schema)


def safe_url(value: object) -> bool:
    if not isinstance(value, str) or any(ord(c) < 33 for c in value):
        return False
    try:
        url = urlsplit(value)
        return (
            url.scheme in ("http", "https")
            and bool(url.hostname)
            and not (url.username or url.password)
        )
    except ValueError:
        return False


def form_schema(raw: object) -> dict:
    if not isinstance(raw, dict) or not _form_validator.is_valid(raw):
        raise ValueError("此表单包含暂不支持的字段或约束")
    schema = copy.deepcopy(raw)

    # Nullable optional constraints in the app-server schema mean absent.
    def strip_null(value):
        if isinstance(value, dict):
            return {k: strip_null(v) for k, v in value.items() if v is not None}
        if isinstance(value, list):
            return [strip_null(v) for v in value]
        return value

    schema = strip_null(schema)
    properties = schema["properties"]
    if len(properties) > 64 or len(json.dumps(schema)) > 128_000:
        raise ValueError("此表单过大，暂不支持在网页填写")
    if any(k not in properties for k in schema.get("required", [])):
        raise ValueError("表单的必填字段定义不完整")
    # Never resolve external references, execute patterns, or accept undeclared keys.
    schema["additionalProperties"] = False
    Draft7Validator.check_schema(schema)
    return schema


def presentation(params: dict) -> dict:
    mode = params.get("mode")
    try:
        if mode == "form":
            result = {
                "mode": "form",
                "schema": form_schema(params.get("requestedSchema")),
            }
            meta = params.get("_meta") or {}
            if (
                isinstance(meta, dict)
                and meta.get("codex_approval_kind") == "mcp_tool_call"
            ):
                result["toolApproval"] = True
                result["arguments"] = meta.get("tool_params")
            return result
        if mode == "url" and safe_url(params.get("url")):
            return {
                "mode": "url",
                "url": params["url"],
                "host": urlsplit(params["url"]).netloc,
            }
        raise ValueError("暂不支持此请求模式或链接；可拒绝或取消本次请求")
    except (ValueError, TypeError, SchemaError):
        return {
            "mode": "unsupported",
            "reason": "此请求含不支持的模式、字段或链接。可拒绝或取消。",
        }


def validate_response(params: dict, result: dict) -> dict:
    action = result.get("action")
    if action not in ("accept", "decline", "cancel"):
        raise ValueError("请选择接受、拒绝或取消")
    if action != "accept":
        return {"action": action, "content": None}
    view = presentation(params)
    if view["mode"] == "unsupported":
        raise ValueError(view["reason"])
    if view["mode"] == "url":
        return {"action": action, "content": None}
    content = result.get("content")
    # JSON permits no non-finite numbers; Python's JSON decoder does by default.
    if isinstance(content, dict) and any(
        isinstance(v, float) and not math.isfinite(v) for v in content.values()
    ):
        raise ValueError("数字必须为有限值")
    error = next(
        Draft7Validator(view["schema"], format_checker=FormatChecker()).iter_errors(
            content
        ),
        None,
    )
    if error:
        # Do not echo submitted values into durable operation receipts or logs.
        field = str(next(iter(error.path), "表单"))
        raise ValueError(f"{field}：不符合表单要求（{error.validator}）")
    return {"action": action, "content": content}


def resolved_by(request: dict, method: str, params: dict) -> bool:
    if method == "serverRequest/resolved":
        return request["id"] == params.get("requestId") and (
            not params.get("threadId")
            or request["params"].get("threadId") == params["threadId"]
        )
    return (
        method == "turn/completed"
        and request["method"] != METHOD
        and bool(params.get("turn", {}).get("id"))
        and request["params"].get("threadId") == params.get("threadId")
        and request["params"].get("turnId") == params["turn"]["id"]
    )
