# 验收记录

日期：2026-10-03。环境：Python 3.10.18、Poetry 2.2.1、Node 24.18.0、pnpm 11.24.0、SDK / daemon 0.160.0。Git 工作分支 `feature/samaya`；初始化提交 `701ac3c`。

## 实际执行结果

| 验收项 | 结果与证据 |
| --- | --- |
| 新建与真实任务 | 创建 `Samaya 验收 · 可删除 A`，真实 exec_command 执行 pwd，任务 completed。 |
| 历史与继续 | 同 ID 读取多轮历史并继续；最终改用 SDK client.turn_start 后仍成功完成 `SAMAYA_SDK_FINAL_OK`。 |
| 浏览器刷新／关闭 | 浏览器发送 sleep 60，刷新仍显示“停止本轮”；关闭浏览器后任务继续。 |
| Python 重启 | Samaya 接收 SIGTERM 并重新启动，同一 turnId 仍 inProgress，最终 completed，输出 `SAMAYA_RESTART_OK`。 |
| 定向中断 | 目标测试轮次被中断；另一测试会话前后都是 active，turnId 不变。 |
| 后台命令 | 模型启动 sleep 240 / 241 两个命令。终止一个后另一个仍在列表；随后分别清理测试命令。 |
| 主子关系 | 对用户已有子会话只读核查，source 父 ID 与服务端 ancestor 查询一致。没有对既有会话做破坏性测试。 |
| 归档／恢复／删除 | 真实浏览器一次批量操作：空闲测试会话成功，运行对象失败，界面显示成功 1 / 2。恢复后重新列出，删除后不存在。 |
| 归档历史 | 初测发现 resume 归档对象报错；修复为返回只读历史和订阅提示。再次归档测试会话确认历史可读，再恢复并继续真实任务。 |
| 切换工作区 | A/B 专用目录分别有 SAMAYA_ALPHA / SAMAYA_BETA 指令。同 ID 切换后实际 pwd 正确。再次切回 A，要求只执行 pwd、不要读文件，最终仍自动带 SAMAYA_ALPHA。 |
| 旧命令目录 | 工作区切换到 B 时，已启动 sleep 的 cwd 仍为 A；进程继续运行。 |
| 重复提交 | 相同操作 ID、相同消息重发得到相同回执与同一 turnId。 |
| 断线重连 | 仅终止 Samaya 自己的桥接子进程；观察到 disconnected → reconnecting → connected，代数增加；未重启 Codex daemon。 |
| 审批 | untrusted 策略下出现真实命令审批，Playwright 通过网页点击“允许本次”，命令继续执行。 |
| 用户输入 | plan 模式发起真实 requestUserInput，窄屏网页选择 Small 并提交，待输入状态消失。 |

机器可读摘要：[acceptance-results.json](acceptance-results.json)。完整测试日志、真实页面截图和 fixture ID 放在 Git 忽略的 `.samaya/acceptance`、`.samaya/screenshots`；这些是本机验收产物，不作为产品数据源。

## 工程命令

均在项目根目录执行，Python 通过 Poetry 环境。

| 命令 | 结果 |
| --- | --- |
| `poetry env use python3.10` / `poetry install` | 成功 |
| `poetry check` | 成功；Poetry 提示 `[tool.poetry.scripts]` 的弃用警告，按所要求技能保留该入口格式 |
| `poetry run samaya doctor` | 连接现有 daemon 并读取已加载会话 |
| `poetry run pytest -q` | 33 passed（含 MCP 增量测试）；Starlette 对 httpx 测试客户端有一条第三方弃用警告 |
| `poetry run ruff check src/samaya tests scripts` | 通过 |
| `pnpm --dir src/web install --frozen-lockfile` | 通过 |
| `pnpm --dir src/web run lint` | 通过 |
| `pnpm --dir src/web run typecheck` | 通过 |
| `pnpm --dir src/web run build` | 通过；dist/index.html 与带 hash 的 JS/CSS 已产生 |
| `poetry run samaya serve --port 8765` | 实际启动 FastAPI 托管页面并完成真实验收 |

12 项自动化风险测试覆盖：SDK 桥接不自动批准服务端请求、HTTP 取消不取消提交、同 ID 不重复执行、重启未完成回执转 uncertain、旧轮次中断不触及其他轮次、重复实例锁、创建后附加设置失败保留会话身份、归档历史只读、目录符号链接逃逸、身份验证／CSRF／Origin／Host、SPA／API／实际与缺失静态资源、缺失构建产物的明确错误、VS Code 配置对应关系（部分场景合并在同一测试）。

## 浏览器与界面

使用 Playwright Chromium 实际访问 FastAPI，桌面 1440×960 和窄屏 390×844；会话整理和设置页也完成浏览器渲染。没有用 mock API 作为产品验收依据。

- `src/web/tests/browser.mjs`：真实历史、桌面／窄屏截图、无页面脚本异常、无整页横向溢出；工作区对话框 Escape 关闭后焦点回到“切换工作区”。
- `approval.mjs`、`input.mjs`、`recovery.mjs`、`cleanup.mjs`：对应上表的真实浏览器操作。
- `accessibility.mjs`：工作台、长目录输入对话框、窄屏会话管理与设置页，axe WCAG 2 A/AA 与 2.1 AA 检查没有违规；导航 Escape 后焦点回到“项目与会话”。自动扫描不能替代完整人工无障碍认证。
- 检查长会话标题、长目录、真实长 shell 命令、pre 输出和 Markdown 代码；折叠命令只占一行，展开后可换行／滚动。输入与按钮有 hover、focus、disabled；选择有 aria-current／checkbox，错误有文字，状态不只靠颜色。
- 使用实际计算样式复核前景与其祖先背景；选中行次文字已改用 text-primary，避免 text-secondary / selected 的 4.37:1 不合格组合。

| 实际组合 | 对比度 |
| --- | --- |
| 主按钮石素文字 / 墨骨背景 | 13.56:1 |
| 选中会话标题与状态 / selected | 11.82:1 |
| 路径／次文字 / 页面背景 | 5.02:1 |
| 输入区次文字 / surface | 5.20:1 |
| 品牌文字 / 导航背景 | 12.87:1 |

原始扫描摘要：[accessibility-results.json](accessibility-results.json)。焦点描边映射到 accent-strong，颜色值不另造。

## 重跑真实测试

这些脚本会产生模型用量，只操作自己创建的 fixture；从项目根目录运行。服务必须先以 8765 端口启动，使用本机回环认证。顺序如下：

```bash
poetry run python scripts/verify_live.py
poetry run python scripts/acceptance_api.py
pnpm --dir src/web exec node tests/approval.mjs
poetry run python scripts/request_input.py
pnpm --dir src/web exec node tests/input.mjs
pnpm --dir src/web exec node tests/recovery.mjs
poetry run python scripts/interrupt_check.py
# 此时可停止并重新启动自己的 Samaya 进程；不要停止 Codex daemon。
poetry run python scripts/prepare_cleanup.py
pnpm --dir src/web exec node tests/cleanup.mjs
poetry run python scripts/finish_acceptance.py
poetry run python scripts/final_live_check.py
pnpm --dir src/web run test:browser
pnpm --dir src/web exec node tests/accessibility.mjs
```

并非每次都需全量运行。审批和模型行为具有非确定性；脚本明确等待真实请求，未出现时不能将该项当作通过。`finish_acceptance.py` 会删除自己创建的“后台命令与审批”fixture，不删除用户已有记录。其余带“Samaya 验收”名称的专用会话保留为可复核证据，可以在网页内自行归档／删除。

## 未验证项

完整边界见 [能力矩阵](capabilities.md)。特别包括：含真实新建子智能体的级联归档／删除、app-server 自身重启、服务端完整事件重放、命名权限与远程环境、MCP 扩展模式／动态工具请求、所有浏览器与屏幕阅读器的兼容性。第一版没有自动删除记录或后台命令“停止全部”。

## MCP 增量验收

先补充 [Figma MCP 交互](https://www.figma.com/design/qaGSrQhakH253tizxKkoae?node-id=4-43)，读取 design context 后实现。机器可读结果见 [mcp-results.json](mcp-results.json)。

- 真实 Codex 轮次调用线程专用 stdio MCP 服务；网页先允许工具调用，再填写标准表单，收到 `MCP_REAL_RESULT` 并完成轮次。`0`、`false` 和多选值在服务端回执中保持原类型。
- 刷新后恢复同一待处理请求；第二浏览器页面同步移除已处理表单；每次工具调用只产生一次业务响应。输入错误后键盘焦点回到首个错误字段。
- 另一轮真实调用完成 URL 流程：打开本地授权页后 Samaya 仍显示待处理，完成页面操作并“同意继续”后工具返回 authorized=true。此项验证协议流程，不代表已测试第三方 OAuth。
- 独立 `mcpServer/tool/call` 产生 `turnId=null` 的真实请求，分别拒绝与取消成功；重复操作 ID 返回相同回执。
- 仅关闭测试客户端的 SDK 桥接；重新连接后旧 requestKey 被拒绝，记录显示 3 次指定工具调用，没有第 4 次重放。
- 桌面 1440×960、窄屏 390×844：页面无脚本异常，无整页横向溢出；表单和 URL 面板 axe WCAG A/AA 检查均零违规。截图保存在 `.samaya/screenshots/mcp-*.png`。
- MCP 工具 progress 事件有协议 Schema 和实现，但本次服务未收到该通知；不将普通工具状态当作已验证流式进度。扩展 form、加密验证、第三方 OAuth、所有辅助技术兼容性尚未验证。

增量复现（会创建专用会话并调用真实模型）：

```bash
# 终端一：FastAPI 测试工作台 8766，本地测试授权页 8767
poetry run python scripts/verify_mcp_live.py
# 等待输出 FIXTURE / SEND 后，在终端二运行真实浏览器操作
pnpm --dir src/web exec node tests/mcp-live.mjs
# 结束专用 HTTP 测试服务，不终止 Codex daemon
touch .samaya/acceptance/mcp/finish
# 独立请求拒绝／取消、幂等与桥接重连
poetry run python scripts/verify_mcp_responses.py
# 无模型测试
poetry run pytest -q
pnpm --dir src/web exec node --test tests/mcp-schema.test.mjs
```

专用 MCP 配置仅通过 `thread/start.config` 注入测试线程，未写用户全局 MCP 配置。测试会话保留用于核对，可按结果中的明确 ID 手动归档；未删除用户已有记录。

## 双主题增量验收（2026-10-03）

先补齐 Figma 白垣／苍渊变量模式、页面与 ThemeSelect 组件，再同步到代码。设计稿保留在线上 Figma，浏览器结果见 [theme-results.json](theme-results.json)。

- 本次创建专用会话 `01a100c4-2846-7502-9c41-050a6187040d`，真实 Codex 执行 `pwd`，轮次完成并返回 `SAMAYA_THEME_READY`；主题浏览器检查从该真实历史开始。旧验收记录中的会话 ID 本次服务端已无法读取，因此没有把过期记录当作通过依据。
- 首次访问即使系统为深色也默认白垣；选择苍渊后刷新保留；同源两标签页同步；“跟随系统”响应系统变化，显式选择不受系统变化影响。无效保存值回落白垣。
- 阻止 React bundle 加载，确认根节点尚未渲染时 `data-theme` 和浏览器 theme-color 已应用苍渊。沿用同源外部脚本与原有 CSP，不加入内联脚本豁免。
- 切换前后消息输入框、已打开工作区弹窗和 MCP 字段保持同一 DOM 节点及输入值；没有新增操作请求或 SSE 连接。关闭弹窗后焦点返回触发按钮。
- MCP form／URL 等待状态、字段错误、长名称与长输出使用浏览器受控数据；用于验证主题和输入状态，不代表本次重新完成了真实 MCP 授权。实际 MCP 协议验收见上节。
- 浏览器禁止写入主题偏好时，登录页仍可切换并显示“仅本页生效”。
- Chromium 桌面 1440×960、窄屏 390×844；15 组 WCAG A/AA axe 检查零违规，页面无脚本异常、无整页横向溢出。覆盖工作台、会话管理、设置、登录、弹窗、主按钮 hover、选择／禁用状态、MCP 错误与 URL 控件。
- 长日志检查发现 MCP 滚动输出无法通过键盘聚焦，已为参数、资源文本和结构化结果补上焦点入口；验证聚焦后方向键可滚动。

实际 computed style 的文本对比度抽样（并非只核对 Token 名称）：

| 前景／背景 | 白垣 | 苍渊 |
| --- | --- | --- |
| 主题标签／侧栏 | 4.76:1 | 9.41:1 |
| 当前目录／页面 | 5.02:1 | 9.69:1 |
| 选中会话标题／选中背景 | 11.82:1 | 12.34:1 |
| 主按钮文字／按钮背景 | 13.56:1 | 10.82:1 |
| 输入文字／输入背景 | 14.06:1 | 15.26:1 |

工程检查：`poetry run pytest -q`（33 通过；1 条现有 Starlette/httpx 弃用提示）、`poetry run ruff check src/samaya tests scripts`、前端 lint、TypeScript/Vite build，以及 MCP Schema 3 项测试通过。主题 Token 真源保持原样，没有增加运行依赖。之前要求的默认监听地址 `0.0.0.0` 已保留，远程监听仍需配置访问口令。

复现本次主题验证（先构建前端；一次准备脚本会创建专用会话并调用模型；浏览器脚本只读取真实历史并运行受控界面检查）：

```bash
# 终端一：验收脚本使用无口令的回环服务；不要复用生产访问配置
SAMAYA_TOKEN= poetry run samaya serve --host 127.0.0.1 --port 8765
# 终端二：从项目根目录运行；准备成功后保留生成的会话 ID
poetry run python scripts/prepare_theme_check.py
pnpm --dir src/web exec node tests/themes.mjs
```

可用 `SAMAYA_TEST_URL` 指定验收地址；已存在这次主题 fixture 时无需再次准备，可用 `SAMAYA_THEME_THREAD` 指定已完成且包含验收标记的会话 ID。截图保存在 `.samaya/screenshots/theme-*.png`。脚本不自动删除记录，不重新提交结果不确定的操作。

本次外观验收使用 Chromium，尚未覆盖 Safari、Firefox、操作系统高对比模式或全部屏幕阅读器组合；不把 axe 零违规等同于全部无障碍场景均已验证。偏好只保存在同源浏览器中，不提供跨设备同步。
