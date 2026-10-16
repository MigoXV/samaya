# 普通文件上传

设计先在 [Figma · 文件上传](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=264-5301) 完成，保留现有苍渊／白垣主题、上下分层输入器和固定底栏。

- 加号菜单提供“上传文件”，桌面支持将文件拖入输入器；图片继续使用缩略图，普通文件显示名称、大小和状态。
- 普通文件有上传中、已就绪、失败三种状态；失败可重试，每项均可移除。未上传完成或失败的附件阻止发送，成功发送后只清空本次已发送附件。
- 单个普通文件最多 20 MB，每条消息最多 5 个普通文件、总计最多 50 MB。图片沿用独立的 5 张、单张 5 MB、合计 10 MB 限制。
- 附件自动换行，无附件区滚动条；文件名过长时省略，完整名称通过悬停和可访问名称提供。
- 选择任务、工作区或返回后保留本标签页的附件草稿；文件二进制内容不写入浏览器持久存储。

当前 Codex 协议没有通用文件输入类型。普通文件写入所选工作区的 `.samaya/uploads/<随机 ID>/`，随消息传递文件引用，由智能体使用现有工具按实际格式读取。上传不会执行文件或预先声称已解析 PDF、Office、压缩包等内容。移除草稿不删除已存文件，以免破坏已发送消息的引用；上传中断或失败时清理未完成文件。

上传接口沿用登录、CSRF 和同源保护，按流计数限制大小；服务端校验工作区归属、随机附件 ID 和存储位置。发送时重新核对当前会话工作目录，不能把旧工作区的附件带入新目录。

## 验证

- `poetry run ruff check src/samaya tests/test_files.py`：通过。
- `SAMAYA_TOKEN='' SAMAYA_SECURE_COOKIE=false poetry run pytest -q tests/test_files.py tests/test_images.py tests/test_composer.py tests/test_core.py`：63 项通过，含文件流限额、取消清理、目录和附件归属、真实 HTTP 登录／CSRF 及原生 start／steer 输入。
- `pnpm --dir src/web run lint`、`pnpm --dir src/web run build`：通过。
- 浏览器 `test:files` 覆盖文件选择、拖放、失败重试、仅附件新建／发送／追加、发送失败保留、跨任务草稿、限额、历史展示、双主题、320px 布局和 axe 检查；原有图片、紧凑对话、工作区和问答回归通过。
- 另用真实浏览器连接隔离 FastAPI 上传接口，确认保存的文件字节与所选文件一致；没有提交真实智能体任务。
