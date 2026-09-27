---
id: 2026-09-27-incident-办公室场景家具全变白方块pixijs-v8-的-texturefrom-不再自动加载贴图
date: 2026-09-27
kind: incident
area: ui
title: 办公室场景家具全变白方块：PixiJS v8 的 Texture.from 不再自动加载贴图
tags: [team-office, pixijs, texture, white-box, assets]
commits: []
files: [src/features/team-office/OfficeCanvas.tsx]
importance: high
---

# 办公室场景家具全变白方块：PixiJS v8 的 Texture.from 不再自动加载贴图

修「办公室场景家具全变白方块」（用户截图实测：人物正常、桌子/椅子/显示器全是白色小方块）。

**根因**：PixiJS **v8 的 `Texture.from(url)` 不再自动下载资源** —— 未加载时返回空
texture（1×1 白点），Sprite 拉伸后就是一块白方块。原实现在 `await app.init()` 之后
**立即** `drawRoom()` / `drawFurniture()`，从没等过贴图加载；而人物是 Graphics 程序绘制
（不依赖贴图），所以只有人物正常显示 —— 这正是「位置对、贴图空」的症状来源。

**修法**：
- 新增 `SPRITE_TEXTURES` 缓存 + `preloadSpriteTextures()`（`Assets.load` 预加载，
  幂等、单个失败 warn 不中断）
- 绘制顺序改为 `await preloadSpriteTextures()` → `drawRoom` / `drawFurniture`
  （并复查 cleaned 标志，卸载中途不画）
- `createSprite` 只从缓存取 texture；**缺失就直接跳过，绝不退回 `Texture.from(url)`**
  —— 退回等于把白方块又画回来（负向约束写进注释）

**验收**：
- 组件级视觉探针（vite + Edge headless 同进程）真实渲染 4 人落座场景截图：
  书柜 / 办公桌 / 椅子 / 显示器 / 键盘 / 盆栽 / 垃圾桶 / 纸箱 / 落地灯 / 小植物全部正常，
  控制台 0 错误
- 顺带修掉迁移遗留的整条死导入（`AppView.tsx` 的 `emptySnapshot`，它让
  `check-dead-imports` 打红）
- tsc 双 0、vite build 通过、预检 0 真红、bag-types/require-paths 全绿
