---
id: 2026-10-05-incident-拖选时选区浮条一直闪全选内容全屏遮罩抢命中每次selectionchange重渲染
date: 2026-10-05
kind: incident
area: messages
title: 拖选时选区浮条一直闪全选内容：全屏遮罩抢命中+每次selectionchange重渲染
tags: [UI, 选区, 验收]
commits: []
files: [src/features/shared/SelectionActionBar.tsx, src/styles/03-messages-turns.css, scripts/accept.mjs]
importance: normal
---

# 拖选时选区浮条一直闪全选内容：全屏遮罩抢命中+每次selectionchange重渲染

## 背景
用户 10-05 实测上一版选区浮条（见 `2026-10-05-change-消息区选中文字浮出复制-添加到对话操作条`）后报：
「我选中拖动的时候，会一直闪全选内容，停下来又不闪」。同一天还报过「两个按键在那么远、而且都是假的点不了」。

## 结论
1. ⛔ **删掉"点外面收起"的全屏透明遮罩**（`.selection-action-scrim`）。收起改由组件里的全局 `pointerdown`
   负责，并且**放过按在浮条自己身上的按下**（否则一按按钮先收浮条，按钮永远点不动）。
2. **弹浮条改成防抖**：选区停止变化 `DRAG_SETTLE_MS = 220` 才测一次；一路拖就一路重置计时 ⇒ 过程中一次都不渲染。
   松手（`pointerup` / `pointercancel`）再补一次，滚动/改窗口大小 = 重新贴着选区（不是收起）。
3. ⛔ **不许拿"是否按住鼠标"当闸门**（曾写过 `draggingRef`，已删）：本机 CDP 的 `mousePressed`
   **不产生 `pointerdown`**，标记会永远停在 true ⇒ 松手也不弹，看起来像"点了没反应"。
4. **"在不在消息区"改用几何包含**（选区末行矩形套进时间线矩形），只在两头节点仍 `isConnected` 时补一道
   `contains`。原因：真拖选松手后消息区会重渲染，选区指向的文本节点随即脱离文档，只看 `contains` 就永远不弹。
5. 浮条加第三枚按钮「选整条」：把选区扩到整条消息正文，⛔ 排除 `button / .message-footer /
   .user-message-footer / .inline-file-card / .import-record-card`（agent 的 MessageFooter 就渲染在
   `.message-body` 里面，整块 `selectNodeContents` 会把「复制 / 分支 / 15:16」一起选进去）。

## 依据
· 用户原话（本条起因）：「我选中拖动的时候，会一直闪全选内容，停下来又不闪」。
· `npm run verify` 退出码 0；验收项 `message-feedback` 14/14，在 `probe` 与 `main` 两个持久 profile 上各一遍。
  其中 ⑩ 是**真拖选**：按下 → 10 次移动 → 过程中 `.selection-action-bar` 必须一次都不出现
  （`during:false`）、松手后才弹（`afterRelease:true`）、选区真的建起来（`draggedLen:25`）。
· 静态守卫 `scripts/guards/11k-message-feedback.mjs` 48 条；两条新判据做过变异测试：
  摘掉几何包含判定 → ✗；把 `commonAncestorContainer` 放回去 → ✗；还原 → 48/48。

**顺带记下的三个验收侧坑**（都是"应用没坏、测试自己假失败"）：
· `h.eval` 的 CDP 回包上限 20 秒 ⇒ 页面侧**不能有 await 循环**逐个 `scrollIntoView`（长会话 700+ 文本节点必超时）。
· 取点要用 `range.getClientRects()` 的**行矩形**，不用整个文本节点的联合矩形：联合矩形的左边界属于最宽那一行，
  按竖直中心取的那一点常落在行与行之间，命中的是覆盖层 ⇒ 每一行都被筛掉。
· 读 CSS 过渡后的样式：页面被后台化 / 主线程被引擎占住时过渡会**停在中间值**（实测停在 `opacity:0.704`，
  单跑却读到 1）⇒ 判"样式生效没有"要先把那颗元素的 `transition` 临时关掉再取 computed style。
· 环境体检弹窗是启动后**异步扫完才弹**的 ⇒ 关它的动作必须可重入，不能只在验收项开头点一次。

## 影响面
`src/features/shared/SelectionActionBar.tsx`（组件重写）、`src/styles/03-messages-turns.css`（删遮罩规则）、
`scripts/accept.mjs` 的 `message-feedback` 项、`scripts/guards/11k-message-feedback.mjs`、`DESIGN.md` 的浮条一行。
消息脚部的两段反馈与 `FeedbackIconButton` 未动。

## 回滚
`git revert` 本轮提交即可回到"有遮罩 + 每次 selectionchange 立刻重渲染"的上一版（就是用户报闪的那版）。
⛔ 别只回滚遮罩不滚防抖：遮罩消失而浮条仍随选区即时重挂，就是"一路拖一路闪"的原始症状。
