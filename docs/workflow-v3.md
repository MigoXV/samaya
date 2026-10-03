# Samaya 日常工作台 v3

本轮先在现有 Figma 文件新增「08 日常工作台 v3」，再实现对应代码。旧设计、v2 交付记录和原有 SDK 集成保留。目标是减少日常任务巡查和继续工作的步骤；本轮不补齐 TUI 的模型、推理强度、计划模式、权限配置、附件和 review 控制。

## 设计与实现

[Figma 最近任务／白垣](https://www.figma.com/design/qaGSrQhakH253tizxKkoae/?node-id=35-5586)、[苍渊](https://www.figma.com/design/qaGSrQhakH253tizxKkoae/?node-id=35-6932)、[当前工作](https://www.figma.com/design/qaGSrQhakH253tizxKkoae/?node-id=35-5952)、[手机详情](https://www.figma.com/design/qaGSrQhakH253tizxKkoae/?node-id=35-6879)。节点清单及原型目标见 [workflow-v3.json](design/workflow-v3.json)。新增 42 个可编辑画板，复用原有变量、按钮、任务行，新增 ActivityRow 的消息、命令、变更与请求变体。包含双主题、390/320px、最近 10/20、待处理、工作／结果、断连、派发、停止、决定发送与确认等流程。所有设计内容均为演示数据，Figma 原型不连接运行时。

代码继续使用 React、TypeScript、Vite 和现有语义 Token；字体栈保留 DengXian／等线及跨平台回退。Figma 使用可用的 Noto Sans SC 回退字体，两套主题共用组件与布局。实际浏览器预览见 [预览目录](design/previews/workflow-v3/README.md)。

- 首页默认最近 **20 个主任务**，可选 10 个并按浏览器保存。先应用项目、搜索与执行筛选，再按 Codex `Thread.updatedAt` 取最近集合；同步时间不参与排序。
- 当前集合保持稳定，收到新活动显示「更新最近任务」，由用户更新。原行仍实时显示实际状态；本轮结束不会立即移走正在查看的对象。网页新建任务直接进入当前集合。
- 置顶仅调整当前集合内的位置；「置顶」视图独立查看更早的置顶任务。全局待处理不受最近数量限制，范围外请求有明确入口。筛选和面板开关不改变后端监控范围。
- 任务默认打开「当前工作」：进展、已确认工具事实、待处理入口、按原生顺序交织的用户要求、回复、命令和文件事件。初始读最近三个轮次，各轮分页加载更早条目；旧轮次继续按需加载。
- 原生用户消息用于「最近要求」；若该消息在尚未加载的历史中，明确提示加载更早记录。`Thread.preview` 只在可展开的「会话摘要与身份」中展示，不称为目标。
- 输入区固定在详情底部；草稿保持可编辑，Ctrl／⌘ + Enter 提交，保护输入法组合输入。运行时「追加到当前轮次」调用已有 `turn/steer`，空闲时「发送」开始新轮次；不提供本地伪队列。
- 「改动与结果」提供本页文件索引、原生文件事件差异、当前连接观察到的轮次汇总差异及回复；没有结构化测试结果时不宣布验证通过，也不把目录所有改动归于任务。
- 审批继续复用原有 RequestForm／MCP 表单，默认显示任务名称及来源，原生 ID 收入详情。答复已发送、请求消除、任务新活动仍分别确认。

主要文件：`MonitorWorkbench.tsx`、`useRecentTasks.ts`、`ExecutionHistory.tsx`、`monitor.ts`、`monitor.css`；后端仅增补原生计划／差异观察及按需读取接口，无新增任务数据库。

## 状态与接口契约

| 界面信息 | 来源与边界 |
| --- | --- |
| 最近集合 | 原生 `Thread.updatedAt`，浏览器保存当前集合和 10/20 偏好 |
| 执行 | 原生会话与轮次状态；连接中断保留最后状态并标记待确认 |
| 当前进展 | 优先错误、原生计划当前步骤、正在执行的工具、最新 AI 阶段说明；AI 说明不是验收结论 |
| 已确认事实 | 可用记录中的命令退出码或已完成文件变更，独立于 AI 说明 |
| 待处理 | 当前连接捕获的原生请求；仍遵循 `live-connection-only` 覆盖范围 |
| 流式记录 | 原生 item ID 合并，重复 SSE 序号忽略；完成事件替换同一条目，不另加第二条回复 |
| 衔接不确定 | 历史与流片段无法可靠对齐时明确标记片段；不盲目拼接并声称完整 |
| 新鲜度 | 原有连接、确认时间、有效进展时间；不把断线当作停止 |

`/api/monitor` 和内存增量补充可选 `plan`：`{explanation, steps:[{step,status}]}`。官方事件 `turn/plan/updated`、`turn/diff/updated` 按 thread／turn ID 校验，旧轮次不能覆盖当前执行状态。

新增 `GET /api/threads/{tid}/turns/{turn_id}/summary` 返回 `{threadId,turnId,plan,diff,observedAt,notice}`。这是当前连接的可丢弃观察：最多 100 组、总量 8MB；断连清空，未观察到／被淘汰时明确不可用。完整 diff 不进入全局 monitor 快照、monitor 增量或持久化事件日志；对应事件只发身份通知。文件事件和历史分页仍是降级来源，不通过内部历史文件或数据库恢复差异。

SDK／runtime 继续锁定 **0.160.0**。已核对实际安装 SDK 的 `TurnPlanUpdatedNotification`、`TurnDiffUpdatedNotification` 和 [官方 app-server 文档](https://learn.chatgpt.com/docs/app-server)，不以网页设计稿版本号推断支持能力。

## 本次验证结果

2026-10-03；原始数据见 [verification/workflow-v3](design/verification/workflow-v3/)。

| 验证 | 结果 |
| --- | --- |
| `poetry install --sync` | 锁定环境安装成功，无需更新依赖 |
| `poetry run pytest -q` | 45 通过；依赖层有 1 条 Starlette/httpx 弃用提示 |
| `poetry run ruff check src/samaya tests scripts` | 通过 |
| 前端 lint、typecheck | 通过，无警告 |
| `pnpm --dir src/web run build --outDir /tmp/samaya-v3-dist` | 通过；使用标准构建脚本和隔离输出目录 |
| `node --test tests/mcp-schema.test.mjs` | 3 通过 |
| `test:monitor` | 派发、追加、停止、跨标签页请求失效、12 种失败／恢复状态、双主题无障碍通过 |
| `test:workflow` | 3 项目、32 主任务；最近范围、范围外请求、置顶、稳定排序、手动更新、范围外详情、筛选后取最近、IME、重复事件、流式替换、草稿／刷新均通过 |
| 1440×900 / 1366×768 | 首屏 11 / 8 个常规行 |
| 390 / 320px | 无横向溢出，详情底部输入和操作可见 |
| 两主题对比度 | 11 处文本采样最低 5.01:1；4 处控件边界最低 3.17:1；axe 无违规 |
| 性能 | 1000 主任务、60.1 秒、6000 原生模拟事件及 240 组增量；选区及列表滚动保持，键盘帧延迟 P95 60ms，输入 P95 15.5ms，最长观测长任务 77ms |
| 长日志 | 181005 字符，10 秒、1000 条更新；选区及局部滚动保留，无页面溢出 |
| 真实只读浏览器 | 连接现有 daemon；547 条记录全部完成核对、28 条父子关联；原生历史可读、刷新恢复选中；0 次操作提交、0 个页面错误 |
| 工程托管 | 首页、真实静态资源、HTML 导航的 SPA 深层路由 200；未知 API／缺失静态资源为 JSON 404；缺少构建产物的明确错误及 VS Code 配置由现有工程测试覆盖 |

浏览器核心回归同时在 **FastAPI 托管的隔离产物**上通过，不以开发服务器替代正式托管验收。压力指标为这台机器上的模拟事件测试，不是互联网端到端时延保证。未派发、停止、归档或删除用户真实任务；操作流程以拦截全部 API 的独立 fixture 验证。既有真实能力验证仍见 [能力矩阵](capabilities.md) 与 [原验收记录](verification.md)，本轮没有重新执行这些破坏性测试。

## 更新与复现

本次仅完成工程交付和隔离验证。原 **8765** 进程及原 `src/web/dist` 保持原样，未发布生产入口。切换版本时先关闭旧 Samaya HTTP 服务，再构建、启动同版本；**不要关闭 Codex daemon**。

```bash
cd /workspace/apps/samaya
# 使用原有管理方式关闭旧 Samaya HTTP 服务，然后：
poetry install
pnpm --dir src/web install --frozen-lockfile
pnpm --dir src/web run build
poetry run samaya serve --host 127.0.0.1 --port 8765
```

仅本地转发时把本地端口转发到服务器 8765，浏览器同源访问所有 API。默认 host 仍为 `0.0.0.0`；直接远程监听时沿用 `.env` 的 `SAMAYA_TOKEN`、原数据目录、端口及访问边界，不需要换 Codex 凭据。

复现隔离验收，不覆盖原静态目录、不重启原服务：

```bash
pnpm --dir src/web run build --outDir /tmp/samaya-v3-dist
poetry run python -c 'from pathlib import Path; import uvicorn; from samaya.config import Settings; from samaya.web.app import create_app; uvicorn.run(create_app(Settings(data_dir=Path("/tmp/samaya-v3-state"), dist=Path("/tmp/samaya-v3-dist"), token="")), host="127.0.0.1", port=8772)'
# 在另一个终端执行：
SAMAYA_UI_TEST_URL=http://127.0.0.1:8772 pnpm --dir src/web run test:monitor
SAMAYA_UI_TEST_URL=http://127.0.0.1:8772 pnpm --dir src/web run test:workflow
SAMAYA_UI_TEST_URL=http://127.0.0.1:8772 pnpm --dir src/web run test:monitor:performance
SAMAYA_UI_TEST_URL=http://127.0.0.1:8772 pnpm --dir src/web run test:monitor:logs
SAMAYA_RUNTIME_TEST_URL=http://127.0.0.1:8772 pnpm --dir src/web run test:monitor:readonly
```

隔离实例仍连接真实 daemon 做只读监控；前四个浏览器测试全部拦截 API，不会把演示操作送到 Codex。最后一个只读测试不提交操作。测试结束关闭自己启动的隔离 HTTP 实例。

## 尚未验证或未提供

- 新增计划／汇总差异已验证 SDK 类型和协议 fixture；本轮未人为派发真实任务触发两种事件，因此不把它们记为新的真实写入验收。
- 断连后不能保证重建此前未收到的审批／MCP 请求；保留真实等待／未知状态。计划与汇总差异也不保证跨 Python 重启恢复。
- 流片段与已保存历史缺少可靠偏移时可能存在衔接缺口，界面明确标识；不承诺无损恢复所有 token。
- 最近要求、已确认事实、文件索引受已加载分页／最近汇总范围限制；需要更早记录时手动加载。原生计划步骤不换算百分比或剩余时间。
- 未实测实体手机软键盘、辅助技术人工操作或上万任务；390/320px 是真实 Chromium 渲染和键盘测试。
- 不新增暂停、可靠队列、撤销目录改动、智能摘要服务或 TUI 全部配置面板。
