# Samaya 阅读工作区 v4

本轮在 `feature/reading-workspace-v4` 分批实现。设计、前端和真实运行时验证分别记录；没有更改后端协议或任务状态引擎。

## 设计与代码

在原文件新增 [09 阅读工作区 v4](https://www.figma.com/design/qaGSrQhakH253tizxKkoae/?node-id=52-2600)，保留 v3。双主题工作态、专注、窄屏、总览及决策/停止流程使用既有 Semantic 变量、Button、ActivityRow；设计内容是明确标记的演示数据，不连接运行时。核心节点、原型目标及状态契约见 [设计契约](design/reading-workspace-v4/README.md)。

前端继续 React / TypeScript / Vite；双主题共用 DOM 和布局，等线优先字体栈保持。主要变化：

- 总览的最近数量、更新与范围外请求进入筛选行；不再独占第三条横栏。
- 打开任务后变为 304px 任务侧栏与完整工作区；专注只收起侧栏，不重新挂载阅读区或创建事件订阅。
- 页头 88px，默认输入区约 105px；正文默认最大 960px，可切换宽阅读，代码和差异使用更宽空间。
- 完整目录、切换目录、同步时间和状态依据进入工作区详情。手机也可点击执行状态打开。
- 删除重复“最近要求”和常驻原始命令摘要；用户要求只在对话中出现一次。列表清理 Markdown 标记，完整回复仍按 Markdown 渲染。
- 命令默认折叠，仅呈现执行情况和退出码；展开查看完整命令、启动目录及输出。非零退出码不等于任务失败，退出码 0 不等于全部测试通过。
- 输入自适应高度，可展开编辑；无执行轮次时不显示停止按钮。保留草稿、IME、操作身份和不确定回执机制。
- 切回任务恢复阅读位置，命令展开状态按 item ID 保留。页内缓存最近 24 组已加载历史分页，仍从后端核对；它不是第二套执行状态来源。
- 最近 10/20 限制历史显示，不限制 `useMonitor` 的全局监控。“查看全部活动任务”包含较早的运行轮次、后台命令和活跃子任务；待处理入口始终使用全局请求。

主要实现文件：`MonitorWorkbench.tsx`、`ReadingSurface.tsx`、`ExecutionHistory.tsx`、`components.tsx`、`monitor.ts` 和 `monitor.css`。

## 实测结果

2026-10-03，本机 Chromium。原始摘要见 [验证数据](design/verification/reading-workspace-v4/)。

| 验证 | 结果 |
| --- | --- |
| 1440×900、1366×900，双主题工作/专注 | 阅读窗口均 707px；旧版同机基线 346.125px |
| 总览 1440×900 / 1366×768 | 首屏 12 / 9 个常规任务行 |
| 1024、390、320px | 实际浏览器渲染；侧栏抽屉/返回、无横向溢出、输入区可见 |
| 390×480 缩减视口 | 模拟键盘占用后的短/长草稿、展开编辑仍保留操作区 |
| 阅读稳定 | 专注前后同一 DOM/订阅；切换任务的草稿与滚动恢复；消息不重复 |
| 无障碍 | 双主题 axe 无违规；修复长代码滚动区的键盘访问、对话框焦点返回 |
| 实测对比度 | 11 类文本最低 4.76:1，3 类关键控件边界最低 3.01:1 |
| 常规交互回归 | 派发、追加、停止、审批、跨页请求失效、批量部分失败及 12 种失败/恢复情形通过；API 全部拦截，不提交真实任务 |
| 全局显示范围 | 64 个演示任务验证最近 20 条之外的活动可访问，筛选不停止监控 |
| 高频事件 | 1000 个演示任务、60.1 秒、6000 条原始事件与 240 组增量；选区、列表滚动、草稿保持；阶段摘要呈现 P95 54.1ms，输入 P95 14.6ms，最长长任务 84ms |
| 长日志 | 181005 字符、10 秒、1000 条更新；选区和局部滚动保持，无页面溢出 |
| 真实只读浏览器 | 独立 FastAPI 实例连接现有 daemon，549 条记录、25 条父子关联；历史可读、刷新恢复选中，0 次操作提交、0 个页面错误。采样时 545 条已核对，其余保持未知，不伪装全量成功 |
| Python | `poetry run pytest -q`：47 通过；1 条已有 Starlette/httpx 弃用提示；ruff 通过 |
| 前端 | lint、typecheck、build 通过；MCP Schema 3 项测试通过 |

核心 `test:monitor`、`test:workflow`、`test:reading` 也在 **FastAPI 托管的隔离构建产物**上运行通过。性能数字是此环境的模拟负载测量，不是互联网端到端保证。

## 复现

```bash
poetry run pytest -q
poetry run ruff check src/samaya tests scripts
pnpm --dir src/web run lint
pnpm --dir src/web run typecheck
pnpm --dir src/web exec node --test tests/mcp-schema.test.mjs
pnpm --dir src/web run build --outDir /tmp/samaya-v4-dist
poetry run python -c 'from pathlib import Path; import uvicorn; from samaya.config import Settings; from samaya.web.app import create_app; uvicorn.run(create_app(Settings(data_dir=Path("/tmp/samaya-v4-state"), dist=Path("/tmp/samaya-v4-dist"), token="")), host="127.0.0.1", port=8772)'
# 另一个终端：
SAMAYA_UI_TEST_URL=http://127.0.0.1:8772 pnpm --dir src/web run test:monitor
SAMAYA_UI_TEST_URL=http://127.0.0.1:8772 pnpm --dir src/web run test:workflow
SAMAYA_UI_TEST_URL=http://127.0.0.1:8772 pnpm --dir src/web run test:reading
SAMAYA_UI_TEST_URL=http://127.0.0.1:8772 pnpm --dir src/web run test:monitor:performance
SAMAYA_UI_TEST_URL=http://127.0.0.1:8772 pnpm --dir src/web run test:monitor:logs
SAMAYA_RUNTIME_TEST_URL=http://127.0.0.1:8772 pnpm --dir src/web run test:monitor:readonly
```

标准运行仍是先构建前端，再执行 `poetry run samaya serve --host 127.0.0.1 --port 8765`，浏览器端口转发沿用 8765。CLI 默认仍为 `0.0.0.0`，直接远程监听需原有服务端令牌。

## 运行服务

已按既有授权构建 `src/web/dist` 并重启原 8765 服务，沿用 `127.0.0.1`、原环境变量和 `.samaya` 数据目录。新 Samaya PID 为 3710203；Codex daemon PID 3579715 在本次重启前后保持一致。

重启后首页、构建资源、SPA 深层路径、`/api/status`、`/api/monitor` 均为 200；未知 API 和缺失资源均为 JSON 404。重新运行真实只读浏览器检查，仍能读取历史并在刷新后恢复任务；0 次操作提交、0 个页面错误。启动后早期快照为 549 条记录、476 条已核对，未核对记录继续显示真实未知状态；这是启动扫描进度，不代表任务停止。最终产物上的阅读专项回归再次通过。

## 限制

- 没有重新派发、停止或清理真实用户任务；真实验证限于读取历史、全局状态和浏览器刷新。实际写入能力沿用既有验收，不将 fixture 当作新增真实能力验证。
- 未在实体手机软键盘、人工读屏或上万任务下测试。缩减 Chromium 视口不等价于所有移动浏览器键盘实现。
- Figma 是限定演示路径的可点击原型，输入内容及执行状态不是实时数据；完整交互以实现和浏览器测试为准。
- 分页缓存和阅读位置仅在当前页面生命周期内恢复，超出缓存范围需重新加载历史。切换正文宽度时允许浏览器按阅读锚点调整像素偏移。
- 断连期间日志缺口、审批恢复范围、后台进程与轮次的独立生命周期均沿用现有能力边界；不新增可靠队列、暂停、自动验收或智能摘要服务。
