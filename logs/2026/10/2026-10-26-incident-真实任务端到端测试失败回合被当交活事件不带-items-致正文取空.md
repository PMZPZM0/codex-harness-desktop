---
id: 2026-10-26-incident-真实任务端到端测试失败回合被当交活事件不带-items-致正文取空
date: 2026-10-26
kind: incident
area: boss-groups
title: 真实任务端到端测试：失败回合被当交活、事件不带 items 致正文取空
tags: [boss, 交活, 结算, e2e, 真机]
commits: [1733ad075]
files: [electron/boss-groups/runner.ts, scripts/guards/22-boss-groups.mjs]
importance: high
---

# 真实任务端到端测试：失败回合被当交活、事件不带 items 致正文取空

# 真实任务端到端测试抓到的两个交活结算缺陷

## 测试方法（真机，非 mock）

隔离 profile（复制真实模型配置 + `<userData>/cloud/` 登录令牌）+ 真模型，走完整链路：

```
createBossGroup（1 个 engine 成员）→ assignBossTask（真 turn/start）
→ 成员回合跑完（8s）→ 引擎事件结算 → 落盘 群交付/*.md
→ 出站队列投递 [群事件] → 中枢会话渲染群汇报卡 → 中枢模型自己调 group_review
```

⛔ **隔离 profile 必须一并复制 `<userData>/cloud/`**：只灌模型配置不带登录态时，模型调用
返回 403 `identity-incomplete` ⇒ 成员回合必然 failed、交活必然为空。这是**测试环境问题**，
不修就会把"测试假红"当成产品缺陷，也会掩盖真实缺陷（第一次跑就踩了）。

## 缺陷 ①：失败的回合被当成「成员交活」

`turn/completed` 对**失败回合也会发**（`turn.status = "failed"`）。`onEngineTurnCompleted`
不看 status ⇒ 一次模型调用失败被走成交活：

- 落盘一个空 md（`（成员没有返回文本产出）`）
- 给中枢投一条假交活
- 任务卡在 `reviewing` 永远等不到结论（中枢看到空成品，无从判断）

修法：非 `completed` 一律 `failTask`（释放成员 + 回投「执行失败：成员回合失败：<引擎原文>」）。

## 缺陷 ②：事件里的 turn 不带 items ⇒ 交活正文取空

`turn/completed` 的 `params.turn` 只有 id/status/startedAt 等字段，`items` 为空
（实测 `thread/turns/list` 才能拿到 `items: [userMessage, agentMessage…]`）。
`turnOutputText()` 只看 `turn.items` ⇒ 返回空。

修法：`outputTextOf()` —— 事件里拿不到就按 `itemsView: "full"` 补拉一次 `thread/turns/list`
（与启动对账同一口径）；能拿到时不多打一次引擎往返（交活热路径）。

## 缺陷 ③（顺带发现）：副本结算逻辑漂移

PPcode / 云助手的 `dispatchTask` Promise 兜底还是**旧版**（自己算 text + 直接
`settleSubmission`）⇒ 绕过 `settlingTasks` 幂等闸、与引擎事件主路径重复结算。
已对齐主仓（一律交回 `onEngineTurnCompleted`）。⛔ 这是单提交 patch 同步不到的漂移，
必须逐文件比对。

## 判据

| 场景 | 结果 |
|---|---|
| 成功路径 | 6/6：成员 8s 交活 → 落盘内容 = 甲/乙/丙（正文完整）→ 中枢出群汇报卡 + 文件卡 → 模型逐条对照标准 → `group_review(approved)` → 任务 done |
| 失败路径 | 4/4：坏模型名 ⇒ 任务 failed（不是 reviewing）、成员释放 idle、`群交付/` 无文件、中枢收到「执行失败：… 403 model-not-enabled」 |
| 守卫 | 22 新增 2 条判据（204/204，三仓一致） |

## 测试脚本位置

`.workbuddy/tmp/boss-real-task.mjs`（成功路径）、`boss-fail-path.mjs`（失败路径）、
`diag-turns-shape.mjs`（结构诊断）。⛔ 临时产物，未入库；要固化成回归需搬进
`scripts/e2e/scenarios/` 并接进 check 链（需用户点头，因为要真实调用模型 = 消耗额度）。
