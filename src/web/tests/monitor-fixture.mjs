// Explicitly isolated demonstration data. These requests never reach Codex.
export function fixture(count = 16) {
  const now = Date.now() / 1000;
  const names = [
    "修复重复提交并补全回归测试",
    "复核语音推理异常",
    "授予报告目录访问",
    "验证长音频边界",
    "整理日报模板与字段",
    "补全会话恢复链路",
    "后台转码与结果整理",
    "导出会议纪要",
    "审查权限边界",
    "核对历史文件差异",
    "生成报告目录",
    "检查模型输入格式",
    "尚未开始的新任务",
    "排队能力示例（当前协议不支持）",
    "核对纪要标题映射",
    "解释失败断言",
  ];
  const states = [
    "inProgress",
    "failed",
    "inProgress",
    "inProgress",
    "inProgress",
    "inProgress",
    "completed",
    "inProgress",
    "interrupted",
    "inProgress",
    "completed",
    "inProgress",
    null,
    "queued",
    "completed",
    "failed",
  ];
  const projects = ["Samaya", "Laya", "MeetNote"];
  const records = Array.from({ length: count }, (_, i) => ({
    thread: {
      id: "demo-" + i,
      name: "[演示] " + names[i % 16] + (i > 15 ? " " + i : ""),
      preview: "演示数据：完成目标并提供依据；本轮结束不代表目标达成。",
      cwd: "/demo/" + projects[i % 3],
      updatedAt: now - i,
      status: {
        type: states[i % 16] === "inProgress" ? "active" : "idle",
        activeFlags: [0, 2, 4, 7].includes(i) ? ["waitingOnUserInput"] : [],
      },
      canAcceptDirectInput: true,
    },
    turn: states[i % 16]
      ? {
          id: "turn-" + i,
          status: states[i % 16],
          error:
            states[i % 16] === "failed"
              ? { message: "命令退出码 1：缺少模型配置；请查看错误上下文。" }
              : undefined,
          items: [
            {
              id: "item-" + i,
              type: "agentMessage",
              text:
                "已定位重复提交原因，正在修改去重逻辑；回归测试尚未开始。" +
                (i === 3 ? "很长的进展摘要，".repeat(30) : ""),
            },
          ],
        }
      : null,
    terminals:
      i === 6
        ? [
            {
              processId: "proc-6",
              itemId: "cmd-6",
              command: "python transcode.py --input /demo/long/path",
              cwd: "/demo/Laya",
            },
          ]
        : [],
    confirmedAt: i === 9 ? now - 120 : now,
    progressAt: now - 30,
    error: i === 9 ? "状态核对失败；保留最后结果" : null,
  }));
  records.push(
    ...[0, 1].map((i) => ({
      thread: {
        id: "child-" + i,
        name: "[演示] 回归子任务 " + i,
        preview: "子任务目标",
        cwd: "/demo/Samaya",
        updatedAt: now,
        status: { type: "active" },
        parentThreadId: "demo-0",
      },
      turn: { id: "child-turn-" + i, status: "inProgress", items: [] },
      terminals: [],
      confirmedAt: now,
      progressAt: now,
      error: null,
    })),
  );
  const pendingRequests = [
    {
      key: "req-0",
      id: 10,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "demo-0",
        turnId: "turn-0",
        questions: [
          {
            id: "scope",
            header: "去重范围",
            question: "希望采用哪种去重方案？",
            options: [
              { label: "同会话", description: "只处理同一任务的重复提交" },
              {
                label: "跨会话",
                description: "同时影响独立任务，需要进一步确认",
              },
            ],
          },
        ],
      },
    },
    {
      key: "req-1",
      id: 11,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "child-0",
        turnId: "child-turn-0",
        questions: [
          {
            id: "target",
            header: "测试范围",
            question: "请补充回归测试范围。",
          },
        ],
      },
    },
    {
      key: "req-2",
      id: 12,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "demo-2",
        turnId: "turn-2",
        command: "python export.py /reports",
        cwd: "/demo/MeetNote",
        reason: "导出报告需要访问指定目录",
      },
    },
    {
      key: "req-4",
      id: 14,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "demo-4",
        turnId: "turn-4",
        questions: [
          { id: "date", header: "日期", question: "请提供报告日期。" },
        ],
      },
    },
    {
      key: "req-7",
      id: 17,
      method: "mcpServer/elicitation/request",
      params: {
        threadId: "demo-7",
        turnId: "turn-7",
        serverName: "demo-reports",
        message: "演示 MCP 表单，按实际字段类型显示。",
        mode: "form",
        requestedSchema: {
          type: "object",
          properties: {
            title: { type: "string", title: "标题" },
            count: { type: "integer", title: "份数" },
            format: { type: "string", enum: ["pdf", "md"], title: "格式" },
            includeNotes: { type: "boolean", title: "附带备注" },
          },
          required: ["title"],
        },
      },
    },
  ];
  return {
    records,
    revision: 1,
    generation: "demo-generation",
    cursor: 1,
    connection: "connected",
    initialized: true,
    catalogAt: now,
    catalogError: null,
    pendingRequests,
    changes: [],
    requestCoverage: "live-connection-only",
  };
}
export async function install(context, state) {
  const calls = [];
  const receipts = new Map();
  await context.addInitScript(() => {
    window.__sources = [];
    class Source extends EventTarget {
      constructor() {
        super();
        window.__sources.push(this);
        setTimeout(() => {
          this.onopen?.(new Event("open"));
          this.dispatchEvent(new MessageEvent("snapshot", { data: "{}" }));
          this.ready = true;
        }, 20);
      }
      close() {
        window.__sources = window.__sources.filter((x) => x !== this);
      }
    }
    window.EventSource = Source;
    window.__emit = (name, body, sequence = 0) => {
      for (const s of window.__sources) {
        const event = new MessageEvent(name, {
          data: JSON.stringify(body),
          lastEventId: sequence ? String(sequence) : "",
        });
        s.dispatchEvent(event);
        if (name === "message") s.onmessage?.(event);
      }
    };
  });
  async function broadcast() {
    state.revision++;
    for (const page of context.pages())
      await page.evaluate(
        (s) =>
          window.__emit("monitor", {
            ...s,
            requestKeys: s.pendingRequests.map((p) => p.key),
          }),
        state,
      );
  }
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      p = url.pathname,
      method = route.request().method();
    let body = {};
    let status = 200;
    if (p === "/api/auth" || p === "/api/login")
      body = { authenticated: true, csrf: "isolated-demo" };
    else if (p === "/api/monitor") body = state;
    else if (p === "/api/input-catalog")
      body = {
        cwd:
          state.records.find(
            (r) => r.thread.id === url.searchParams.get("threadId"),
          )?.thread.cwd || url.searchParams.get("cwd"),
        references: [],
        commands: [],
        prompts: [],
        errors: [],
      };
    else if (p.endsWith("/model-settings"))
      body = {
        models: [],
        current: { model: null, reasoningEffort: null, serviceTier: "default" },
        expectedTurnId: null,
        active: false,
        editable: true,
      };
    else if (p.endsWith("/command-context"))
      body = { data: { goal: null }, fields: [], readOnly: true };
    else if (p === "/api/status")
      body = {
        connection: "connected",
        sdkVersion: "fixture (not runtime)",
        runtime: { userAgent: "demonstration" },
        roots: ["/demo"],
        socket: "isolated fixture",
      };
    else if (p === "/api/directories")
      body = { data: [{ name: "演示项目", path: "/demo/Samaya" }] };
    else if (p === "/api/operations" && method === "POST") {
      const op = route.request().postDataJSON();
      calls.push(op);
      await new Promise((r) => setTimeout(r, 100));
      let result = {};
      if (op.action === "respond") {
        state.pendingRequests = state.pendingRequests.filter(
          (p) => p.key !== op.body.requestKey,
        );
      }
      if (op.action === "interrupt") {
        const r = state.records.find((r) => r.thread.id === op.body.threadId);
        r.turn.status = "interrupted";
        r.thread.status = { type: "idle" };
      }
      if (op.action === "create") {
        const r = structuredClone(state.records[12]);
        r.thread = {
          ...r.thread,
          id: "demo-created",
          name: "[演示] " + (op.body.name || "新任务"),
          cwd: op.body.cwd,
        };
        r.turn = null;
        state.records.unshift(r);
        result = { threadId: "demo-created" };
      }
      if (op.action === "send") {
        const r = state.records.find((r) => r.thread.id === op.body.threadId);
        r.turn = { id: "new-turn", status: "inProgress", items: [] };
        r.thread.status = { type: "active" };
      }
      if (op.action === "terminate") {
        const record = state.records.find(
          (r) => r.thread.id === op.body.threadId,
        );
        record.terminals = record.terminals.filter(
          (t) => t.processId !== op.body.processId,
        );
      }
      const receipt = {
        operationId: op.operationId,
        state: "succeeded",
        result,
      };
      receipts.set(op.operationId, receipt);
      body = receipt;
      await broadcast();
    } else if (p.startsWith("/api/operations/")) {
      body = receipts.get(p.split("/").at(-1)) || { detail: "尚未找到此请求" };
      if (!receipts.has(p.split("/").at(-1))) status = 404;
    } else if (p.endsWith("/summary"))
      body = { diff: null, notice: "演示：当前连接未收到汇总差异。" };
    else if (p.endsWith("/items"))
      body = {
        data: [
          {
            item: {
              id: "log-1",
              type: "commandExecution",
              command: "pytest -q",
              status: "completed",
              exitCode: 0,
              aggregatedOutput:
                "演示日志\n" + ("long log ".repeat(20) + "\n").repeat(1000),
            },
          },
          {
            item: {
              id: "answer",
              type: "agentMessage",
              text: "演示结果：检查结束；不代表真实运行时验收。",
            },
          },
          {
            item: {
              id: "requirement",
              type: "userMessage",
              content: [
                {
                  type: "text",
                  text: "演示要求：修复重复提交并提供验证依据。",
                },
              ],
            },
          },
        ],
        nextCursor: null,
      };
    else if (p.endsWith("/turns")) {
      const id = decodeURIComponent(p.split("/")[3]);
      body = {
        data: state.records.find((r) => r.thread.id === id)?.turn
          ? [state.records.find((r) => r.thread.id === id).turn]
          : [],
        nextCursor: null,
      };
    } else if (p === "/api/threads")
      body = { data: state.records.map((r) => r.thread), nextCursor: null };
    else if (p.endsWith("/cleanup-preview")) {
      const id = p.split("/")[3];
      body = {
        digest: "fixture",
        scope: [state.records.find((r) => r.thread.id === id)?.thread].filter(
          Boolean,
        ),
      };
    } else if (p === "/api/logout") body = { ok: true };
    else {
      status = 404;
      body = { detail: "Fixture endpoint unavailable " + p };
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return { calls, broadcast };
}

export async function returnToOverview(page) {
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible()) await page.keyboard.press("Escape");
  const overview = page.getByRole("button", { name: "任务总览", exact: true });
  if (!(await overview.isVisible()))
    await page
      .getByRole("button", { name: "展开任务侧栏", exact: true })
      .click();
  await overview.click();
  const all = page.getByRole("button", { name: "查看全部任务 →", exact: true });
  if (await all.isVisible()) await all.click();
}
