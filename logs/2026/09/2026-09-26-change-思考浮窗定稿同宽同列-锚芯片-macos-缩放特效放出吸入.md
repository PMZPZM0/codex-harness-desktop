---
id: 2026-09-26-change-思考浮窗定稿同宽同列-锚芯片-macos-缩放特效放出吸入
date: 2026-09-26
kind: change
area: ui
title: 思考浮窗定稿：同宽同列 + 锚芯片 + macOS 缩放特效（放出/吸入）
tags: [reasoning, float, mac, animation]
commits: []
files: []
importance: high
---

# 思考浮窗定稿：同宽同列 + 锚芯片 + macOS 缩放特效（放出/吸入）

## 背景

用户看到右下角浮窗后定稿最终形态：「放对话框中间，跟输入框一样长，还是 4 行左右；在思考板块附近；刚刚开始是被放出来的特效，运行完成被吸进去——mac 系统里那种应用放大缩小特效；done 态点思考芯片 = 弹窗预览」。

## 结论（共享 ReasoningCard 呈现层重写）

- **流内永远只有一行芯片**（直播「深度思考中 ›」/ 完成「已深度思考（用时）›」），内联 Fold 展开**退役**；
- 正文一律 portal 浮窗：**与输入框同宽同列**（JS 每帧取 composerRect.width/left 写内联）、
  垂直锚**芯片下方 4px**（放不下翻到芯片上方）、正文 **4 行（96px）** 内部滚动；
- **macOS 缩放特效**：spawn（放大放出）/ suck（缩回芯片）两组 keyframes，
  transform-origin 钉在芯片所在的浮窗左上角（scale 0.12 ↔ 1）；
  完成时 .sucking 挂 240ms（forwards 停在消失帧）再卸载——直接卸载会跳过特效；
- rAF 每帧跟随定位（追字/外层滚动/窗口缩放都不脱锚）；直播贴底跟随、done 预览从头读；
  接管/恢复语义不变（真滚动条才认接管）。

## 实现

- `src/features/shared/ReasoningCard.tsx`：删内联 Fold 分支与 fit 几何，新增
  positionFloat（每帧定位）、exiting 吸入态（240ms）、headRef/floatRef；
- CSS：.reasoning-float 重写（fixed + JS 定位 + spawn/suck + origin）+ 正文 96px；
- 守卫【161】整块重写为 11 条（单一真相源 2 / portal+Fold 不得回归 2 / 同宽同列 /
  锚芯片+rAF / spawn/suck+origin+240ms / 4 行 96px / 贴底 / 接管门）。

## 验证

- tsc 0 错；预检 0 条真红；验收 settings-pages 通过。
- **真机端到端**（隔离 profile 真实思考回合，450ms×20 采样）：浮窗出现 10 采样；
  **与输入框同宽 9/10、同列 10/10**；浮窗高 107-137px ≈ 4 行；卡内贴底 9/9+1；
  思考期间 timeline.scrollHeight {624,618}（±6px，无撑）；结束 done 芯片 ✓ 浮窗无残留 ✓；
  最终截图：消息流纯正文与工具卡，无思考占位。

## 影响面

思考卡的呈现形态定稿；内联展开退役（done 回看走弹窗预览）。已知取舍：
① scale 简化版 genie（真 mac 扭曲效果需 clip-path，视觉上 scale-from-origin 已足够接近）；
② rAF 循环在浮窗打开期间每帧读两处 rect（时长通常几秒，成本可忽略）。

## 回滚

revert 本提交（共享组件呈现层 + CSS + 守卫块）。
