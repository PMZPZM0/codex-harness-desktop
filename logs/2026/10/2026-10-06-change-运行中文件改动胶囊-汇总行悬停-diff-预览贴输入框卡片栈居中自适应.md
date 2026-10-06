---
id: 2026-10-06-change-运行中文件改动胶囊-汇总行悬停-diff-预览贴输入框卡片栈居中自适应
date: 2026-10-06
kind: change
area: ui
title: 运行中文件改动胶囊 + 汇总行悬停 diff 预览（贴输入框卡片栈、居中、自适应）
tags: [ui, composer, file-changes]
commits: [2cb9ca8]
files: [src/features/status/LiveEditedFilesCard.tsx, src/features/status/Status.tsx, src/features/app-view/AppView/02-main-stage/03-composer.tsx]
importance: normal
---

# 运行中文件改动胶囊 + 汇总行悬停 diff 预览（贴输入框卡片栈、居中、自适应）

## 背景
用户对照 WorkBuddy 图三/图四提两条：① 运行中的回合若出现文件改动，在输入框上方加一个
「N 个文件已修改 +X -Y」小窗口，与排队消息 / 询问卡 / 审批卡是**上下排序关系**（最新消息的最后一行
位置，不是浮层遮住别人），鼠标悬停展开文件清单（图四效果）；② 汇总卡里已修改的文件名，鼠标放上去
出 diff 预览。三条追加令：「那个预览diff窗口…自适应展示位置，别固定，固定容易截掉」；
「凡事弹窗类，都要加自适应，不能被裁剪…没其他窗口顺便也检查一下」；
「小胶囊在输入框上面，居中展示，不要靠左」+「鼠标放上去，展示的里面的那个也要居中展示」。

## 结论
- **胶囊**（新板块组件 `src/features/status/LiveEditedFilesCard.tsx`）作为输入框卡片栈的**普通一行**贴
  询问/审批卡之上（⛔ 不 portal —— 上下排序不互相遮从形态上保证），`text-align:center` 居中；
  悬停展开清单（类型图标 + 文件名 + 每文件 +N -N / 已删除）；数据 = 同一条 `turn-file-changes-live`
  源随运行实时刷新；回合结束整卡自动消失（收尾由汇总卡接管）。
- **弹层位置自适应**：按卡片上下空间选边（above/below）+ maxHeight 收窄（内滚）+ 左右钳进视口；
  **以胶囊中心居中**——⛔ 弹层是 `position:absolute`，基准是卡片（`position:relative`），left 必须写
  「相对卡片的偏移」；直接写视口坐标会叠加卡片自身左缘（实测：358 的卡片 + 358 的样式 = 画在 716，
  用户看到的「歪」）。锚点取 `pillRef` 中心（`anchorRect.left + anchorRect.width / 2`），
  贴边被钳住时豁免居中（自适应优先于居中）。
- **汇总卡行悬停 diff 预览**（`Status.tsx` 的 `CompletedChanges`）：260ms 意图延时出、160ms 离开延时关、
  滚动/离开即关；portal 到 body（`.completed-diff-preview`，z=1000 轻浮层带）；先量后画自适应——
  `Math.max(M, Math.min(rect.left, vw - width - M))` + 竖向钳制；内容 = `ToolCodeBlock language="diff"`。
- **弹窗自适应普查**：ComposerMenu / FileCardMenu / ThreadRowMenu / AppSelect 核对无越界；
  画布右键菜单（`DramaCanvas.tsx`）本轮补同款钳制（此前未钳制）。

## 依据
- 用户原话四条（见「背景」）；截图对照 WorkBuddy 图三/图四。
- 几何实测（真引擎回合 + CDP 探针）：胶囊居中后 `pop.style.left = 318px`（= 胶囊中心偏移，非视口坐标）；
  截图确认弹层挂在胶囊正上方居中。
- 判据：守卫 `scripts/guards/11q-live-edits.mjs` 28 条（居中 CSS / 相对卡片偏移 / 胶囊中心锚点 / 接线在
  审批卡上）、`11p-file-summary.mjs` 32 条（悬停预览 portal + 自适应 left + maxHeight）；
  验收 `scripts/accept.mjs` 的 `file-summary` 19 条 + 新验收项 `popup-fits`（登记 10-06 轮）。
  五条变异全抓（去居中 / 写视口坐标 / 固定 left / 断偏移 / 锚点回左缘）——每处改坏后守卫/验收均报 ✗。

## 影响面
- 渲染层：输入框卡片栈多一行（运行中且有文件改动时才出现）；汇总卡行多悬停预览；画布右键菜单钳制。
- 主进程 / 引擎 / IPC：不动（live 数据源沿用 10-06 已接的 `turn-file-changes-live`）。
- 验收：`file-summary` 从 15 → 19 条；新增 `popup-fits`（默认轮 = ui-sketch + file-summary + popup-fits）。

## 回滚
`git revert` 本条提交即可（纯渲染层 + 守卫/验收；无数据面、无迁移）。薄回滚点：删
`LiveEditedFilesCard.tsx` 与 03-composer.tsx 里那一行接线 + 还原 `Status.tsx` 的悬停段。
