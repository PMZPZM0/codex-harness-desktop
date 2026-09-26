---
id: 2026-09-26-incident-两份逐字相同的-reasoningcard-并存修复全落在用户看不到的那份
date: 2026-09-26
kind: incident
area: reasoning
title: 两份逐字相同的 ReasoningCard 并存：修复全落在用户看不到的那份
tags: [reasoning, duplicate, shared-refactor, fit]
commits: []
files: []
importance: high
---

# 两份逐字相同的 ReasoningCard 并存：修复全落在用户看不到的那份

## 背景

用户 10:40 截图追问「为什么还是没有自动跟随，怎么彻底解决」。真机探针（geo-probe 隔离 profile 发真实思考回合）抓到决定性证据：**fit 生效率 0/25** —— 上午的修复全部落空。

## 根因（比前两轮的都深）

**仓库里有两份逐字相同的 ReasoningCard 实现**：
- `session-turn/SessionTurn/02-reasoning-card.tsx`（09-22 从 SessionTurn.tsx 拆出）——**主时间线真实回合**用这份；
- `session-queue/ItemView.tsx` 内的本地副本——乐观气泡/队列场景用这份。

今天前两轮的修复（fit 自适应、滚轮门）全部落在 ItemView 版 = 只修了乐观气泡那条路径，**用户看到的真实回合思考卡一行没改**。这就是「改了又改还是没跟随」的真相。之前真机验证一直「受阻于探针环境」，实际是验证对象就错了。

## 彻底解决：抽共享组件，消灭双份真相源

- 新建 `src/features/shared/ReasoningCard.tsx`（以 session-turn 版为基 + 今天的全部修复：fit 自适应、卡内接管只认真滚动条、先 fit 后贴底）。
- `session-turn/02-reasoning-card.tsx` → 墓碑 re-export（维持 SessionTurn.tsx 既有 import 路径）。
- `session-queue/ItemView.tsx` → 删本地实现（-207 行）与 5 条死 import，改 import 共享组件。
- 守卫【161】锚点迁到共享文件 + 新增「单一真相源」断言（ItemView 里再出现本地 ReasoningCard 定义即红；变异验证真红）。
- ⚠️ 迁移守卫时误伤【127】（它也读 ItemView，全局替换把它的锚点一起换了）——已改回；【161】块自己的锚 = shared/ReasoningCard.tsx。

## 验证

- tsc 0 错；预检 0 条真红；bag 0 missing/extra；验收 settings-pages 通过（44.6s）。
- **真机端到端**：隔离 profile 发真实消息跑思考回合 + 切历史会话展开思考卡——共享组件 fit 真实生效（`inlineMax="260px"`、expected 一致、overflowY=auto）；此前同探针在旧实现上是 0/25。
- 另一个真机发现（本轮探针实锤）：空态 docked-center 时 composer 浮在 timeline 上（composerTop=362 < timelineBottom=800）——fit 量容器底在空态会偏大；但空态没有思考卡，运行态 composer 在 grid 流内（timeline 底=composer 顶），fit 测量正确。此事实已记入守卫注释。

## 影响面

主时间线真实回合的思考卡**首次**获得今天的全部修复（自适应展开 + 卡内跟随防误杀 + 分相位视口跟随）。

## 回滚

git revert 本提交；若需恢复双实现形态（不建议），从历史版本取回两份文件。
