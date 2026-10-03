# Python 包职责与重构验证

本次从 `dev` 创建 `refactor/python-package-boundaries` 分支，按 Web、业务服务、监控、文档分批提交。遵循 python-poetry 技能的既有入口和最小必要修改约定；不升级依赖、不改变数据库结构、不调整前端布局。

## 职责与依赖

| 模块 | 职责与约束 |
| --- | --- |
| `commands/app.py` | Poetry/Typer 入口、环境变量、基础日志；保留 `serve` 和 `doctor` |
| `web/app.py` | FastAPI 生命周期、异常映射、服务装配入口、API 404 与 SPA 托管 |
| `web/auth.py` | 单用户登录、Cookie 签名、CSRF、Origin 与响应安全头 |
| `web/routes.py` | HTTP 参数与响应；调用业务服务，不发送 Codex 协议请求 |
| `web/events.py` | 浏览器 SSE、历史事件游标、监控增量与快照恢复提示 |
| `codex/` | `adapter`、`bridge`、`connection`：SDK 兼容、传输、重连；不导入业务包 |
| `sessions/queries.py` | 会话／轮次／条目分页、旧历史回退、子会话、后台命令、订阅恢复与清理预览 |
| `sessions/actions.py` | 发送、追加、停止、目录切换与清理；执行前核对原生身份与状态 |
| `sessions/models.py` | 原生会话父子关系与当前轮次的公共转换函数 |
| `decisions/` | 连接范围内的审批和输入请求、MCP 校验、答复状态与失效处理 |
| `monitoring/service.py` | 全局目录核对、异步轮询、事件触发核对、快照和增量输出 |
| `monitoring/projection.py` | 同步事件归并、旧轮次隔离、观察记录与有界摘要缓存；不访问网络或数据库 |
| `operations.py` | 操作身份校验、同会话串行化、去重、回执及独立于 HTTP 的执行任务 |
| `runtime.py` | 创建上述组件、注入同一个连接、按序分发事件、统一启动和关闭 |
| `store.py` | SQLite 回执、重放事件和关注 ID；不保存第二套任务执行状态 |

依赖方向为 Web → 业务服务 → Codex 连接。监控使用会话查询和审批快照，业务服务均不反向依赖 Runtime。Runtime 只负责装配、生命周期与事件衔接，不重新提供一套转发所有业务方法的总服务。

原 `CodexService` 已移除；内部调用方改为 `runtime.sessions`、`runtime.operations`、`runtime.decisions`、`runtime.monitor`。真实验收脚本同步迁移，但本次没有运行会派发任务的脚本。MCP Schema 跟随其校验模块移动到 `decisions/mcp_form_schema.json`，内容保持一致。

## 保持的行为

- HTTP 路径、请求、响应、错误码、Cookie 与 CSRF 规则不变；OpenAPI 与分支起点完整比较一致，共 17 个路径。
- 全部组件共享一个 SDK 连接，不随浏览器请求创建 SDK。Codex daemon 仍具有独立生命周期。
- 原生事件先更新审批请求，再更新监控投影，最后写浏览器重放记录。MCP 私密请求和完整差异不会进入持久重放记录。
- 断连时先记录待处理请求的未知数量，再清除失效的连接范围请求。重连产生新请求身份，旧身份不能继续授权。
- 同一个操作 ID 返回同一份回执；不同 ID 对同一请求并发答复仍受会话锁和请求状态约束。HTTP 取消不取消已提交操作；恢复连接不重新派发任务。
- 增加显式停止标记，避免取消与已完成异步等待交错时，监控或连接循环再次进入等待。关闭只停止 Samaya 的连接与后台协程。

## 验证结果

2026-10-03 实际运行：

```bash
poetry run pytest -q
poetry run ruff check src/samaya tests scripts
pnpm --dir src/web run lint
pnpm --dir src/web run typecheck
pnpm --dir src/web run build --outDir /tmp/samaya-refactor-web-dist
poetry build --output /tmp/samaya-refactor-package
SAMAYA_RUNTIME_TEST_URL=http://127.0.0.1:8772 pnpm --dir src/web run test:monitor:readonly
```

- Python：47 项通过。保留已有风险测试，新增服务组合的重连、旧审批拒绝、发送与解决分别确认、共享连接与关闭测试，以及迁移后 HTTP 路由和重复操作回执测试。
- Ruff、前端 lint、类型检查和构建通过。前端构建哈希与当前托管产物相同。
- wheel 和 sdist 打包成功；检查 wheel 含新业务包和 MCP Schema，旧 `codex/service.py` 不再包含。
- 临时 8772 实例连接真实 0.160.0 daemon：547 个会话全部确认、28 个原生父子关系；浏览器历史可见、刷新保留选择，0 次操作提交、0 个页面错误。
- 真实临时实例收到 SIGTERM 后约 0.30 秒正常关闭。原 8765 服务和 Codex daemon 保持运行。
- 有一条依赖告警：Starlette TestClient 提示当前 httpx 集成将弃用；本次未调整依赖。

本次为结构重构，真实运行时验证限于只读链路；没有重新执行真实任务派发、破坏性清理或真实审批流程。对应回归由自动化测试覆盖，已有功能的真实验收范围仍以原验收文档为准。

## 使用本分支

CLI、环境变量、启动命令、数据目录和 SDK/runtime 锁定版本均不变，不需要数据迁移。此次仅提交代码，没有替换 8765 上正在运行的 Python 进程。需要加载新结构时，按 README 的同版本构建与重启步骤操作即可；无需重启 Codex daemon。
