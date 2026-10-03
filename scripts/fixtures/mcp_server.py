"""Dedicated real stdio MCP acceptance server. Never configured globally."""

import asyncio
import json
import sys
from pathlib import Path

SCHEMA = {
    "type": "object",
    "properties": {
        "name": {
            "type": "string",
            "title": "报告名称",
            "minLength": 2,
            "maxLength": 80,
        },
        "count": {
            "type": "integer",
            "title": "最多条数",
            "minimum": 0,
            "maximum": 20,
            "default": 10,
        },
        "format": {
            "type": "string",
            "title": "输出格式",
            "oneOf": [
                {"const": "md", "title": "Markdown"},
                {"const": "txt", "title": "纯文本"},
            ],
            "default": "md",
        },
        "archived": {"type": "boolean", "title": "包含归档"},
        "sections": {
            "type": "array",
            "title": "包含章节",
            "items": {"type": "string", "enum": ["摘要", "变更", "风险"]},
            "minItems": 1,
            "maxItems": 2,
        },
    },
    "required": ["name", "count", "format", "archived", "sections"],
}


async def main():
    pending = {}
    counter = 0
    base = Path(sys.argv[1])
    base.mkdir(parents=True, exist_ok=True)

    def emit(message):
        print(json.dumps({"jsonrpc": "2.0", **message}, ensure_ascii=False), flush=True)

    async def handle(m):
        nonlocal counter
        method, p = m.get("method"), m.get("params", {})
        if method == "initialize":
            emit(
                {
                    "id": m["id"],
                    "result": {
                        "protocolVersion": "2025-11-25",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "samaya_acceptance", "version": "1.0"},
                    },
                }
            )
        elif method == "tools/list":
            emit(
                {
                    "id": m["id"],
                    "result": {
                        "tools": [
                            {
                                "name": "collect",
                                "description": "Ask the user for test report fields (form) or open a local test authorization page (url). Call once with requested mode.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "mode": {
                                            "type": "string",
                                            "enum": ["form", "url"],
                                        }
                                    },
                                    "required": ["mode"],
                                },
                            }
                        ]
                    },
                }
            )
        elif method == "tools/call":
            with (base / "calls.jsonl").open("a") as f:
                f.write(
                    json.dumps({"tool": p.get("name"), "arguments": p.get("arguments")})
                    + "\n"
                )
            counter += 1
            rid = f"input-{counter}"
            mode = p.get("arguments", {}).get("mode", "form")
            request = {
                "mode": mode,
                "message": "请选择报告范围。"
                if mode == "form"
                else "请到本地测试服务页面完成授权。",
            }
            if mode == "form":
                request["requestedSchema"] = SCHEMA
            else:
                request.update(url="http://127.0.0.1:8767/authorize", elicitationId=rid)
            future = asyncio.get_running_loop().create_future()
            pending[rid] = future
            emit({"id": rid, "method": "elicitation/create", "params": request})
            response = await future
            with (base / "responses.jsonl").open("a") as f:
                f.write(json.dumps({"mode": mode, "response": response}) + "\n")
            if mode == "url" and response.get("action") == "accept":
                for _ in range(120):
                    if (base / "authorized").exists():
                        break
                    await asyncio.sleep(0.5)
                else:
                    raise RuntimeError("local authorization not completed")
            token = p.get("_meta", {}).get("progressToken")
            if token is not None:
                emit(
                    {
                        "method": "notifications/progress",
                        "params": {
                            "progressToken": token,
                            "progress": 1,
                            "total": 2,
                            "message": "正在生成验收报告…",
                        },
                    }
                )
            await asyncio.sleep(2)
            result = {
                "action": response.get("action"),
                "mode": mode,
                "content": response.get("content"),
                "authorized": mode == "url" and (base / "authorized").exists(),
            }
            emit(
                {
                    "id": m["id"],
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": "MCP_REAL_RESULT "
                                + json.dumps(result, ensure_ascii=False),
                            },
                            {
                                "type": "resource",
                                "resource": {
                                    "uri": "test://report",
                                    "mimeType": "text/plain",
                                    "text": "只读验收资源",
                                },
                            },
                        ],
                        "structuredContent": result,
                    },
                }
            )
        elif method == "ping":
            emit({"id": m["id"], "result": {}})
        elif method and "id" in m:
            emit(
                {
                    "id": m["id"],
                    "error": {"code": -32601, "message": "Unsupported fixture method"},
                }
            )
        elif "id" in m and m["id"] in pending:
            pending.pop(m["id"]).set_result(m.get("result", {}))

    reader = asyncio.StreamReader()
    await asyncio.get_running_loop().connect_read_pipe(
        lambda: asyncio.StreamReaderProtocol(reader), sys.stdin.buffer
    )
    tasks = set()
    while line := await reader.readline():
        task = asyncio.create_task(handle(json.loads(line)))
        tasks.add(task)
        task.add_done_callback(tasks.discard)
    await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(main())
