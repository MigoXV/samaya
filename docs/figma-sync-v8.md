# Samaya · 统一侧栏与连接状态 v8

总览和任务工作区共用同一侧栏：搜索、任务总览、置顶任务、待我处理、最近项目、记录管理、设置与连接、主题和连接状态。最近项目维持最多四项、28px 行高、0px 行间距；任务页不再另外显示项目筛选和任务列表侧栏。任务切换使用统一搜索，草稿和阅读位置按任务保留。

桌面侧栏可收起；手机和窄屏的总览、任务页均展开同一个侧栏。展开时限制背景交互，支持 Escape、焦点返回和半透明遮罩；从侧栏进入搜索后，焦点落在搜索框。侧栏收起和项目筛选均不缩小后台监控范围，全局待处理与异常入口继续显示。

首次加载不会被标成断连，也不再出现顶部通栏提示。侧栏底部显示“正在连接…”；只有实际连接中断才显示“连接待恢复”和紧凑恢复入口，说明按需展开。连接确认后显示“已连接 Codex”；未确认的执行状态与提交限制继续保留。

## 设计同步

[Figma 对话工作区](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=4-2)、[任务总览](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=5-749)、[首次连接](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=39-175)。

已同步对话、执行中、待处理、统一搜索、苍渊、产物、状态待确认、命令、技能与应用共九个任务页面，复用总览导航组件和主题变量。总览筛选状态页同步连接文字；设计规范补充共用侧栏与连接生命周期。新增第 18 页展示首次连接。收起侧栏和手机对话页保留按需展开状态。

[页面索引](design/figma-sync-v8/index.json)、[Figma 白垣](design/figma-sync-v8/figma-workspace.png)、[Figma 苍渊](design/figma-sync-v8/figma-workspace-abyssus.png)、[浏览器总览](design/figma-sync-v8/browser-overview.png)、[浏览器任务](design/figma-sync-v8/browser-workspace.png)、[手机共用侧栏](design/figma-sync-v8/browser-sidebar-mobile.png)、[打印稿](design/figma-sync-v8/browser-print.pdf)。设计和浏览器预览中的任务、数量均为隔离示例。

## 验证

- 前端 lint、TypeScript 与 Vite 构建通过。
- 监控状态、双主题对比度与 axe、阅读位置和草稿恢复、输入器命令与技能、Figma 排版、项目范围回归通过。
- 新增首次连接无断连提示、总览与任务导航一致、无重复任务侧栏，以及 1024/390/320px 共用抽屉、Escape 与搜索焦点验证。
- 真实服务只读检查：550 条记录、550 条确认，无页面异常，提交任务操作 0。未重启共享 Codex daemon。

验收结果位于 `docs/verification/figma-sync-v8/`。前端产物已构建到现有服务 `http://127.0.0.1:8765`，刷新页面即可加载。
