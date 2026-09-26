---
id: 2026-09-26-decision-项目级-agentsmd-自动创建-designmd-引导链12-处-threadstart-转
date: 2026-09-26
kind: decision
area: engine
title: 项目级 AGENTS.md 自动创建 + DESIGN.md 引导链：12 处 thread/start 转发前接线 + 守卫【171】
tags: [agents-md, design-md, thread-start, guard171, project-conventions]
commits: []
files: [electron/project-conventions.ts, electron/features/engine-ipc/01-thread-runtime-codex-bridge.ts, scripts/guards/06-app-behavior.mjs]
importance: high
---

# 项目级 AGENTS.md 自动创建 + DESIGN.md 引导链：12 处 thread/start 转发前接线 + 守卫【171】

用户报障两连：「应用没有自动创建项目级 AGENTS.md」「根目录 DESIGN.md 没生效，让 agent 自己扫他都不知道」。

决策：把「项目级 AGENTS.md 自动维护」做成主进程能力，而非文档约定。

根因链：Codex 引擎原生读 <cwd>/AGENTS.md 注入会话上下文；但应用从不在用户项目里创建它，也没有任何机制提及 DESIGN.md ⇒ 全新项目里 agent 收不到项目级引导，DESIGN.md 摆在根目录也无人知晓。

实现（electron/project-conventions.ts，新模块）：
- ensureProjectAgentsMd(cwd)：缺失则创建含「视觉规范」引导的模板；已存在但从没提 DESIGN.md、且项目根确有 DESIGN.md 时追加一段引导（HTML 注释包裹、带标记、可整段删除）。
- 不覆盖、不重写用户手写内容；追加幂等（文件内标记 + 运行内 Set 双层判重，Set 挡专家团 fan-out 同 cwd 并发连发的重复追加）。
- 全函数 try/catch 静默降级（启动链旁路纪律）。

接线：全部 12 处 thread/start 调用点在转发之前调用（引擎处理 thread/start 时就读 AGENTS.md，响应侧才建会让本会话错过）——主路径 codex:request 桥 + delegation / im-inbound / channel-bot / scheduler / teams×4 / threads-backup / 03-turn-summary / main.ts。fallback 值一律镜像该请求实际的 cwd 参数（引擎从哪读我们就在哪确保）。

守卫【171】5 条断言，其中④为结构性扫描（electron/**.ts 里每个 server.request("thread/start") 的文件都必须已接线）——开发期就抓出 4 个漏接点（teams-agents-ipc / 03-turn-summary / main.ts / scheduler），证明断言有牙。变异验证：改坏守卫①阈值即红、还原全绿；9 场景离线功能验收全过（创建/追加幂等/不动已提及/无 DESIGN.md 不追加/无效 cwd 静默/fan-out 8 连发幂等）。

code review 当轮抓到并修掉 2 个问题：① fan-out 并发可重复追加（补 ensuredDirs Set）；② 守卫①按全文数 DESIGN.md 会被头注释喂饱（假绿形态，改锚模板正文本体）。

教训：接线脚本对 CRLF 文件整文件重写会触发 git 的 -text 误判 ⇒ 2600 行行尾噪音 diff；统一转回 LF 后 diff 收敛到 79 行。批量改文件后必须先看 diff --stat 再提交。
