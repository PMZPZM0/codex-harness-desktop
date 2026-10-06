---
id: 2026-10-06-incident-思考浮窗层级账body-级-z-index-压住-isolation-壳内一切浮层办公室预览被盖
date: 2026-10-06
kind: incident
area: ui
title: 思考浮窗层级账：body 级 z-index 压住 isolation 壳内一切浮层（办公室预览被盖住）
tags: [z-index, isolation, reasoning-float, office]
commits: [99d5381]
files: [src/styles/12-settings-skills.css, src/features/app-view/AppView.tsx, src/features/shared/ReasoningCard.tsx, scripts/guards/19-z-layers.mjs, DESIGN.md]
importance: normal
---

# 思考浮窗层级账：body 级 z-index 压住 isolation 壳内一切浮层（办公室预览被盖住）

## 背景
用户实测：「办公室预览没有展示在顶层，会被思考板块的内容遮住，好像其他窗口也会被运行中的思考板块遮住」。

## 结论
真因 = **`app-shell` 是 `isolation: isolate` 层，壳内一切 z-index（办公室/模态 400、设置 80~97、画布 90）只在壳内比较**；
思考浮窗 portal 到 **body**、以 `z-index: 8` 参加**根层**竞争 ⇒ 根层任何正 z 都压住整个壳。
修法：
1. 新增壳内宿主 `.reasoning-float-host`（app-shell 壳根、壁纸层旁；**60 档**：高于消息流 <30、
   低于设置内 backdrop 80~97 / 画布 90 / 整屏浮层 400）；宿主 `pointer-events: none`（穿透层），
   浮窗自身 `pointer-events: auto`（可交互）。
2. 思考浮窗 portal 目标从 `document.body` 改为壳内宿主（宿主缺失才回落 body）。
   ⛔ 宿主必须挂壳根：塞进回合卡会撞上 `.turn-group` 的恒等 transform（containing block，fixed 退化）。
3. DESIGN.md 层级表新增 **60 档** + 第 5 条硬规则「壳内浮层不许 portal 到 body 参加根层竞争」。
4. 守卫【198】+6 条：宿主 60 档相对画布/模态的数值真值、挂壳根、portal 目标、穿透层配套。

## 依据
- elementFromPoint 实测（合成浮窗 + 真办公室预览）：宿主内浮窗位置最顶层 = `office-pixel-canvas`
  （浮窗被办公室盖住 ✓）；**对照组**：同样浮窗塞 document.body → 最顶层 = `reasoning-float`
  （body 级仍压住壳 —— 正是用户报的病、也证明判据有区分度）。
- 真流式浮窗实测：`.reasoning-float` 的父节点 = `.reasoning-float-host` ✓。
- 守卫【198】9 条全绿（6 条新增）。

## 影响面
- 思考浮窗（运行中/预览）现在位于所有壳内浮层（办公室/设置/画布/模态）之下、消息流之上；
  body 级浮层（审查弹窗 950、右键菜单 1000）仍在它之上（不受影响）。
- 新加浮层的纪律：优先挂壳内层带；真要 body 级，z 必须 ≥ 950。

## 回滚
`git revert` 本提交即可（宿主元素/样式/portal 目标/守卫一并回退，浮窗回到 body 级旧行为）。
