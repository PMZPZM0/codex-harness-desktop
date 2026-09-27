---
id: 2026-09-27-change-专家团办公室场景改为-pixijs-渲染弃-svg坐姿走动交接动画全部落到画布-ticker
date: 2026-09-27
kind: change
area: team-office
title: 专家团办公室场景改为 PixiJS 渲染（弃 SVG：坐姿/走动/交接动画全部落到画布 ticker）
tags: [team-office, pixi, 渲染, iso]
commits: []
files: [src/features/team-office/OfficeCanvas.tsx, src/features/team-office/OfficeScene.tsx, src/features/team-office/TeamOfficePreview.tsx, src/features/team-office/office-director.ts, src/styles/20-team-office.css, scripts/guards/06-app-behavior.mjs, DESIGN.md]
importance: high
---

# 专家团办公室场景改为 PixiJS 渲染（弃 SVG）

## 背景

v3–v7 一直是 SVG 手绘 + Kenney 静态家具；用户看过 workbzw/ai-office-react（PixiJS + Spine）
后要求复刻，v6 的 SVG 复刻版仍被否（手绘人物与 3D 渲染家具放一起违和）。09-27 定稿：
**换 PixiJS 渲染，SVG 弃用**。

## 结论

- `OfficeScene.tsx` 变 26 行薄壳，只做 props 传递（导出 `OfficeMember` / `OfficeSceneProps`）；
  渲染全部在新建的 `OfficeCanvas.tsx`（约 990 行）。
- 家具 = Kenney CC0 等距 PNG 走**静态 import** 的 PixiJS `Sprite`（23 张，`SPRITE_URL`/`SPRITE_SIZE`）；
  人物 = `Graphics` 程序绘制（粗描边 + 大头 + 极简五官），坐姿与走动小人共用 `buildHead`。
- 动画全在 `app.ticker` 的 `animateScene()`：坐姿 6 种（打字呼吸 / 咖啡 / 伸懒腰 / 手机 / 翻资料 / 打盹）、
  走动小人 `easeInOut(w.t)` 逐帧插值 + 腿臂摆动、交接卡片弧线飞行 + 落点脉冲、家具 sway（吊扇/绿植）。
- 深度改用 `world.sortableChildren = true` + `zIndex = 地面基线 y`
  （同工位 back -0.4 / chair -0.3 / person -0.2 / front -0.1），取代 v7 手写的三段 addChild 顺序。
- 落座/走动切换：姿势 away 时落座人物清空并生成走动人；回程 `t<=0` 才销毁小人并恢复落座
  （`view.container.visible = !away && (!walker || walker.t <= 0.001)`，否则会出现「两个人」）。
- 删除 `OfficeFurniture.tsx` / `OfficeWorker.tsx` 与 20-team-office.css 的 `ofc-*` 场景样式
  （`.office-scene` 宿主容器与 `.team-office-*` 看板样式保留 —— 类名是接口）。

## 依据

- 守卫同步改写（`scripts/guards/06-app-behavior.mjs`）：【154】改钉 PixiJS 形态
  （`new Application` + `animateScene` + 负向「不得退回 `<svg`」过 `codeOnly`）；
  【168】⑥–⑫ 改钉 ticker 插值 / 交接特效 / 宿主 / 六种坐姿 / 绘制函数；
  【169】三段式改钉 zIndex 数值序 + `sortableChildren`（⛔ 不比行号：人写在桌子后面会假红）。
- 变异测试（新增断言唯一可靠的验证法）：`sortableChildren=true→false` ⇒ 【169】红；
  `scene.handoffs.forEach→handoffsXXX` ⇒ 【168】红；`<OfficeCanvas→<OfficeCanvasX`
  暴露了 `includes` 弱锚点 ⇒ 改成 `/<OfficeCanvas\s/` 后转红。

## 影响面

只影响专家团「办公室」预览浮层的渲染；数据面（director 快照 / team-threads:map / runningThreadIds）
零变化。`DESIGN.md` 组件表 `.ofc-*` 行同步改为 `.team-office-*` / `.office-scene`。

## 回滚

`git checkout` 本条 `files` 列表即可回到 v7（SVG 版需连同被删的两个组件一起还原，
守卫【154】【168】【169】也必须一并回滚，否则会红）。