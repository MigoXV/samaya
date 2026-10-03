# Samaya

Samaya 是基于 Python 的单用户 Codex 网页工作台。它连接服务器上**已有的常驻 app-server**，在浏览器中管理真实会话、执行轮次、子智能体和后台命令。网页关闭或 Samaya Python 服务重启，不会主动停止常驻服务中的任务。

默认首页显示跨项目最近 **20 个主任务**，可切换为 10 个；范围外未解决请求仍有全局入口。单任务以「当前工作」连续阅读和固定输入区为主，「改动与结果」为次级入口。本轮 Figma、状态契约、代码及验证见 [日常工作台 v3](docs/workflow-v3.md)；[v2 交付](docs/monitor-v2.md) 保留为历史参考。

已先完成 [Figma 设计](https://www.figma.com/design/qaGSrQhakH253tizxKkoae)，再按设计实现。支持白垣、苍渊和跟随系统，首次使用默认白垣；沿用 MANAS 工作台／列表／设置页面结构。

## 启动

开发依赖：Python 3.10、Poetry 2.2+、Node.js 22.12+（本机验证 24.18.0）、pnpm 11。Python 项目范围为 `>=3.10,<3.13`。

```bash
cd /workspace/apps/samaya
poetry env use python3.10
poetry install
pnpm --dir src/web install --frozen-lockfile
pnpm --dir src/web run build
cp .env.example .env
# 编辑 .env，设置随机长口令 SAMAYA_TOKEN
poetry run samaya doctor
poetry run samaya serve
```

默认监听 `0.0.0.0:8000`，通过 `http://服务器地址:8000` 访问；启动前需设置 `SAMAYA_TOKEN`。仅本机使用可指定 `poetry run samaya serve --host 127.0.0.1`。标准入口是 FastAPI，统一托管 `src/web/dist`。没有构建产物时会明确报错并给出构建命令。也可以指定 `poetry run samaya serve --port 8765`。

更新代码后，先关闭旧 Samaya HTTP 服务，再构建前端、启动同版本后端并刷新浏览器。后端不会自动加载 Python 改动；只构建前端会使旧进程提供新版页面，导致 `/api/monitor` 返回 404。重启时沿用原监听地址、端口和数据目录，无需重启 Codex daemon。仅使用本地端口转发时，可运行 `poetry run samaya serve --host 127.0.0.1 --port 8765`，将本地端口转发到服务器的 8765 端口。浏览器通过当前页面同源访问 API，无需另外转发 API 端口。

Samaya 不自动启动、升级或关闭已有 Codex daemon。先确认：

```bash
codex --version
codex app-server daemon version
```

本机通过 `/root/.codex/app-server-control/app-server-control.sock` 连接 0.160.0。其他服务器请设置 `SAMAYA_SOCKET`。不要把 socket 当作普通 HTTP URL，也不要向公网暴露它。

清华源按工程约定配置为主源；此次清华镜像无法解析 `openai-codex==0.160.0`，因此为直接依赖显式指定 PyPI 源，两个锁文件均已提交。

## 配置与远程访问

参见 [.env.example](.env.example)，不包含真实凭据。

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `SAMAYA_HOST` | `0.0.0.0` | HTTP 监听地址 |
| `SAMAYA_PORT` | `8000` | HTTP 端口 |
| `SAMAYA_SOCKET` | 当前用户 `.codex/app-server-control/app-server-control.sock` | 已有 daemon 的 Unix socket |
| `SAMAYA_ROOTS` | `/workspace` | 可选择／执行的目录根；Linux 下多个根以 `:` 分隔 |
| `SAMAYA_DATA_DIR` | `.samaya` | Samaya 辅助数据，不是 Codex 数据目录 |
| `SAMAYA_TOKEN` | 空 | 单用户网页访问口令 |
| `SAMAYA_SECURE_COOKIE` | `false` | HTTPS 部署时设为 `true` |

本机空口令模式只接受回环客户端和 localhost/回环 Host。远程监听必须配置长随机 `SAMAYA_TOKEN`；远程使用 HTTPS 反向代理，保留原始 Host，并设置 secure cookie。建议由受限网络或 SSH 隧道访问。登录后使用 HttpOnly、SameSite=Strict 的一天有效会话 Cookie；修改操作校验 CSRF 和 Origin。Codex 登录凭据只由服务器已有 Codex 管理，网页不索取 API key。

只启动**一个 Python worker／一个 Samaya 实例使用该数据目录**；应用使用文件锁拒绝重复实例。开发时不要用自动 reload 运行重要验收任务；不要为网页请求临时创建 SDK 客户端。`SAMAYA_ROOTS` 是网页操作边界，不能替代 Codex 沙箱；已有会话可能具有更宽的执行权限。

## 已实现

- 全部未归档会话与已加载临时会话的内存汇总；独立显示执行、请求与新鲜度。
- 最近 10/20 个主任务、全局待处理、范围外请求入口、筛选后取最近、稳定集合与手动更新、独立置顶视图、最近变化；详情按需展开。
- 运行中追加当前轮次、按会话保存草稿、按请求范围追踪回执；答复发送与服务端消除请求分别确认。

- 服务器目录浏览、新建会话、搜索名称、项目／运行／归档／最近未活动筛选，支持加载更多。
- 既有历史、Markdown 对话、流式文本、命令与输出、文件差异；真实运行状态及主／子会话关系。
- 命令／文件审批与用户输入表单；指定轮次停止；指定后台命令终止。
- MCP 工具调用审批、标准表单、URL 外部流程、接受／拒绝／取消，以及工具文本、资源说明和结构化结果。
- 单个／批量归档、恢复归档、永久删除；删除前展示 ID、目录及后代范围；运行或仍有后台命令时阻止清理；逐项报告部分失败。
- 同一对话切换工作区，保留历史，核对服务端 cwd；下一轮应用新目录 AGENTS.md；旧后台进程保留原 cwd。
- 浏览器刷新恢复；Samaya 重启后重新加入已有任务；事件游标、快照恢复、操作回执和同 ID 幂等处理。
- 桌面与窄屏、原生弹窗焦点管理、键盘操作、连接失败／未知提交／等待输入等恢复路径。

工作区切换不意味着重建会话。既有模型和审批／权限设置继续保留；不承诺重新应用新项目全部 `.codex/config.toml`。如果本轮运行，先等待或点击“停止本轮”，确认结束后再切换。

## 界面主题

侧栏底部、设置页和登录页均可选择“白垣 / 苍渊 / 跟随系统”；窄屏先打开“导航”。偏好按浏览器来源保存，刷新后保留，同源标签页同步。只有选择“跟随系统”时才响应系统外观变化；首次使用始终默认白垣。

主题在 React 加载前应用，同步更新原生控件和浏览器主题色。切换保留当前对话、消息草稿、打开的弹窗及 MCP 输入，不提交任务或重建事件连接。浏览器禁止保存时仍能在当前页面切换，并显示“仅本页生效”。不跨设备同步主题偏好，MCP 草稿仍不跨刷新保存。

两套外观直接使用苍渊·白垣锁定 Token；白垣主按钮为墨骨／石素，苍渊为初光／深渊。设计节点、实际浏览器对比度及验收结果见 [双主题设计](docs/design/README.md) 和 [验收记录](docs/verification.md)。

## 工程结构

```text
src/samaya/
  commands/app.py       Typer 命令、基础日志
  web/app.py            FastAPI、身份验证、API、SSE、静态托管
  codex/adapter.py      SDK 唯一兼容边界
  codex/bridge.py       JSONL ↔ 常驻 Unix WebSocket
  codex/service.py      会话、轮次、审批和生命周期
  codex/monitor.py      原生会话的内存只读汇总、快照与增量
  codex/mcp.py          MCP 表单校验、响应与请求生命周期边界
  config.py            环境变量与目录边界
  store.py             SQLite 操作回执、收到的事件、已查看 ID
src/web/               React / TypeScript / Vite / pnpm
src/web/dist/          构建产物，由后端托管（Git 忽略）
tests/                 不调用真实模型的风险测试
scripts/               明确运行才调用真实 Codex 的验收脚本
```

固定 `openai-codex==0.160.0`，SDK 依赖的 CLI runtime 包也是 0.160.0；实际使用现有 daemon 0.160.0，**不是** SDK 默认启动的独立执行实例。SDK 公开 `launch_args_override` 启动 Samaya 桥接；桥接只负责传输，关闭它不会关闭 daemon。少量 SDK 高层缺口通过官方协议补齐，集中在集成模块；内部 `_client` 访问仅在 adapter.py，升级必须重新验证。

## 开发与验证

```bash
poetry run pytest -q
poetry run ruff check src/samaya tests scripts
pnpm --dir src/web run lint
pnpm --dir src/web run typecheck
pnpm --dir src/web exec node --test tests/mcp-schema.test.mjs
pnpm --dir src/web run build
poetry run samaya doctor
```

VS Code 的 backend 配置通过 `web: build` 在 `src/web` 执行 `pnpm run build`，再启动服务；CLI 和 tests 不触发前端构建。三个配置均读取 `${workspaceFolder}/.env`。

隔离浏览器测试使用 `test:monitor`、`test:workflow`、`test:monitor:performance`、`test:monitor:logs`；具体 FastAPI 实例、环境变量、真实只读验证和本次限制见 [v3 验收](docs/workflow-v3.md)。

Vite HMR 仅是开发辅助：`pnpm --dir src/web run dev`。本项目验收使用 FastAPI 托管产物，不以 Vite 服务器充当正式入口。

真实验收脚本**会调用模型和创建专用测试会话**，不是单元测试的一部分。具体顺序、测试标识、浏览器操作与运行结果见 [验收记录](docs/verification.md)。重复运行会创建新测试记录，请按脚本生成的测试 ID 清理，不要批量删除用户历史。

## 边界

完整结论见 [能力矩阵与集成说明](docs/capabilities.md)、[设计交付](docs/design/README.md)。

- app-server 自身重启后的在途任务、远程执行环境、动态工具输入、命名权限请求和真实后代级联删除未实测，不宣称支持完整 TUI 能力。
- MCP 标准表单和 URL 流程已通过真实 Codex 验证；`openai/form`、`openai/userVerification`、嵌入式 MCP App UI 及 MCP 服务配置管理未实现。URL 测试使用受控本地授权页面，未验证第三方 OAuth。
- MCP 输入草稿仅保存在当前页面内存，刷新后需重新填写；待请求可在 Python 连接未断开时恢复。表单最多 64 个字段、128 KB Schema；超出时仍可拒绝或取消。进度仅在 daemon 实际发送相应事件时展示，本次真实测试未触发进度通知。
- 服务端未验证有事件重放游标。断线期间的增量日志可能缺失，恢复以会话历史为准；待审批请求可能需要原客户端处理。
- 非幂等请求响应丢失时保留“结果不确定”，不会自动再执行；先查询回执并核查会话，再明确解除网页限制。
- 总览搜索与筛选覆盖全部纳管原生会话及最近进展；不检索所有历史消息。归档管理仍按已加载页筛选，显示加载数量。
- 历史按轮次和条目分页；个别旧会话不支持条目分页时通过官方完整历史接口回退，较大会话仍可能较慢。未提供附件上传、在线文件编辑器或 Git 提交操作。
- 清理会在执行前核查状态，但其他 Codex 客户端可能竞争；请避免 CLI 和网页同时清理同一对象。第一版不自动删除记录。
