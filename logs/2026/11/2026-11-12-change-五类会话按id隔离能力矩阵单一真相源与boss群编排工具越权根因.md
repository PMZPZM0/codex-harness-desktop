---
id: 2026-11-12-change-五类会话按id隔离能力矩阵单一真相源与boss群编排工具越权根因
date: 2026-11-12
kind: change
area: dispatch
title: 五类会话按ID隔离：能力矩阵单一真相源与BOSS群编排工具越权根因
tags: [dispatch, session-isolation, team-chat, three-repos, bugfix]
commits: [2541d17ef, a0a9cfa85, c4d875087]
files: [src/lib/session-kind.mjs, electron/features/dispatch-core.ts, electron/features/dispatch-rpc.ts, src/features/app-state/parts/part08/01-seg.tsx, scripts/guards/11f-dispatch-integrity.mjs]
importance: high
---

# 五类会话按ID隔离：能力矩阵单一真相源与BOSS群编排工具越权根因

## 结论

五类会话（普通 / 中枢 / 专家团 / 专家 / 工作伙伴）此前**不是按 ID 隔离**的：主进程
`restrictedThreadRole()` 只返回一个布尔 `restricted` 加 `dispatchOnly`，五类被压成两档；
工具面、定时任务、知识库写入、CLI 安装四处各自组合这两个布尔判断「谁能做什么」。
这种表达能力的缺失是**架构缺陷**，不是某处漏写一个 if。

直接后果（11-12 用户实测）：工作伙伴群的主理人会话拿到了 `group_create` / `group_assign`，
于是自己新建一个演示群、造了四个同名角色，在假群里派活并自审，再把假群进度当真实进展
汇报到用户眼前 —— 用户这边一个成员产出都看不到。「进度到第二环」全是模型自导自演。

## 根因链

1. `part08/01-seg.tsx` 里 `BOSS_GROUP_TOOLS` **无条件**展开，而紧邻的 `agent_invoke` 有
   `threadRole.restricted ? []` 闸 —— 同一份工具面两套准入口径。
2. `restricted && !dispatchOnly` 这个「只关调度」的组合式在 `dispatch-rpc.ts` 出现三次
   （knowledge_add / scheduler_save / cli_agent_install），加一类会话要改三处，漏一处就串。
3. 「中枢」没有跨两侧的身份源：渲染层查 localStorage 的 `boss-home-thread`，主进程只认
   有群的 `bossThreadId`，没建群的中枢两边看法不一致。

## 修法（唯一真相源）

新增 `src/lib/session-kind.mjs`：六类 kind（`normal` / `hub` / `expertTeam` / `expert` /
`workPartner` / `delegate`）+ `SESSION_CAPS` 能力矩阵（dispatch / bossGroup / scheduler /
knowledge / cliInstall 五个闸门与 memory / workspace / ownsGroups 三个边界声明）。

- `sessionKindOf(facts)` 只认 **ID 归属**（delegateRegistry / teamRunStore /
  `aliasRecordOf().supervisorThreadId` / boss 群成员 / 工作伙伴群台账 / 群 bossThreadId），
  ⛔ 不看标题前缀、不看 cwd；优先级 = 越派生越先判。
- 主进程 `dispatch-core.threadKindFacts()` **只取事实**，判定与 `restricted` /
  `dispatchOnly` / `label` 全部由 `roleOfKind(kind)` 推出；执行端三处硬闸改读 `caps.*`。
- 渲染层 `bag.threadRole` 换成同一个 `roleOfKind()` 快照；工具注册按 `caps.dispatch` /
  `caps.bossGroup`；没建群的中枢用 `isBossSessionContext`（bossIds / sessionIds）补齐。
- IPC `agents:thread-role` 返回体加 `kind` + `caps`（manifest 改一处，各仓自己 `gen:ipc`）。

## 刻意保留的边界（别当 bug 改回去）

- **普通会话仍保留 BOSS 群编排工具**（`normal.bossGroup = true`）：兼容「从任意会话建群」
  的老路径；被关掉的是四类派生会话。`hub` 与 `normal` 的差别在 `ownsGroups` /
  `workspace`（boss-home），不在工具面。
- **工作伙伴 = 只关调度**（11-07 / 11-10 用户令）：定时任务、知识库、CLI 安装照旧，
  ⛔ 别把整包「专家会话限制」套到伙伴头上。定时任务仍走同一个 scheduler，只是 `origin.by`
  按调用者 threadId 分成 chat / group 两套，两边互不可见。
- **单人专家 = 只有主理人的团**：`teamSolo` 归 `expert`，工具面与 `expertTeam` 相同，差别
  只在标签与记忆边界声明（团层里只有它自己一份）。

## 判据

- 守卫 11f 185/185（含**真跑**断言：未知 / 原型链键归一到 normal、派生类型拿不到主会话能力）；
  12be 388/388；12ah 250/250；全链 `npm run check` 0 红。
- 三仓各自的 `npm run build` + `check-preflight` 通过；生成物各仓自产（通道数各不同）。
- ⛔ 三仓同步时 `bag-types.ts` / `vite-env.d.ts` / `ipc-channels.manifest.json` /
  `09-structural.mjs` **不能整份覆盖**：它们各仓有分叉，整份拷会把对方实测计数与通道集冲掉
  （本轮第一次同步就踩到，两仓 build 直接报类型错，撤回后逐项手工合并才绿）。
