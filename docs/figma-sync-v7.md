# Samaya · 目录访问与 Figma 同步 v7

## 已实现

- 取消 `SAMAYA_ROOTS` 的目录白名单校验；配置仅提供常用目录快捷入口，API `roots` 字段保持兼容。目录浏览可上行到文件系统根目录，符号链接按真实目录解析，保留不存在、非目录和权限错误提示。
- 总览顶部提供项目搜索浮层与状态选择器，选择项目保留状态筛选；点击任务总览回到全部项目、全部状态。完整列表按当前范围继续查看。
- 侧栏最近项目最多四项，初次从任务活动初始化，之后按实际访问更新；实时输出不重排。每行 28px、行间距 0，不使用独立滚动。项目名称保留完整路径提示，待处理或运行信息取自真实监控数据。
- 项目筛选只影响主区域，全部任务仍被监控；全局待处理入口跨项目统计并打开全局待处理页。
- 六个导航入口使用 `lucide-react` 的 Search、PanelsTopLeft、Pin、Inbox、History、Settings；16px、可见描边 1.5px，配色使用既有主题 Token。
- 用户消息保持右对齐，上下内边距 10px；桌面和手机使用同一排版规则。最近项目不增加图标。

## 验证与运行

- `poetry run pytest -q`：75 项通过；保留一条已有 Starlette/httpx 弃用警告。
- 前端 lint、类型检查和 Vite 构建通过。
- 监控行为、状态恢复、双主题对比度、阅读工作区、命令和技能、v6 Figma 回归通过。
- 新增 `test:scope`：搜索项目、项目与状态组合筛选、全局待处理计数、稳定最近项目、六个图标、Escape 与焦点返回、双主题 axe、320/390/768px 浮层和用户消息右边界校验，测试数据完全隔离。
- 真实服务只读检查：550 条记录、550 条确认，无页面异常，提交任务操作 0。
- 网页服务在待回答请求与提交中操作均为 0 时重启。未重启共享 Codex daemon；原先两个执行中的任务仍为 inProgress，550 条记录恢复确认。真实 `/api/directories?path=/tmp` 已成功返回。

## 设计与交付

[Figma 总览](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=5-749)、[用户消息](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=4-109)。Figma 规范已补充常用目录语义和右对齐约束。

[页面索引](design/figma-sync-v7/index.json)、[浏览器总览](design/figma-sync-v7/browser-overview-vallum.png)、[项目浮层](design/figma-sync-v7/browser-projects-vallum.png)、[手机消息](design/figma-sync-v7/browser-message-390.png)、[打印稿](design/figma-sync-v7/browser-print.pdf)。浏览器图使用隔离示例数据，Figma 导出以 `figma-` 开头。验收数据位于 `docs/verification/figma-sync-v7/`。

在 `feature/chat-workspace-v5` 分批提交，运行地址沿用 `http://127.0.0.1:8765`。
