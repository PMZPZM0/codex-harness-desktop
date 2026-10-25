---
id: 2026-10-25-change-会话行改成单行紧凑布局标签名称尾部时间hover-切换操作键
date: 2026-10-25
kind: change
area: sidebar
title: 会话行改成单行紧凑布局：标签/名称/尾部时间，hover 切换操作键
tags: [sidebar, thread-row, ui]
commits: [cb879e49f]
files: [src/features/app-state/parts/part02/02-goal-browser-notice/01-goal-review-file-browser/02-thread-attention-rows.tsx, src/styles/02-sidebar-threads.css, src/styles/01-base-and-chrome.css, scripts/guards/02-session-logic.mjs]
importance: normal
---

# 会话行改成单行紧凑布局：标签/名称/尾部时间，hover 切换操作键

## 背景
用户对照截图指出侧栏会话行「太宽了，空白太多了」。原布局是两行：第一行标签 + 名称，第二行时间，
行高 46px；右侧操作区还固定预留 30px，导致标题被挤短、时间孤立在第二行。

## 结论
会话行改为单行：来源标签在前 → 会话名 → 时间常驻行尾；行高 46→34px。
默认不展示操作键（操作区 min-width: 0）；鼠标悬停时时间隐藏，尾部切换成置顶/归档/更多。
运行中（或正在打开）不展示时间，尾部位置让给转圈；运行中悬停同样展开操作键，spinner 保持常驻。
专家团成员行没有操作键，hover 不清时间。

## 依据
用户原话：「我们的太宽了，空白太多了，改成窄的标签在前面，对话框名字在后面，时间可以常驻展示在
尾部，如果鼠标放过去了，就动态切换展示成正常现在正常的按键」；追加：「如果会话运行中，有那个转圈，
就隐藏，只有在会话没有运行状态的时候才展示时间」，再追加「运行状态中……鼠标放过去，也动态切换按键」。
实测（CDP，持久 profile）：行高 34px、时间距行右 6px、悬停后 small display:none、pin/more 宽 24px opacity 1。
判据：守卫 02【282b】4 条（单行形态 / hover 让位 / 操作区不占宽 / 运行态隐藏时间）。

## 影响面
`renderThreadRow` 的所有会话行（任务平铺、项目分组、调度会话、专家团主/成员行、
簇头兜底行）。簇头兜底行的操作键（展开箭头）常驻，时间 hover 隐藏后不会出现空白。

## 回滚
把 `01-base-and-chrome.css` 的 `min-height` 改回 46px、`02-sidebar-threads.css` 的按钮
`flex-direction` 改回 column、删除 hover small 规则与 showRowTime 条件即可；
同时删掉守卫【282b】那段（否则会打红）。
