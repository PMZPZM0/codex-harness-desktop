---
id: 2026-10-22-change-办公室预览按-marvis-重做为白色简洁工位板
date: 2026-10-22
kind: change
area: team-office
title: 办公室预览按 Marvis 重做为白色简洁工位板
tags: [office, scene, marvis, rea]
commits: []
files: [src/features/team-office/OfficeCanvas.tsx, src/features/team-office/office-format.ts, src/styles/20-team-office.css, scripts/guards/11d-office-screen.mjs, scripts/guards/06-app-behavior.mjs, scripts/accept.mjs]
importance: normal
supersedes: 2026-10-22-change-办公室预览改交互式-3d-场景场景图-人物可点热点
---

# 办公室预览按 Marvis 重做为白色简洁工位板

# 办公室预览按 Marvis 重做为白色简洁工位板

## 起因
用户先否掉「一张静态 3D 照片」（"现在就一张图，不要，删除重新做"），
再用 REA 拆腾讯 Marvis 的 workbench 后定调：

> "一样的白色简洁场景就行，逆向出来一摸一样的"

Marvis 的 office 是纯白底 + 白色办公桌/黑色显示器/白灰办公椅 + 黑猫成员（彩色围巾），
名字标在显示器上方；左侧另有茶水间/跑步机/休息区。办公室不是照片，是**可动的状态场景**。

## 结论
- 现行实现 = **2 列 × 5 排 = 10 个白色工位**（`OfficeCanvas.tsx`），左侧功能区；
  `CANVAS_W/H = 1560×1270`，舞台仍走 contain + 指针锚点缩放。
- 家具/角色全部 **DOM + SVG 自绘**，只复用 Marvis 的布局与状态机，⛔ 不搬它的美术资产：
  · 白桌（桌面/前缘/桌腿/抽屉柜/键盘/白色主机）+ 黑色显示器 + 白（空位）/灰（有人）椅子；
  · 黑猫：运行/待机坐姿（背对镜头，敲键盘/摇尾），等待/完成/失败站姿（正面，…/✓/! 气泡）；
  · 围巾 10 色按工位索引；名字/状态标在显示器上方；显示器按状态播代码条 + 扫描线。
- 交互保持不变：悬停出详情卡（卡在工位内部，鼠标移上去不会丢）、点击/Enter/Space 进入会话、
  滚轮以指针为中心缩放、contain 基准。
- **删除**：静态照片底图 `assets/office-bg.webp`、`assets/` 目录、宠物包管线（petList/pet://）、
  canvas 2D / imageSmoothing、旧的 3D 场景热点锚点。办公室不再依赖任何位图。

## 影响面
- 用户可感知：办公室从"一张可点照片"变成**白色简洁、会动、可点的工位板**，
  10 个工位、黑猫状态跟真实运行阶段联动，显示器实时演状态。
- 判据：守卫 `11d-office-screen.mjs` 重写为 65 条（零位图 / 白家具 / 黑猫姿态 / 状态映射 /
  交互 / 缩放 / 旧实现负向）；`06-app-behavior` 的【154】【233】同步重写；
  验收 `office-scene` 扩为 6 条（白底 10 工位 / 动画 / 悬停卡 / 手型 / 缩放 / 点击反馈）。
- 回滚：旧版照片场景在 `a6aee7b`；再往前的宠物动画版在工作区历史中已被覆盖。
  本版全部为矢量，回滚需同时恢复照片底图与旧 `OfficeCanvas.tsx`/CSS。

## 备注
- REA 证据：Marvis 的 `office.tmj`（17×14，工位模板）、`assets.tsj`（workstation 图集）、
  24 组 `fc_*` 帧动画、状态机与 6 个工位槽位。
- 版权边界：只取布局与状态机；白桌/黑猫/围巾/设施都用本仓 SVG 重画。
