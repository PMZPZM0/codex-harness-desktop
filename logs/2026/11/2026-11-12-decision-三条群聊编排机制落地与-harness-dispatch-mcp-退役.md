---
id: 2026-11-12-decision-三条群聊编排机制落地与-harness-dispatch-mcp-退役
date: 2026-11-12
kind: decision
area: team-chat
title: 三条群聊编排机制落地与 harness-dispatch MCP 退役
tags: [team-chat, orchestration, mcp, github-research, three-repos]
commits: []
files: [src/lib/group-orchestration.mjs, electron/features/group-talk/05-guardrails.ts, electron/features/harness-team-ipc.ts, electron/features/custom-model-apply.ts, scripts/guards/12be-team-chat-ux.mjs]
importance: high
---

# 三条群聊编排机制落地与 harness-dispatch MCP 退役

## 用户令

「把值得抄的三条机制拿出来，然后未修的故障修好，还有很多调用 cli 智能体的热门项目
我看很多啊，里面的群聊都做的很好」。

## 一、CLI 智能体群聊项目调研（2026-11-12 查官方仓库/文档）

用户说得对，这一类项目确实很多且成熟，重点是**它们把协调放在宿主/服务端，不靠模型自觉**：

| 项目 | 形态 | 关键做法 |
|---|---|---|
| `yetone/cumora` | TypeScript / Electron + Postgres + Redis，BYOA 可接 Claude Code / Codex / Gemini CLI 等 | `docs/COORDINATION.md`：seen-cursor freshness gate、HELD envelope、atomic verbatim-dup、hold token（seq-bound + turn end 失效）、NX claim、HELD budget、decline cap；`guard:big-brain` CI 守卫；所有 LLM 调用进一张 `llm_calls` 成本账本 |
| `agentscope-ai/AgentTeams` | Go / K8s / Matrix 协议 | 群聊=共享消息总线，Agent 团队编排与资源调度分离 |
| `ruvnet/ruflo`（原 claude-flow） | TS，59.6k+ stars | swarm 层级/mesh 拓扑、共享向量记忆、hooks 路由 |
| `777genius/agent-teams-ai` | TS | agent 互发消息、互相 review、看板 |
| `slopus/happy` | Swift/MIT，24.6k | 多 CLI 编排，复用已有订阅 |
| `OrchestratorInc/agent-orchestrator` | TS，桌面+移动 | 监督 35+ 编码 agent 的 fleet |
| `CLITrigger` | Web UI | multi-agent discussion mode（arch/ dev /reviewer 辩论）|
| Loki Mode | 自主循环 | blind-review completion council 可否决 "done" |

**Cumora 的总原则**（直接抄进本项目的注释）：
> never add a prompt rule when a code mechanism is the right fix,
> and never add a code mechanism when the brain's making a clear decision in front of correct state.

以及 `COUNT THE ITEMS, NOT THE HEADS`：完成由真实 posted state / 任务项数定义，
不是「每人都发过一次」，也不是 agent 自己喊「齐活儿」。

## 二、三条机制落地（独立板块 + 拓展接口）

新基座层 `src/lib/group-orchestration.mjs`（+ `.d.mts`），纯函数、离线可真跑，
`ORCHESTRATION_RULES` 为拓展接口：

1. **执行与汇报分离** `verifyProgressClaim`：文本声称「已派出 / 进度到第 N 环 / 完成 x/y」
   时，必须有本回合真实派活工具调用或**其他成员已落盘产出**。
   接线：`group-talk/05-guardrails.ts` 新增 `progressClaim` 规则 ⇒ 无证据时
   ① 在群主流追加一条宿主回执（把事实摆出来，⛔ 不改正文、不替模型判断）；
   ② `allowRelay=false`，假进度不再拉起一整串人烧 token。
   证据源接在 `harness-team-ipc.ts`：本回合 `at >= startedAt` 且 authorId ≠ speakerId 的真实消息。
2. **共享消息总线 + 显式发言权** `canSpeak` / `selectNextSpeakers`：本轮已发言者、
   每人回合上限、重复候选、名册由宿主一次算清；替换原来散在循环里的 `spokeRecently`
   逐行重读全量群日志。
3. **宿主判定终止** `shouldStopGroupTurn`：任务项数 / chainBudget / 全员上限 / decline cap
   收口，⛔ 不采信模型自报「做完了」；接在接力循环入口与预算扣减之后。

## 三、未修故障：harness-dispatch MCP 握手失败（根因修复）

启动日志 4 个会话全 `failed`，其余 7 个 MCP ready；47120 服务活着、手工 initialize 200。
不是端口/token 问题：**引擎 0.157 起内置 MCP 工具整批延迟暴露**，这 40+ 工具对模型
全不可达（10-05 隔离复现：请求体里 agent_invoke 出现 0 次）。唯一可见通道是宿主
dynamicTools 的 `agent_invoke` / `harness_tools` 网关。继续注册只会每次启动握手 failed、
占 60s startup_timeout；而 `capability-registry.ts` 还写着「已固定走 MCP」，属于项目
明令禁止的「注释声称能力」。

修法（收口成单一真相源）：
- `custom-model-apply.ts`：不再生成 `[mcp_servers.harness-dispatch]` 段；
  `ownedMcpServers` 仍列它 ⇒ 重写配置会清掉历史段。
- `boot.ts`：drift 判据改成「有段就清理」（`dispatchMcpCount !== 0`），兜底分支同样只删不补。
- `capability-registry.ts`：能力表文案改成 dynamicTools 真相源。
- HTTP 服务 `/rpc` 与 `/mcp` 端点保留（boot 无条件起），只是不向引擎注册 MCP server；
  `dispatchProbes` 的 mcpToolCall 旁证保留兼容老会话。

## 四、判据

- 守卫 12be **395/395**：三条机制各一条**真跑**断言 + 接线断言 + MCP 退役断言。
- 04-misc 自愈断言改锚新契约（残留段清理）；【265】棘轮按实测回填。
- 全链 `npm run check` 0 红；三仓 build + preflight；云助手部署。
