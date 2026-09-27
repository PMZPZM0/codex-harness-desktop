---
id: 2026-09-27-change-办公室场景按参考复刻kenney-贴图拼装-白系-3d-风格程序化绘制零版权素材
date: 2026-09-27
kind: change
area: ui
title: 办公室场景按参考复刻：Kenney 贴图拼装 → 白系 3D 风格程序化绘制（零版权素材）
tags: [team-office, office-render, pixijs, redraw, copyright, guard168, guard169]
commits: []
files: [src/features/team-office/office-render.ts, src/features/team-office/OfficeCanvas.tsx, src/features/team-office/office-iso.ts, scripts/guards/06-app-behavior.mjs]
importance: high
---

# 办公室场景按参考复刻：Kenney 贴图拼装 → 白系 3D 风格程序化绘制（零版权素材）

# 办公室场景按参考复刻：贴图拼装 → 程序化绘制

## 用户诉求
「都发你参考了，按参考一比一复刻不行吗」——参考 = `workbzw/ai-office-react`（MIT）。
当前画面家具散落、桌椅与人错位、卡通描边，与参考的「白系 3D 渲染办公室」完全两套语言。

## 关键取证（决定了怎么修）

1. **参考仓库结构**：`public/assets/office/office.png`（1.5MB 一整张 3D 渲染空房间底图）
   + `desk.png` / `chair.png`（照片级白色家具）+ `chibi-stickers`（Spine 骨骼角色）。
   它好看是因为**素材本身是 3D 渲染**，不是算法。
2. **许可证**：代码 MIT（`Copyright (c) 2026 teejoo`），但 README 首行醒目写着
   **「注意素材版权问题！」** ⇒ 素材大概率非作者原创，MIT 不覆盖。
   本项目要发布安装包 ⇒ **不搬素材**（用户 09-27 拍板选「同风格程序化重绘」）。
3. **我们丑的根因**：不是投影算法，是素材风格 —— Kenney 卡通描边等距件 vs 白系 3D 渲染件。

## 做了什么

- **新增 `office-render.ts`**：全部用 PixiJS Graphics 程序化绘制 —— 白系等距房间
  （后墙 + 两侧收口墙 + 墙脚线 + 地板纵深过渡）、后墙陈设（木色矮柜 + 上层置物架 +
  相框 + 橱柜台面 + 冰箱）、两侧（左墙花箱灌木 + 盆栽 + 右墙窗）、工位桌椅
  （白色桌 + 桌下侧柜 + 显示器 + 键盘鼠标 + 白色办公椅 + 地面柔阴影）。
  ⛔ 三原则：不用黑描边（靠面明暗分层）、柔阴影、近白低饱和。
- **`office-iso.ts`**：房间纵深 398 → 444（参考里纵深占画面约 78%），工位 2×3 排布
  收进中下部（v 0.24~0.84），面板宽 488 / 前沿 704。
- **`OfficeCanvas.tsx`**：删掉全部贴图路线（23 个素材 import、`SPRITE_URL`/`SPRITE_SIZE`、
  `SPRITE_TEXTURES`、`preloadSpriteTextures`、`createSprite`、旧的 drawRoom/drawFurniture），
  改调 office-render；常数调参（`PERSON_K` 人物整体缩放 0.54、`SEAT_LIFT` 118、
  `TAG_LIFT` 166）。
- **遮挡关系**（本轮最关键的一处）：家具 `zIndex = slot.y - 0.4`，人物 `= slot.y - 0.5`
  ⇒ **家具后画、挡住人的下半身**，人只露头肩、桌面与显示器清晰可见（参考观感）。
  反过来设（-0.2）会让人糊住整个桌面（实测截图对照过）。
- **`office-palette.ts`**：描边 3.2/2.2 → 1.1/0.8（卡通粗描边是 v5 语言，参考是 3D 渲染无描边）。

## 守卫同步（旧断言钉的是已废弃的贴图路线，必须翻新）

- 【168】⑨⑩：素材摇摆/吊扇宿主 → **程序化绘制接线 + 零贴图负向断言**
  （`!assets/office/` 且无 `SPRITE_SIZE`/`preloadSpriteTextures`）。
- 【169】整块：素材尺寸表/深浅排序 → **office-render 四件套 + 零贴图依赖 + 家具与人物
  的 zIndex 数值比较**（⛔ 比数值不比出现位置：家具在 syncStatics、人在 syncPeople，
  按行号会比出假红）。
- **变异验证**：① 人物 zIndex 改回 -0.2 → 【169】红 ✓；② 加回贴图 import → 【168】红 ✓；
  还原后全绿。

## 验收

- 真实浏览器探针（vite + Edge headless 同进程，**带应用真实 CSP**）渲染截图：
  0 错误 / 0 CSP 违规 / 画布 960×640；多轮对照参考调参（人/桌椅/标签比例与遮挡）。
- tsc 双 0、vite build、预检 0 条真红、死导入检查 0 条、工作区干净。

## 已知差距（诚实记录）

- 参考是**照片级 3D 渲染**（有环境光、材质的柔和过渡），我们是**矢量绘制**（色块 + 柔阴影）
  ⇒ 构图/排布/配色接近，但材质质感有差距。
- `src/assets/office/*.png`（23 张 Kenney CC0）已无任何引用，**保留作回退保险**，未删。
