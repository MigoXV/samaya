# Figma 与当前代码同步 · 2026-10-21

设计文件：[Samaya 对话工作区](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa)。本次补齐此前仅更新代码的交互，并检查相关旧画板与规范。应用代码保持当前已验收版本。

## 已同步范围

- 原有画板的 137 处侧栏统一为共享组件：可折叠工作区、具体对话入口、运行高亮、固定宽度箭头和稳定滚动条占位。运行态没有左侧浅色描边，悬停仅微调整行底色，键盘焦点单独保留。
- 新增 40 张桌面与 22 张手机状态稿，均保留可编辑文字、矢量图标、组件实例和布局；包含白垣与苍渊，手机覆盖 390px 及关键 320px 状态。
- 授权请求：等待处理、规则展开、已提交待确认、失败与确认后移除；组件库另含文件、网络和本轮权限的范围表达。按钮反映服务端选项，规则与单次决定分开，不自动批准。
- Shell：`!` 输入提示、执行中、默认展开的输出、标准错误和非零退出。等宽文字、目录与退出状态保留。
- 停止：入口直接进入提交状态，随后中断；提供失败与重试状态，提交中禁用，不经过确认弹窗。
- 输入历史与导航：↑/↓ 回看并恢复草稿，←/→ 在总览与原对话之间返回。行为边界写入规范，产品输入器不显示常驻快捷键。
- 加号菜单：上传文件、技能、应用、命令与刷新目录；补充外部点击、Esc 关闭的原型路径，并在规范中记录失焦、会话切换和操作选择时关闭。
- `/status` 本地快照补齐双主题；清除旧快捷键提示及“查看全部任务”等过时规范。

## 可直接审阅的入口

| 内容 | Figma 节点 |
| --- | --- |
| 授权卡片 | [苍渊 · 等待处理](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=289-5949) |
| Shell 输入 | [苍渊 · 命令输入](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=289-7092) |
| Shell 输出 | [苍渊 · 默认展开](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=289-7690) |
| 直接停止 | [苍渊 · 停止入口](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=289-8261) |
| 输入历史 | [苍渊 · 向上回看](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=289-9716) |
| 加号菜单 | [苍渊 · 展开](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=289-10255) |
| 手机授权 | [320px · 苍渊](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=292-11926) |
| 任务总览 | [苍渊](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=85-5541) |
| 组件变体 | [共享侧栏](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=288-5929)、[授权](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=288-5930)、[Shell](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=288-5931)、[停止反馈](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=288-5932) |
| 当前规范 | [设计与行为规范](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=6-42) |

## 验收

- 检查新画板的可见文字层边界，桌面与手机均未发现水平溢出。
- 复核授权、输出、停止、菜单、任务总览和手机输入器的导出截图；修正发送箭头的线形、按钮颜色、状态文案和菜单锚点。
- 组件库使用既有语义变量、文字样式与 Lucide 图标；补充主操作颜色别名和等宽文字样式。侧栏有 6 个变体、授权 7 个、Shell 3 个、停止反馈 3 个。
- 复查停止、授权、Shell、菜单和方向键导航的触发器与目标节点；演示延时只表示状态转移，不代表实际服务时延。原型不会执行真实授权、Shell、上传或停止。
- 新状态稿位于对应页面的“同步 ·”系列；截图保存在忽略目录 `.samaya/figma-final-sync/`。本次无需重启运行服务。
