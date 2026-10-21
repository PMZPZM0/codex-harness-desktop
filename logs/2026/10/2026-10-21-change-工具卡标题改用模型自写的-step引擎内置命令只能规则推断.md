---
id: 2026-10-21-change-工具卡标题改用模型自写的-step引擎内置命令只能规则推断
date: 2026-10-21
kind: change
area: ui
title: 工具卡标题改用模型自写的 step（引擎内置命令只能规则推断）
tags: [ui, command, label, workbuddy, engine]
commits: [7fb641b, 3bb1a626, 67141786]
files: []
importance: normal
---

# 工具卡标题改用模型自写的 step（引擎内置命令只能规则推断）

用户令（10-21，接上一轮的「照 WorkBuddy 做中文展示」）：「可以，继续」= 做我提的 ① 方案
（把「模型写描述」的通道落到宿主注册的工具上）。

**先证伪了一条更诱人的路（重要）**：本想走引擎内置 shell 的 `justification` 字段（它在 rollout 里
出现过 1 次 / 454 次调用），但 0.162.1 二进制里写着
"`justification` requires an explicit `sandbox_permissions`; use `sandbox_permissions:
\"require_escalated\"` ... or omit `justification`" ⇒ 它是**审批请求**字段，填了就弹审批框。
⇒ 引擎内置 `exec_command`/`shell` **没有**可用的语义通道，只能继续走 commandAction 规则推断。
两条通道各管一半，别指望合成一条。

**实现**（新文件 `src/lib/step-note.mjs`，三件套单一真相源）：
1. `withStepParam(tools)` 注入可选 `step`（幂等 / 不进 required / 不改入参对象）
2. `stripStepParam(args)` 转发前剥离（`callMcpTool` 唯一出口；严校验的 MCP 会当非法入参）
3. `stepOf(args)` 读取（空/超 40 字当没填 ⇒ 调用方退回原标签，⛔ 绝不编假标题）
注入点：codex-ipc thread/start（MCP 合并后、try 外）+ resume 改首行前；delegation/teams 各自包
（主进程自建会话不经过 codex-ipc 拦截）。展示：ItemView 卡 verb 优先 step、技能态优先；
turn-fold 芯片同口径；CSS `.action-verb` 单行省略（40 字会把状态图标挤出去）。
指令：developer-instructions 加 STEP_NOTE_INSTRUCTIONS（早出现），并明说「只填工具表里列了的」。

**判据**：纯函数真跑 22 组 ALL_OK；守卫 07 +9 条（含 3 条运行时真跑）全绿；11-kb 允许包装
并新增「包装必须在」（39/39）；build + build:electron 绿；buildDevInstructions 真跑确认指令进上下文。
三仓 7fb641b / 3bb1a626 / 67141786；AS 渲染层已部署。

⛔ 教训（新增一条）：**「模型自写标题」这种通道必须先查引擎给不给字段，而不是先改 schema** ——
这次差点按 `justification` 写一版，落地后每条命令都会变成审批请求。
⛔ 另一条：给工具面加**通用参数**时，剥离点必须只放**唯一出口**（callMcpTool），
否则第三方服务器严校验会把它当非法入参，而症状是「某个连接器的工具莫名报参数错误」。
