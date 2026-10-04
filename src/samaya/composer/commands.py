"""Versioned command registry. No arbitrary RPC or shell supplied by the browser."""

import asyncio

from samaya.composer.catalog import InputCatalog
from samaya.sessions.models import active_turn

# Native UI commands are handled by the existing workbench; the rest by this service.
UI = {
    "new": "新建任务",
    "resume": "切换已有任务",
    "project": "选择工作区",
    "local": "切换工作区",
    "copy": "复制最新回复",
    "skills": "浏览技能",
    "apps": "浏览应用",
    "init": "生成项目 Agent 说明",
    "archive": "归档任务",
    "delete": "删除任务",
    "agent": "查看子任务",
    "subagents": "查看子任务",
    "theme": "切换主题",
}
NATIVE = {
    "model": "选择模型",
    "reasoning": "推理强度",
    "fast": "服务档位",
    "plan": "计划模式",
    "permissions": "权限范围",
    "memories": "会话记忆",
    "rename": "重命名任务",
    "compact": "压缩上下文",
    "review": "原生代码审查",
    "fork": "分支会话",
    "side": "临时分支会话",
    "goal": "持续目标",
    "stop": "停止后台命令",
    "status": "会话配置与用量",
    "usage": "账号用量限制",
    "diff": "工作区差异",
    "ps": "后台进程",
    "mcp": "MCP 状态与授权",
    "hooks": "生命周期钩子",
    "plugins": "已安装插件能力",
    "feedback": "提交反馈",
}
UNAVAILABLE = {
    "personality": "0.160.0 已弃用该风格切换，不能保证改写现有指令。",
    "approve": "当前未接入可核验的自动审查拒绝事件；请在原客户端处理。",
    "cloud": "当前工作台连接本地常驻执行环境，没有云执行接口。",
    "cloud-environment": "没有云环境选择接口。",
    "ide-context": "浏览器没有连接 IDE 上下文提供器。",
    "ide": "浏览器没有连接 IDE 上下文提供器。",
    "pet": "桌面或终端专属能力。",
    "pets": "桌面或终端专属能力。",
    "worktree": "本版支持会话分支；独立 Git worktree 的创建与生命周期未接入。",
    "task": "Samaya 创建任务必须指定受管工作目录。",
    "mention": "本版未接入文件附件选择；可在正文明确引用工作区路径。",
    "experimental": "不从工作台修改常驻 daemon 的全局实验设置。",
    "import": "迁移外部客户端配置不属于当前会话操作。",
    "logout": "请通过设置页退出 Samaya；不会退出共享 Codex 账号。",
    "app": "当前已在浏览器工作台。",
    "keymap": "终端键位配置不适用于网页。",
    "vim": "终端编辑模式不适用于网页。",
    "raw": "终端滚屏模式不适用于网页。",
    "statusline": "终端状态栏不适用于网页。",
    "title": "终端标题设置不适用于网页。",
    "setup-default-sandbox": "Windows 宿主专属能力。",
    "sandbox-add-read-dir": "Windows 宿主专属能力。",
    "exit": "关闭浏览器不会停止任务。",
    "quit": "关闭浏览器不会停止任务。",
    "debug-config": "完整配置诊断可能包含敏感数据，请在原客户端查看。",
}
ALIASES = {"btw": "side", "clear": "new", "approvals": "permissions"}


def registry():
    rows = [
        {"name": n, "description": d, "kind": "ui", "enabled": True}
        for n, d in UI.items()
    ]
    rows += [
        {"name": n, "description": d, "kind": "native", "enabled": True}
        for n, d in NATIVE.items()
    ]
    rows += [
        {"name": n, "description": d, "kind": "unavailable", "enabled": False}
        for n, d in UNAVAILABLE.items()
    ]
    for name, target in ALIASES.items():
        rows.append(
            {
                **next(r for r in rows if r["name"] == target),
                "name": name,
                "alias": target,
            }
        )
    return sorted(rows, key=lambda r: r["name"])


def field(name, label, options=None, value="", kind="text"):
    return {
        "name": name,
        "label": label,
        "options": options,
        "value": value,
        "type": kind,
    }


def choices(rows, key="id", label="name"):
    return [{"value": r[key], "label": r.get(label) or r[key]} for r in rows]


class CommandService:
    def __init__(self, catalog: InputCatalog, actions):
        self.catalog, self.actions = catalog, actions
        self.connection, self.queries = catalog.connection, catalog.queries

    async def pages(self, method, params=None):
        data, cursor = [], None
        while True:
            r = await self.connection.rpc(
                method, {**(params or {}), "cursor": cursor, "limit": 100}
            )
            data.extend(r.get("data", []))
            cursor = r.get("nextCursor")
            if not cursor:
                return data

    async def context(self, tid, command):
        command = ALIASES.get(command, command)
        if command not in NATIVE:
            raise ValueError(UNAVAILABLE.get(command, "此命令没有原生操作"))
        thread = (await self.queries.read(tid))["thread"]
        cwd = str(self.catalog.config.directory(thread["cwd"]))
        result = {
            "command": command,
            "fields": [],
            "readOnly": False,
            "description": NATIVE[command],
            "data": None,
        }
        rpc = self.connection.rpc
        model = thread.get("model")
        if command in ("model", "reasoning", "fast", "plan"):
            models = await self.pages("model/list")
            current = next((m for m in models if m["model"] == model), None)
            if command == "model":
                result["fields"] = [
                    field(
                        "value",
                        "模型（从下一轮生效）",
                        choices(models, "model", "displayName"),
                        model or "",
                    )
                ]
            elif command == "reasoning":
                if not current:
                    raise ValueError("当前模型不在目录中，无法确定推理强度")
                result["defaultValue"] = current.get("defaultReasoningEffort", "")
                result["fields"] = [
                    field(
                        "value",
                        "推理强度（下一轮）",
                        choices(
                            current.get("supportedReasoningEfforts", []),
                            "reasoningEffort",
                            "description",
                        ),
                        thread.get("reasoningEffort")
                        or current.get("defaultReasoningEffort", ""),
                    )
                ]
            elif command == "fast":
                tiers = (current or {}).get("serviceTiers", [])
                if not tiers:
                    raise ValueError("当前模型目录未提供可切换的服务档位")
                result["fields"] = [
                    field(
                        "value",
                        "服务档位（可能改变用量）",
                        [{"value": "default", "label": "默认"}, *choices(tiers)],
                    )
                ]
            else:
                modes = (await rpc("collaborationMode/list", {}))["data"]
                result["fields"] = [
                    field("value", "协作模式（下一轮）", choices(modes, "mode"), "plan")
                ]
        elif command == "permissions":
            rows = await self.pages("permissionProfile/list", {"cwd": cwd})
            result["fields"] = [
                field(
                    "value",
                    "权限配置（可能扩大文件与网络访问）",
                    choices([r for r in rows if r.get("allowed")], "id", "description"),
                )
            ]
        elif command == "memories":
            result["fields"] = [
                field(
                    "value",
                    "此会话记忆模式",
                    [
                        {"value": "enabled", "label": "启用"},
                        {"value": "disabled", "label": "禁用"},
                    ],
                )
            ]
        elif command == "rename":
            result["fields"] = [
                field("value", "新名称", value=thread.get("name") or "")
            ]
        elif command == "goal":
            result["data"] = await rpc("thread/goal/get", {"threadId": tid})
            goal = result["data"].get("goal") or {}
            result["fields"] = [
                field(
                    "operation",
                    "目标操作",
                    [
                        {"value": a, "label": b}
                        for a, b in [
                            ("set", "设置／编辑"),
                            ("pause", "暂停"),
                            ("resume", "继续"),
                            ("clear", "清除"),
                        ]
                    ],
                ),
                field("objective", "目标", value=goal.get("objective", "")),
                field("tokenBudget", "Token 预算（可留空）", kind="number"),
            ]
        elif command == "review":
            result["fields"] = [
                field(
                    "target",
                    "审查范围",
                    [
                        {"value": "uncommittedChanges", "label": "未提交改动"},
                        {"value": "baseBranch", "label": "与基础分支比较"},
                        {"value": "commit", "label": "指定提交"},
                    ],
                ),
                field("value", "分支名或提交 ID（按范围填写）"),
            ]
        elif command in ("status", "usage", "ps", "hooks", "plugins", "diff"):
            result["readOnly"] = True
            if command == "status":
                result["data"] = {
                    "thread": thread,
                    "rateLimits": await rpc("account/rateLimits/read", {}),
                }
            elif command == "usage":
                result["data"] = await rpc("account/rateLimits/read", {})
            elif command == "ps":
                result["data"] = await self.queries.terminals(tid)
            elif command == "hooks":
                result["data"] = await rpc("hooks/list", {"cwds": [cwd]})
            elif command == "plugins":
                data = await self.catalog.discover(tid)
                result["data"] = {
                    "plugins": sorted(
                        {
                            r["source"]
                            for r in data["references"]
                            if r["source"]
                            not in ("app", "repo", "user", "system", "admin", "local")
                        }
                    ),
                    "notice": "显示当前可发现的插件技能来源；安装与卸载接口仍在开发中。",
                    "errors": data["errors"],
                }
            else:
                result["data"] = await self.diff(cwd)
        elif command == "mcp":
            rows = await self.pages(
                "mcpServerStatus/list", {"detail": "toolsAndAuthOnly"}
            )
            result["data"] = rows
            oauth = [r for r in rows if r.get("authStatus") == "notLoggedIn"]
            result["readOnly"] = not oauth
            if oauth:
                result["fields"] = [
                    field("server", "打开外部授权", choices(oauth, "name"))
                ]
        elif command == "feedback":
            result["fields"] = [
                field("reason", "反馈内容"),
                field("includeLogs", "包含日志（可能含工作内容）", kind="checkbox"),
            ]
            result["description"] = "提交给 OpenAI；仅明确勾选后附带日志"
        elif command in ("compact", "review", "fork", "side", "stop"):
            result["description"] += "；执行前会核对当前轮次"
        result["expectedTurnId"] = (thread.get("turns") or [{}])[-1].get("id")
        result["active"] = bool(active_turn(thread))
        if not result["readOnly"] and thread.get("canAcceptDirectInput") is False:
            raise ValueError("此子任务不接受直接操作，请在所属任务中处理")
        return result

    @staticmethod
    async def diff(cwd):
        async def git(*args):
            proc = await asyncio.create_subprocess_exec(
                "git",
                "-C",
                cwd,
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                out, err = await asyncio.wait_for(proc.communicate(), 10)
            except BaseException:
                proc.kill()
                await proc.wait()
                raise
            if proc.returncode:
                raise ValueError(
                    err.decode(errors="replace")[:500] or "无法读取 Git 差异"
                )
            return out.decode(errors="replace")[:200000]

        return {
            "diff": await git("diff", "--no-ext-diff", "--no-textconv", "HEAD", "--"),
            "untracked": await git("ls-files", "--others", "--exclude-standard"),
            "notice": "工作区差异，不表示所有改动都属于当前任务；长输出最多展示 200 KB。",
        }

    async def execute(self, b):
        tid, cmd = b["threadId"], ALIASES.get(b["command"], b["command"])
        args = b.get("args") or {}
        if not isinstance(args, dict):
            raise ValueError("无效命令参数")  # noqa: TRY004 - definite operation rejection
        context = await self.context(tid, cmd)
        if context["readOnly"]:
            raise ValueError("只读命令不需要执行")
        if b.get("expectedTurnId") != context["expectedTurnId"]:
            raise ValueError("轮次已变化，请重新打开命令")
        for f in context["fields"]:
            if f["options"] is not None and args.get(f["name"]) not in {
                x["value"] for x in f["options"]
            }:
                raise ValueError("选项已变化，请重新选择")
        rpc = self.connection.rpc
        if cmd in ("compact", "review", "fork", "side") and context["active"]:
            raise ValueError("请等待当前轮次结束；此命令未排队")
        if cmd in ("model", "reasoning", "fast", "plan", "permissions"):
            value = args.get("value")
            patch = {"threadId": tid}
            if cmd == "plan":
                thread = (await self.queries.read(tid))["thread"]
                patch["collaborationMode"] = {
                    "mode": value,
                    "settings": {
                        "model": thread["model"],
                        "reasoning_effort": thread.get("reasoningEffort"),
                        "developer_instructions": None,
                    },
                }
            else:
                patch[
                    {
                        "model": "model",
                        "reasoning": "effort",
                        "fast": "serviceTier",
                        "permissions": "permissions",
                    }[cmd]
                ] = None if value == "default" else value
            return await rpc("thread/settings/update", patch)
        if cmd == "memories":
            return await rpc(
                "thread/memoryMode/set", {"threadId": tid, "mode": args["value"]}
            )
        if cmd == "rename":
            name = str(args.get("value", "")).strip()
            if not name or len(name) > 200:
                raise ValueError("名称需为 1–200 字")
            return await rpc("thread/name/set", {"threadId": tid, "name": name})
        if cmd == "compact":
            return await rpc("thread/compact/start", {"threadId": tid})
        if cmd in ("fork", "side"):
            r = await rpc(
                "thread/fork",
                {
                    "threadId": tid,
                    "ephemeral": cmd == "side",
                    "excludeTurns": True,
                    **({"deferGoalContinuation": True} if cmd == "fork" else {}),
                },
            )
            self.actions.store.watch(r["thread"]["id"])
            return {"threadId": r["thread"]["id"], "ephemeral": cmd == "side"}
        if cmd == "review":
            target = {"type": args["target"]}
            if target["type"] != "uncommittedChanges":
                if not str(args.get("value", "")).strip():
                    raise ValueError("请填写基础分支或提交 ID")
                target["branch" if target["type"] == "baseBranch" else "sha"] = args[
                    "value"
                ]
            return await rpc(
                "review/start",
                {"threadId": tid, "target": target, "delivery": "inline"},
            )
        if cmd == "goal":
            op = args["operation"]
            if op == "clear":
                return await rpc("thread/goal/clear", {"threadId": tid})
            params = {"threadId": tid}
            if op == "set":
                objective = str(args.get("objective", "")).strip()
                if not objective:
                    raise ValueError("目标不能为空")
                params["objective"] = objective
                if args.get("tokenBudget") not in (None, ""):
                    budget = int(args["tokenBudget"])
                    if budget <= 0:
                        raise ValueError("预算必须大于零")
                    params["tokenBudget"] = budget
            else:
                params["status"] = "paused" if op == "pause" else "active"
            return await rpc("thread/goal/set", params)
        if cmd == "stop":
            return await rpc("thread/backgroundTerminals/clean", {"threadId": tid})
        if cmd == "mcp":
            return await rpc("mcpServer/oauth/login", {"name": args["server"]})
        if cmd == "feedback":
            reason = str(args.get("reason", "")).strip()
            if not reason:
                raise ValueError("请填写反馈内容")
            return await rpc(
                "feedback/upload",
                {
                    "threadId": tid,
                    "classification": "other",
                    "reason": reason,
                    "includeLogs": args.get("includeLogs") is True,
                },
            )
        raise ValueError("此命令未接入执行")
