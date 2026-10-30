# 稳定排序与计划模式状态修复

## 交互规则

- 工作区和对话使用独立的 `orderAt` 排序：每个新轮次只提升一次。同轮回复、工具进展、完成、问题和审批只更新状态，不移动位置。
- 最近活动时间继续更新，隐藏工作区仍会因真实活动恢复，但不会因此强制置顶。子任务不会提升主工作区。
- SQLite 增量增加排序时间与轮次去重表；已有会话只初始化一次。重启、重复通知和迟到旧轮次不能改变已确认顺序。断线漏掉的轮次可根据原生轮次标识和开始时间补齐。
- 计划按钮与完成操作共享按会话隔离的模式状态。切回普通模式立即移除旧执行入口，重新进入计划模式不恢复它。
- 模式请求失败或设置待确认时自动读取核对，不自动重发写入；读写版本防止迟到响应覆盖新选择。
- 全局事件仅新增模式更新的会话标识和模式值，不广播完整设置或开发者指令。

## Figma

原文件任务总览中的隐藏菜单已更新排序说明。对话页面补齐双主题状态，并连接模式按钮原型：

- [白垣：退出计划](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=372-17204)
- [白垣：重新进入计划](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=372-17419)
- [苍渊：退出计划](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=372-17637)
- [苍渊：重新进入计划](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=372-17852)

## 验证

后端全量 209 项通过；排序断线补偿调整后另行验证排序相关测试。浏览器覆盖交替流式回复、新轮次、子任务、待处理状态、隐藏恢复、重复模式切换、迟到读取、失败恢复、外部模式变化及原计划执行流程。前端 lint、类型检查和生产构建通过。

测试入口：`tests/test_turn_ordering.py`、`src/web/tests/stable-order.mjs`、`src/web/tests/plan-mode-lifecycle.mjs`。新增浏览器测试已纳入现有 test:scope 与 test:reading。
