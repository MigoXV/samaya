# 工作区暂时隐藏与真实活动排序

## 行为

- 侧栏、任务总览的工作区省略号与右键菜单提供「工作区管理」「暂时隐藏」。菜单沿用双主题，208px 宽、32px 行高。
- 隐藏立即作用于两个列表，不影响正在查看的对话、草稿、后台执行或会话归档状态。
- 「已隐藏 N」可逐个或全部恢复；工作区搜索和统一搜索仍可找到记录，主动打开、管理或新建时恢复显示。
- 隐藏状态仅存当前浏览器 localStorage，同源标签页同步。新消息、回复、工具活动、问题、审批或轮次结束会自动恢复；子任务活动归属根对话工作区。
- 查看对话不改变排序；删除旧的访问历史优先排序和当前工作区强制置顶，两个列表使用真实活动时间。
- 后端保存每个会话的活动事件编号与时间，通过现有 250ms monitor patch 提供。状态轮询、目录刷新、模型设置读取、重连和历史事件重放不作为新活动。

## Figma

位于原文件「07 · 任务总览」，复用原画板和语义变量：

- [白垣侧栏菜单](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=368-15902)
- [白垣总览菜单](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=368-16284)
- [白垣隐藏与恢复](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=368-16666)
- [苍渊侧栏菜单](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=368-17050)
- [苍渊总览菜单](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=368-17432)
- [苍渊隐藏与恢复](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=368-17814)

## 验证

- `tests/test_workspace_activity.py`：活动分类、持久化、重启、增量回复不触发额外原生读取。
- `src/web/tests/workspace-hide.mjs`：查阅不置顶、当前草稿保留、刷新/跨标签页隐藏、状态更新不恢复、新活动/子任务恢复、搜索找回和手动恢复。
- 现有 workspace-overview、workspace-search、workspace-management 浏览器回归，涵盖双主题、窄屏、管理操作和可访问性。
- 前端 lint、类型检查与生产构建。

后端全量测试：207 项通过。工作区隐藏、搜索、总览筛选、总览保留状态、工作区管理浏览器回归通过。服务以原有 HTTPS 配置更新至 8765，未重启 Codex daemon。
