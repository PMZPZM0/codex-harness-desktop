---
id: 2026-09-26-incident-agentsmd-被引擎默认-32kb-静默截断一半规章进不了模型project-doc-max
date: 2026-09-26
kind: incident
area: engine
title: AGENTS.md 被引擎默认 32KB 静默截断：一半规章进不了模型（project_doc_max_bytes）
tags: [project-doc, agents-md, prompt-injection, project_doc_max_bytes, guard172]
commits: []
files: [electron/codex-server.ts, scripts/guards/06-app-behavior.mjs, AGENTS.md]
importance: high
---

# AGENTS.md 被引擎默认 32KB 静默截断：一半规章进不了模型（project_doc_max_bytes）

用户提问「现在 Codex 开发项目是不是会按规章制度走」——查证过程发现真 bug，非只是确认。

【三层查证结论】
① 文档层齐全：AGENTS.md 551 行 / DESIGN.md 145 行 / docs/ARCHITECTURE-RULES.md 351 行，且 AGENTS.md 的「🎨 视觉规范」段正确指到 DESIGN.md（引导链完好）。
② 机制层确证：用 `codex debug prompt-input` 渲染模型实际输入，实证引擎读 <cwd>/AGENTS.md 并注入 role=user 的 <INSTRUCTIONS> 块；并实证引擎会从 cwd **向上遍历拼接多级 AGENTS.md**（子目录探针 + 项目根两份都注入）。
③ 行为层发现真 bug：引擎参数 project_doc_max_bytes **默认 32768 字节**，超出**静默截断**（不报错、不加提示）。实测注入正文恰 32770 字节，而 AGENTS.md 65775 字节 ⇒ **尾部约一半规则（工具链清单 / 能力清单 harness-api / 引擎初始化原则 / 停止链路 / 记忆后端…）根本进不了模型**。症状即「规章写了但 agent 不照做」，且 agent 自己不知道没读到。

【修复】electron/codex-server.ts 启动参数加 `-c project_doc_max_bytes=262144`（放子命令之前，app-server 只认全局 -c；已实测引擎接受且无 Invalid configuration）。实测修复后注入 65777 字节 ≈ 磁盘全文，尾部章节全部到位。

【判据】守卫【172】3 条：① 启动参数锚 spawn argv 的代码形态（变异验证：删参数即红）；② 上限必须 > AGENTS.md 实际字节数；③ 留 2× 余量（引擎向上拼接多级 AGENTS.md，卡的是总量——全局 codex-home/AGENTS.md 另有 12KB）。守卫②当场抓出初值 131072 只有 1.99× 余量，提到 262144。

【核实过的边界】spawn 仅 1 处（codex-server.ts:241），restart(222) 与懒启动(314) 都经 start()→launch() ⇒ 一处改动覆盖所有路径；其余 codexBinaryPath() 调用点是更新器/诊断/登录，与注入无关。

【成本，已如实告知用户】每会话注入量 32,770 → 65,775 字节（粗估 token ~9,500 → ~20,600，中文按 1 token/字、其余 3.5 字符/token 折算，**是估算非精确值**）。长会话大概率被 prompt cache 命中。若上下文吃紧，应精简 AGENTS.md 而非继续抬上限（现有上限做保底，精简不会再被静默截断）。

【连带】AGENTS.md 增「本文件有注入上限」一节（含自查口径 `wc -c`、关键规则往前面放、不要无限增长）。
