---
id: 2026-10-06-change-goal-目标条-qoder-化与输入框同宽贴输入框上方编辑删除暂停三键
date: 2026-10-06
kind: change
area: ui
title: /goal 目标条 Qoder 化：与输入框同宽、贴输入框上方、编辑/删除/暂停三键
tags: [ui, composer, goal, qoder]
commits: [38f8766]
files: [src/features/status/GoalBar.tsx, src/lib/goal-time.mjs, src/features/app-view/AppView/02-main-stage/03-composer.tsx, src/styles/17-visual-cards.css, scripts/guards/11t-goal-bar.mjs, scripts/accept.mjs]
importance: normal
---

# /goal 目标条 Qoder 化：与输入框同宽、贴输入框上方、编辑/删除/暂停三键

# /goal 目标条 Qoder 化（与输入框同宽、贴输入框上方、编辑/删除/暂停三键）

## 背景
用户对照 Qoder 截图提令：「目标模式改成这样展示，跟输入框一样长，贴在输入框上面，
展示内容和展示效果和功能按键和跟这个qoder一样，目标 时间 ，目标内容 尾部 编辑，删除，暂停」。
旧实现是输入框上方的普通 `mode-banner` 横幅（「目标模式 · 自动推进中 + 停止」按钮）
+ 输入框内一个目标小圆片，形态与 Qoder 的粉底圆角条不符。

## 结论
- **新组件 `GoalBar`**（`src/features/status/GoalBar.tsx`）：软粉底圆角条（`--red` 7% 混面板色）、
  **width:100% 与输入框同宽**、贴输入框上方卡片栈（与询问/审批卡上下排序）；左侧「🎯 目标 · 计时」
  + 目标内容（单行省略）+ 状态词（自动推进中/已暂停/受阻/已完成），尾部三键 **编辑 / 删除 /
  暂停-继续**（完成态隐藏暂停键）。旧横幅与旧小圆片整体撤除；`.mode-banner` 全族随它的最后一个
  消费方一起删净（`plan-confirm` 变体此前已无 JSX 消费方，全仓 grep 零引用）。
- **计时 = 引擎侧**：`thread/goal/get` 的 `timeUsedSeconds` + 活动态按 `updatedAt` 差值每秒外推
  （暂停/完成冻结）—— ⛔ 不本地记挂载起点（切会话/重启后必须仍准）。`updatedAt` 缺失/为 0 时
  **不外推**（代码评审补的硬化：按 epoch 差值加会把读数变成几十万小时）。格式化纯函数
  `src/lib/goal-time.mjs`（3秒 / 2分5秒 / 2小时2分；非法输入回落「0秒」）。
- **暂停/继续走 `thread/goal/set` 的 status 字段**（`"paused"` / `"active"`）—— 10-06 对随包引擎
  的隔离实测：set 接受 status；⛔ 引擎**没有** `thread/goal/pause|resume` 两个方法，别改回去。
  引擎的 paused 只停「下一次自动续跑」⇒ 暂停时若回合在跑，composer 侧补一发 `interrupt`。
  编辑目标经 `openAppPrompt` 弹窗、**保持原暂停态**（不误触发续跑）；删除 = 既有 `stopGoalLoop`
  → `thread/goal/clear`。

## 依据
- 用户原话（见「背景」）+ Qoder 截图对照；实现后截图 `.e2e-artifacts/shots/01-goal-bar-live.png`
  确认形态（粉底条 + 计时 + 三键）。
- 引擎能力：隔离 `CODEX_HOME` + 直接对 app-server stdio 发送 `thread/goal/set {status}` 实测
  （goal 对象字段 timeUsedSeconds/updatedAt 均为秒）。
- 判据：新建守卫 `scripts/guards/11t-goal-bar.mjs` **14 条**（布局 / 引擎计时 + 不外推 / status
  暂停路径 + 负向不许复活 goal/pause RPC / interrupt 接线 / 编辑保态 / 旧 UI 负向 / 样式与同宽 /
  formatGoalTime 真值表）；6 处变异全抓（`>= 0` 回写 / 复活 `.mode-banner` / 断 interrupt 线 /
  编辑丢暂停态 / 删 width:100% / 生造 goal/pause 调用 —— 每处均报 ✗，还原后 14/14）。
- 验收：新验收项 `goal-bar` **7 条**（真回合全链路：无目标不渲染 → set(paused) 出现 → 编辑往返
  保态 → 继续后计时真跳 + 真续跑回合 → 暂停真中断 → 删除后引擎 goal 清空）；全量默认轮 56/56。

## 影响面
- 渲染层：输入框上方多一条 `GoalBar`（有目标才出现）；旧横幅/小圆片消失（零 JSX 消费方后
  删掉 `.mode-banner` 全族 CSS ≈44 行）。
- 主进程 / 引擎 / IPC / 持久化：不动（只用既有 `thread/goal/*` 通道）。
- 棘轮：【265】`scripts/accept.mjs` 1323→1410（实测，+106 = goal-bar 验收项 7 条）。
