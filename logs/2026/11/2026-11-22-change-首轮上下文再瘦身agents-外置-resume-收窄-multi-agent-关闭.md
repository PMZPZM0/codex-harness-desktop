---
id: 2026-11-22-change-首轮上下文再瘦身agents-外置-resume-收窄-multi-agent-关闭
date: 2026-11-22
kind: change
area: context
title: 首轮上下文再瘦身：AGENTS 外置 + resume 收窄 + multi_agent 关闭
tags: [token-budget, agents, resume, tool-surface]
commits: []
files: [AGENTS.md, docs/AGENTS-DETAILS.md, electron/features/codex-ipc.ts, electron/codex-server.ts, electron/dispatch.ts, scripts/guards/12ai-skill-packs.mjs, scripts/guards/07-turn-fold/part-06.mjs]
importance: normal
---

# 首轮上下文再瘦身：AGENTS 外置 + resume 收窄 + multi_agent 关闭

## 背景
用户令：「现在首轮 token 还在 5.7W 太多了，还需要再降一下，做到极限剩，不影响缓存命中率的情况，和能力不阉割」。

## 结论
四处同轮落地，全部不删能力：
1. `AGENTS.md` 60,056 → 20,500 字节。查阅型章节（不变量速查 / 验收铁律全文 / 工具链 / 安装 / UI 速览 / 两个默认值 / 多仓长文）原样外置 `docs/AGENTS-DETAILS.md`，
   常驻只留每轮都要用的硬规则 + 一行指针（改对应模块前再读那一节）。
2. **resume 也按 CORE 画像收窄**（`electron/features/codex-ipc.ts`）：实测 rollout 备份显示，
   新建会话被收窄成 17 个工具（19,061B）后，resume 的工具面升级又把它整份覆盖回 58 个（53,128B）。
   现在只在**确认 kind=normal** 时再裁一次（hub/派生会话不动，拿不到 kind 也不动）。
3. 引擎启动参数加 `-c features.multi_agent=false`（`electron/codex-server.ts`）：发动机自带的
   deprecated `multi_agent_v1` schema 实测 9,846B，宿主调度（agent_invoke / 专家团）另有工具面。
4. 调度工具描述（`electron/dispatch.ts`）删重复长文、目标说明 80→40 字；守卫要求的短语全部保留。

## 依据
- 离线抓包（临时 mock Responses API + `codex exec`，同一 CODEX_HOME，用完即删）：
  单轮请求体 **101,783 → 70,497 字节**；tools 20,196 → 10,349 字节（multi_agent 关闭后）；
  AGENTS 注入项 39,085 → 18,191 字符（项目 doc 完整注入、未截断）。
- 工具面实测来自真实 rollout 首行 `session_meta.dynamic_tools`：17 个 = 19,061B；58 个 = 53,128B。
- 缓存：所有改动都发生在会话/回合开始前，首轮之后前缀稳定；调度描述变短反而减少了
  「专家目录一变就整段前缀失效」的概率。

## 影响面
- 新会话与老会话（resume）的首轮输入 token 都下降；普通会话工具面与 thread/start 完全同口径。
- 中枢 / 群 / 团队 / 委派会话**不受** resume 收窄影响（kind 判定）。
- `AGENTS.md` 规则本体没删，正文都在 `docs/AGENTS-DETAILS.md`；两仓逐字镜像。

## 回滚
- AGENTS：从 git 取回旧版即可（`docs/AGENTS-DETAILS.md` 可保留）。
- resume 收窄：删掉 `hostKind === "normal"` 那段（回到旧行为：整份覆盖）。
- multi_agent：删掉 spawn 参数 `-c features.multi_agent=false`。
