# Codex 能力核查

核查日期：2026-10-03。实际安装 `openai-codex==0.160.0`，其依赖 runtime 包 `openai-codex-cli-bin==0.160.0`；实际连接的是服务器已有的 Codex app-server **0.160.0**。以已安装 SDK 源码、该 runtime 导出的 JSON Schema 和实测为准。

参考：[官方 Python SDK 文档](https://learn.chatgpt.com/docs/codex-sdk)、[官方 app-server 文档](https://learn.chatgpt.com/docs/app-server)。在线文档与本机实验接口存在差异，例如本机的 paginated history 已可读取；不能只依据在线方法名称判断。

| 能力 | 结论 | 核查方式与边界 |
| --- | --- | --- |
| 连接已有常驻 app-server | 已经验证；SDK 未覆盖外部 socket transport | Unix WebSocket initialize；两客户端列出的已加载会话一致。SDK `codex_bin` 不是连接地址。使用公开 `launch_args_override` 启动 JSONL ↔ Unix WebSocket 桥接进程。 |
| 列举、读取、恢复会话 | 已经验证 | SDK list/resume；原始 read 保留 SDK 模型尚未覆盖的字段。读取既有历史并继续测试会话。列表显式包含全部 sourceKinds，否则服务端默认仅列交互来源。 |
| 已加载会话与运行状态 | 已经验证 | `thread/loaded/list`、read/list 的 status、turn.status，未连接时不据旧快照判断已停止。 |
| 流式消息、工具与输出 | 已经验证 | SDK 全局通知队列接收桥接保留的官方事件；真实浏览器显示命令与流式文本。 |
| 审批、用户输入 | 已经验证；SDK 异步网页审批接口未覆盖 | 真实命令审批、plan 模式 requestUserInput 都由浏览器完成。桥接阻断 SDK 的默认自动接受处理。权限请求的 turn scope 结构已适配，尚未实测；MCP 标准输入另见下行；动态工具执行请求未适配。 |
| MCP 对话交互 | 已经验证；SDK 高层未覆盖 | 真实工具调用审批、标准 form 输入、URL 流程接受、独立于轮次的拒绝／取消；浏览器刷新和多页面同步、断连后旧请求拒绝。进度事件已适配但尚未实测；扩展表单、加密身份验证和嵌入式 App UI 未实现。 |
| 主会话／子智能体关系 | 已经验证（已有会话只读） | parentThreadId 与 `source.subAgent.thread_spawn.parent_thread_id` 兼容；ancestorThreadId 查询与已知子会话一致。forkedFromId 不当成父子关系。未为测试额外调度新子智能体。 |
| 中断轮次 | 已经验证 | 指定 threadId + turnId；测试目标停止，另一测试会话仍 active 且 turnId 不变。旧轮次 ID 拒绝。 |
| 后台命令查看、定向终止 | 已经验证；SDK 高层未覆盖 | 两个真实 sleep 命令，终止一个后另一个仍在列表；回合结束后仍可见。只使用服务端 processId，不按 OS PID 猜测。当前版本 osPid/CPU/RSS 常为 null，不显示这些指标。 |
| 归档、恢复、删除 | 已经验证（专用测试目标） | 浏览器批量归档一成功一失败；恢复后可列出；删除后目标消失。协议支持连带后代，预览展示整个范围并逐个检查；含真实后代的破坏性级联尚未实测。 |
| 同一对话切换工作区 | 已经验证 | `thread/settings/update.cwd` 改变后续默认目录；同 ID resume 返回新 cwd 与 runtimeWorkspaceRoots。下一轮实际 pwd、新 AGENTS 标记正确，且没有要求模型读文件。历史保留。 |
| 浏览器断开后任务继续 | 已经验证 | 网页发送真实 sleep 任务，刷新显示同轮次运行，关闭浏览器后继续。 |
| Python 服务重启后任务继续 | 已经验证（本机常驻服务） | SIGTERM 关闭 Samaya，重新启动后读到同一 turnId active，最终完成。没有重启／停止常驻 app-server。**不承诺 app-server 自身重启能继续进程或轮次。** |
| 多客户端、重连与恢复 | 已经验证；服务端事件重放尚未验证 | 两客户端读取同一会话；杀掉 Samaya 桥接进程后经历 disconnected/reconnecting/connected。依靠重新订阅与历史快照恢复；SQLite 仅重放 Samaya 已收到事件，不代表 Codex 全量事件重放。 |
| 重复提交防护 | 已经验证 | 同操作 ID 重发返回同一回执和 turnId；浏览器断开不取消 HTTP 已交付操作；重启时未完成回执改为 uncertain，不自动重发。 |

## SDK 适配边界

`src/samaya/codex/adapter.py` 是唯一访问 `AsyncCodex._client` 的位置。0.160.0 的高层对象没有公开原始请求入口、外部连接注入和异步网页审批钩子。桥接通过 `CodexConfig.launch_args_override` 接入现有服务；未使用模拟按键、TUI 文本或内部数据文件。

优先使用 SDK 的 thread_start/list/resume/archive/unarchive，以及 SDK client 的 turn_start/turn_interrupt/thread_set_name。对 read 使用保留额外字段的模型；已安装 SDK 缺少的 settings、loaded、ancestor、backgroundTerminals、delete 和审批回复均在集成层适配官方协议。

桥接将通知包装为 `samaya/event`，以免 SDK 的事件路由丢失新字段；真实服务端请求也包装为通知，避免进入 SDK 默认自动审批回调。网页响应经 `samaya/serverRequest/respond` 转回原始请求 ID。每次连接具有独立随机请求命名空间，旧页面不能误答新连接的请求。

## 工作区切换语义

- 空闲时才允许切换；运行时先明确停止本轮，待实际状态空闲后再切换。接口也会检查，不仅依赖按钮禁用。
- 改变的是**会话后续轮次默认 cwd**及运行工作区根；不是单个命令的 `cd`，也不是创建新会话。
- settings 更新响应为空；立即 read 偶尔仍返回旧元数据。因此使用同 ID 的 resume 返回值核对实际 cwd。这里 resume 用于读取并重新加入已加载会话，不是卸载会话重建。
- `instructionSources` 在切换后、下一轮开始前可能仍显示旧来源。已实测下一轮自动加载新目录的 AGENTS.md。返回字段命名为 `instructionSourcesBeforeNextTurn`，不能把它当作已重新加载的证明。
- 模型、审批策略和权限配置延续已有会话设置；切换目录**不承诺重新应用目标项目所有 `.codex/config.toml` 配置**。既有 workspace-write 根的实际执行由 runtime 处理；命名权限配置和跨远程环境切换未验证。
- 旧命令的 cwd 保持原值，可在后台命令详情中检查。不会顺手清理后台命令。
- 首次运行前的新空会话存在本机 runtime 的 `missing source rollout` 边界；只在无 preview、确认新空会话条件下允许元数据回退，不把旧历史错误吞成空记录。

## 数据与一致性

Codex 是 thread、turn、命令及审批状态的权威。Samaya SQLite 保存操作回执、已查看会话 ID 和最近 10,000 条收到的事件，不维护第二套任务引擎。浏览器保存当前导航与未确认操作编号，不保存 Codex 凭据。

每个 Samaya 进程保留一个 SDK 连接，后台读取通知。网页只维护一个 SSE 连接，切换会话清理视图输出并按 threadId 过滤；后端已加入的会话订阅继续保留，以便收集后台结果。关闭网页不调用 turn/interrupt 或 thread/unsubscribe。部署仅支持一个 Python worker。

Samaya 页面间通过持久化操作 ID、会话锁和提交前的最新 turnId 检查减少冲突；Codex 的其他客户端不受这些锁约束，协议没有原子条件清理接口。会话清理逐个核查范围、活动轮次与后台命令后执行，但无法承诺消除外部客户端在最后一次检查后的竞争。请避免同时从 CLI 与网页清理同一组会话。

断线后的增量输出可能缺失，恢复以 read 快照为准。待审批请求不保证服务端重放；断线时未恢复的请求需在原 Codex 客户端处理或明确中断轮次。未适配请求不会被自动放行。

## MCP 适配边界

`mcpServer/elicitation/request` 由同一个常驻 SDK 连接处理，响应 `{action, content}` 经现有桥接返回。未新增执行 MCP 工具的业务引擎或服务管理 API。`POST /api/operations` 的 `respond` 复用原操作编号；`GET /api/threads/{id}` 增加 `pendingRequests[].mcp` 展示联合类型（form/url/unsupported）、`responseState` 与 `toolProgress`。

标准表单 Schema 真源为安装的 0.160.0 runtime 导出的 `McpServerElicitationRequestParams.json` definitions，快照在 `src/samaya/decisions/mcp_form_schema.json`；`jsonschema[format-nongpl]==4.26.0` 执行服务端类型、边界和格式校验。仅支持标准类型，不加载远程 Schema 引用。不声明 OpenAI 扩展表单能力；未知模式可拒绝／取消，不伪造加密验证。Codex 实际也用空 form 加 `_meta.codex_approval_kind=mcp_tool_call` 发起工具审批，界面以“允许本次”区分。

请求身份包含连接代次及原始 ID 类型；MCP 请求不随轮次结束清除，支持 `turnId: null`。同 ID 重复事件保留原有提交状态。服务端 resolved 通知或确定的响应提交会清除请求；响应丢失后保留 uncertain，后端拒绝再次响应。浏览器刷新读取内存快照；Python／桥接重连后的旧请求不能重放。

表单草稿不持久化。MCP 请求通知在 Samaya 事件日志中只记录 threadId 变更提示，授权 URL 与默认值通过已认证、no-store 的快照提供；操作回执不保存答案正文。工具自己返回的内容仍属于 Codex 会话历史，可能包含其回显的输入。URL 限制为无嵌入凭据的 HTTP(S)，不自动打开，以 no-referrer 新页面展示；接受请求不等于授权完成。

## v2 监控补充（2026-10-03）

此轮只读连接同一 0.160.0 daemon，未向用户任务提交执行或清理操作。详细实现和验收见 [多任务改版](monitor-v2.md)。

| 能力 | 当前结论 | 证据与边界 |
| --- | --- | --- |
| 全未归档目录 + 已加载临时会话 | 已验证 | 547 条原生会话全部核对，28 条父子链接；与前端筛选无关 |
| `thread/turns/list`、`thread/items/list` | 已验证，存在逐会话差异 | 1 条旧会话不支持条目分页，通过官方完整历史恢复；没有读取内部数据库 |
| 增量汇总、断连快照、重复 / 旧轮次保护 | 已验证（协议及浏览器测试） | 内存汇总，不提供服务端全历史事件重放保证 |
| 当前轮次 `turn/steer` | SDK 签名及协议夹具已验证；真实执行尚未验证 | SDK 低层异步客户端可调用，网页校验 expectedTurnId；不代表排队 |
| 请求发送后确认 | 传输与状态边界已验证 | bridge 的 sent 只证明发送；等待原生 resolved，不能本地点击后立即删除请求 |
| 完整待请求枚举 | 尚未验证 / 未找到可靠入口 | 活跃标志没有正文时显示请求待恢复；不构造假表单 |
| v2 的真实审批、停止、清理、追加 | 本轮未重跑 | 保留先前 v1 实测记录，v2 写路径使用隔离夹具，不混同真实执行验收 |
