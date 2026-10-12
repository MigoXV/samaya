# 图片输入器与统一主操作 v2

本轮先将现有输入器同步到 [Figma 现状对照](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=235-4978)，再在同一文件的「17 · 图片输入与主操作」页完成设计，最后同步代码。

## 设计与状态

- [桌面双主题设计](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=236-5154)：图片、正文、工具条自上而下，模式在左，模型与主按钮集中在右。
- [手机双主题设计](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=236-5283)：保留图片横向浏览及工具条，避免挤压主操作。
- [附件组件](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=236-5002)：120px 方形裁切预览、12px 圆角，右上角移除；点击显示完整原图，发送的原始图片数据不变。
- [主操作组件](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=236-4997)：同一位置、同一 36px 圆形按钮，待发送显示箭头，执行且没有新草稿时显示停止方块；有新文字或图片时可发送追加内容。

大图预览原型：[白垣](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=239-5242)、[苍渊](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=239-5248)。按钮原型演示发送／停止外观切换，不连接真实任务。

## 设计约束

复用现有颜色、间距、输入器圆角和模型组件；补充动作颜色的语义别名与附件尺寸变量。附件图片是演示内容，界面由可编辑文字、组件实例及矢量图标构成，未使用完整界面截图替代设计节点。桌面组合含 128 个后代节点，覆盖 26 个组件实例、36 个文字节点和 24 个矢量节点。Figma 使用现有 Noto Sans SC，代码继续保留项目的微软雅黑优先字体栈。

按设计记录、附件布局、主操作交互分批提交；对应检查覆盖裁切预览与原图放大、键盘关闭与焦点恢复、双主题、窄屏、运行状态切换及追加内容。

实现验证：输入器图片回归、紧凑对话、监控正常／恢复／失败状态及模型选择回归通过；新增检查确保只有一个主按钮，发送完成后切换停止图标，空输入按 Enter 不会误停止，预览原图与附件使用相同数据。前端 lint、类型检查及构建通过。

## 发送后的图片消息

补充 [现状对照](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=240-5242) 与 [右对齐设计](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=240-5251)：已发送图片跟随用户正文靠右，容器沿用正文的最大宽度（544px / 88%），多张图片按顺序排列并在窄屏换行。保留 160px 图片预览及原始比例。输入框内的待发送附件继续从左侧排列。
