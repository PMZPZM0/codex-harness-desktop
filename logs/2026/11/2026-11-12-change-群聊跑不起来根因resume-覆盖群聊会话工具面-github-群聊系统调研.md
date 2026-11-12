---
id: 2026-11-12-change-群聊跑不起来根因resume-覆盖群聊会话工具面-github-群聊系统调研
date: 2026-11-12
kind: change
area: team-chat
title: 群聊跑不起来根因：resume 覆盖群聊会话工具面 + GitHub 群聊系统调研
tags: [team-chat, tool-surface, rollout, three-repos, bugfix]
commits: []
files: [electron/features/codex-ipc.ts, electron/features/group-talk/01-channel.ts, scripts/guards/12be-team-chat-ux.mjs]
importance: high
---

# 群聊跑不起来根因：resume 覆盖群聊会话工具面 + GitHub 群聊系统调研

## 结论

用户 18:27 追报「群聊压根运行不起来」。判定为**工具面被覆盖**导致的架构级故障，不是模型偷懒、
也不是缺一个群聊框架。修掉两处后，群聊主理人重新拿得到派活工具。

## 硬证据（rollout 首行 `session_meta.dynamic_tools`）

| 会话 | 首行工具数 | `team_member_invoke` | 说明 |
|---|---:|---|---|
| 15:43 刚建的群聊会话 | 8 | 有 | 正确的群聊工具面 |
| 17:15 群聊会话（用户投诉截图里的「failed 空壳」） | 0 | 无 | 已丢 |
| 17:16 群聊会话 | 95 | 无 | 被宿主工具面整份覆盖 |

启动日志同时出现 `[tool-surface] resume 升级 01a1cf0b → 95 个（宿主 39 + 主进程 56）`，
与 17:16 那条会话 id 一致 ⇒ **覆盖者就是通用 `thread/resume` 工具面升级**。

## 根因链

1. 引擎只在 spawn 时定死工具面，来源是 rollout 首行；`thread/resume` / `fork` 传
   `dynamicTools` 会被整份忽略（附录 Z 已记）。
2. 群聊伙伴会话是 `group-talk` 的独立长期会话，正确工具面由 `ensureTalkThread` /
   `peekTalkThread` 在 resume **之前**用 `syncToolSurfaceAsync` 写回首行（团群主理人额外挂
   `team_member_invoke` / `team_phase_invoke` / `team_plan` / `team_status`）。
3. 但这些会话同时出现在侧栏（「伙伴·X@群名」）。宿主通用 `thread/resume` 不区分身份，
   把渲染层 39 个 + 主进程 56 个工具**整份**写回首行 ⇒ 群聊专属工具全被抹掉。
4. 之后 `runTalkTurn` 走 `options.threadId` 快捷路径，不再 ensure/resume，升级没机会执行
   ⇒ 主理人永久没有调人的工具，只能把「已派出 / 进度到第二环」用文字编出来。

⛔ 这也是 11-12 早些时候「进度是编的」「群里废物来一个」的直接原因，与
`harness-dispatch` MCP 握手失败**不是同一条**（那条影响对外 agent_invoke 的 MCP 孪生，
宿主 dynamicTools 仍注册了 agent_invoke）。

## 修法（两处，都是根因）

- `electron/features/codex-ipc.ts`：`thread/resume` 升级分支用 `lookupGroupThread(id)` 判身份，
  群聊伙伴会话**早退**，工具面只由 group-talk 管（动态 import 避开加载环）。
- `electron/features/group-talk/01-channel.ts`：`ensureTalkThread` / `peekTalkThread` 的
  `surface` 恒带 `buildGroupTalkTools()` + `extraTools`，不再在 extraTools 为空时留 undefined
  ⇒ 已被污染的老会话在下次群聊发言时**自动写回**，自愈。

守卫 12be 新增两条（通用 resume 早退 / 两处恒写回），390/390；全链 `npm run check` 0 红。
离线真跑（临时副本，⛔ 不碰用户数据）：17:16 那条首行 95 个工具 → 写回
`group_say,group_read,group_members`，`patched:true`，自愈链成立。

## GitHub 调研（用户令「去看看有没有成熟的群聊系统」）

查了官方仓库现状（2026-11-12）：

- `microsoft/autogen` **已归档、不再维护**（README 2026-10-16 明确 archived，新项目建议转
  Microsoft Agent Framework）。它的 GroupChat / SelectorGroupChat 思想仍值得参考。
- `crewAIInc/crewAI`（MIT，活跃）：Crews 做角色自治协作、Flows 做事件驱动的确定性控制。
- `FoundationAgents/MetaGPT`（MIT，活跃度放缓）：`Code = SOP(Team)`，Environment 共享消息池
  + Role 按订阅消费，动作执行与消息发布分离。
- `langchain-ai/langgraph`：状态机 + checkpoint，生产可控性最强。

**结论**：这些是 Python 框架/运行时，与本项目（Electron + Codex app-server、自有会话/记忆/
权限/UI）不是可替换关系；引入会带来跨进程、重写 UI、丢掉既有隔离体系，且不解决当前根因。
真正值得抄的是三条机制，其中第 ① 条正是本次故障：

1. **执行与汇报分离**：轮次推进、完成判定由宿主/环境负责，模型不许自报进度
   （我们已靠 team_status / 群事件回投，但工具面被抹掉时模型就会退回编造）；
2. **共享消息总线 + 显式发言权选择**（群成员按订阅消费，不靠模型自觉 @）；
3. **终止条件由宿主判定**（chainBudget / ranCount，不靠模型说「做完了」）。
