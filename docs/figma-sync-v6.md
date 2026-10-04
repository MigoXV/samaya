> 总览行为已更新为按最近活跃工作区分组，每组默认展开 5 个任务，结束任务保留原组。当前说明见 [工作区总览](chat-workspace-v5.md)；下文保留 v6 交付记录。

# Samaya · Figma 全量同步 v6

本轮将已确认的总览和工作区设计同步至代码；沿用 MANAS 页面关系与苍渊·白垣语义 Token，没有修改后端协议或训练框架。

## 页面与交互

- 总览默认展示最多 2 项待处理请求、3 个继续工作入口；完整请求数量保留，未知请求单独提示。最近结束默认折叠，展开最多显示 5 条，完整列表可继续查看。最近任务预览使用稳定成员集合，流式输出不重排；完整列表和全局待处理查询全部纳管记录。
- 标题、持续状态、页签、正文和输入器对齐到桌面 720px 阅读轴；侧栏收起后居中，手机两侧 20px。待处理、后台运行、失败和断连状态使用真实观察结果。
- “对话／改动与产物”在任务标题下切换，草稿与两个页面的阅读位置分别保留。回复里的实际链接保留所属上下文，复制操作在回复末尾；没有虚构设计示例中的文档产物。
- 输入器默认 112px，12px 内边距、32px 底栏；技能／上下文在左，轮次语义和停止／发送在右。多项上下文收为首项加数量，可展开路径并逐项移除。多行向上扩展，最高为视口的三分之一。
- `$` 与 `/` 候选保持输入器全宽、4px 间隔、28px 单行及 20px 文字行高。最多显示 8 行后滚动，名称与简述分别截断；来源在桌面右侧，完整描述和路径可悬停查看，引用选中后也可展开查看路径。保留方向键、Enter、Tab、Escape、IME 与原生权限检查。
- Figma 静态图标存放于 `src/web/public/figma/`；保持原始 SVG 与尺寸，没有临时资源 URL。界面内容为动态数据，设计示例不代表真实任务完成。

## 验证

- 前端 lint、TypeScript/Vite 构建；既有监控、状态恢复、阅读和输入浏览器回归。
- 新增 `test:figma`：总览展示上限、默认折叠、流式顺序稳定、未展示任务仍有后台状态、720px 几何、候选 28px／4px／8 行、静态图标加载和原始尺寸、页签与草稿、320/390/768/1440px 和低高度输入器。
- 阅读回归增加两页签独立滚动恢复；保留断连、长内容、中文输入法、命令执行、请求处理、双主题 axe 和对比度检查。
- 后端 `poetry run pytest -q`：74 项通过（1 条已有依赖弃用警告）；浏览器测试使用隔离 fixture，不向真实 Codex 提交任务。
- 真实服务只读验收：549 条记录、549 条确认，连接正常，历史及刷新选择恢复成功，提交操作 0。详见 [只读报告](verification/figma-sync-v6/runtime-browser.json)。

命令：

```bash
pnpm --dir src/web run lint
pnpm --dir src/web run build
SAMAYA_UI_TEST_URL=http://127.0.0.1:8765 pnpm --dir src/web run test:browser
poetry run pytest -q
```

## 设计与交付

[Figma 文件](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa)；[总览](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=5-749)、[工作区](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=4-2)、[技能菜单](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=14-255)。完整页面节点见 [索引](design/figma-sync-v6/index.json)，截图与打印稿位于同目录。文件名 `figma-*` 是设计导出，`browser-*` 是隔离数据浏览器截图；字体沿用项目 Microsoft YaHei 优先栈，Figma 使用 Noto Sans SC。

本轮在 `feature/chat-workspace-v5` 分批提交，现有 HTTP 服务从构建目录提供新版界面。没有发布 tag、推送远程或重启共享 Codex daemon。真实应用目录此前返回 403 的能力限制仍保留，本轮没有重新执行外部应用调用。
