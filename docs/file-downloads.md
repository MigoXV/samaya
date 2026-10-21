# 回复文件链接下载

点击智能体回复或执行计划中的本地文件链接，通过浏览器下载文件，保留文件名与当前对话位置。沿用原有文字链接样式；检查期间静默处理，不显示加载文字、不改变光标、不增加高度。只有失败时在链接下方显示具体原因；重试期间保留原错误，成功后清除，避免提示反复闪烁。普通网页、邮件和页内锚点保持原有行为。

## 路径与接口

- `GET /api/threads/{tid}/files/download?path=...` 返回文件；同一路径的 `HEAD` 用于下载前检查。相对路径由后端读取所属对话的工作目录，不使用浏览器 URL 目录或客户端提供的工作目录。
- 支持绝对路径、相对路径、`file:///...`、`file://localhost/...`、`sandbox:/...`，包含中文、空格和 URL 编码。代码定位支持 `:行号`、`:行号:列号`、`#L行号`、`#L起始-L结束`。优先匹配完整文件名，避免把实际文件名中的百分号或行号样式字符误删。
- 复用现有单用户登录 Cookie 与服务器文件访问范围，不恢复目录白名单。符号链接解析到真实文件；拒绝目录、设备、FIFO 等特殊文件，不代理远程 URL。
- 文件通过 `FileResponse` 传输，设置 `Content-Disposition: attachment`、UTF-8 文件名、`application/octet-stream`，沿用 `no-store` 和 `nosniff`。支持 Range 请求；下载不受上传的 20 MB 限额影响，不在前端构造完整 Blob。
- 未登录返回 401、不可读返回 403、不存在返回 404、无效路径或非普通文件返回 400。前端在 `HEAD` 失败时显示提示；通过检查后将传输交给浏览器下载管理器。检查中防止重复点击，离开会话时取消未完成的检查，不迟到触发下载。
- 本次不改变上传附件卡片，不增加目录打包或文件预览。服务器上实际不存在的沙箱路径仍返回文件不存在。

## Figma

已在原文件“01 · 对话工作区”补齐六张可编辑画板，复用现有侧栏和输入器实例、正文样式及语义变量。

| 状态 | 白垣 | 苍渊 |
| --- | --- | --- |
| 默认 | [文件链接](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=301-11310) | [文件链接](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=301-11729) |
| 静默检查，与默认外观一致 | [白垣](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=301-11449) | [苍渊](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=301-11868) |
| 失败 | [文件不存在](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=301-11589) | [文件不存在](https://www.figma.com/design/TZOGfIsv1ESAQckxwg4lpa?node-id=301-12008) |

画板表示界面状态，不发起真实下载。实现保留现有字体栈和正文排版，错误文字使用 `text-secondary`、12px/18px，与链接间隔 4px。

## 验证

```bash
SAMAYA_TOKEN= SAMAYA_SECURE_COOKIE=false poetry run pytest -q tests/test_downloads.py tests/test_files.py
pnpm --dir src/web run lint
pnpm --dir src/web run build
pnpm --dir src/web run test:downloads
```

后端覆盖路径及定位后缀、完整文件名优先、中文文件名、登录校验、目录与特殊文件拒绝、权限错误、跨工作区及符号链接、33 MB 文件与 Range 请求。

浏览器下载测试自动启动临时 FastAPI 服务，使用真实登录、下载接口和磁盘文件，仅替换会话目录查询与演示对话。它不连接共享 Codex、不提交任务；结束后清理临时服务与文件。逐一检查浏览器下载事件、保存的文件名和实际字节，并覆盖失败重试、重复点击、Enter、离开会话取消、登录过期、危险 URL、双主题、320px 和 axe。截图写入忽略目录 `.samaya/file-downloads/`。原有 Markdown 公式与附件上传浏览器回归也通过。
