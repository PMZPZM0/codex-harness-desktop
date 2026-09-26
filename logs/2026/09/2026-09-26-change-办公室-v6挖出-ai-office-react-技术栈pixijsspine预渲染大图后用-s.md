---
id: 2026-09-26-change-办公室-v6挖出-ai-office-react-技术栈pixijsspine预渲染大图后用-s
date: 2026-09-26
kind: change
area: team-office
title: 办公室 v6：挖出 ai-office-react 技术栈（PixiJS+Spine+预渲染大图）后，用 SVG 复刻其斜俯视画面与行为
tags: [team-office, iso, ai-office, research, archive]
commits: []
files: [src/features/team-office/office-iso.ts, src/features/team-office/OfficeScene.tsx, src/features/team-office/OfficeFurniture.tsx]
importance: high
---

# 办公室 v6：挖出 ai-office-react 技术栈（PixiJS+Spine+预渲染大图）后，用 SVG 复刻其斜俯视画面与行为

## 需求

用户给出 workbzw/ai-office-react（152★/MIT/TypeScript）：「看看这个，ai 同事，把我们办公室预览改成他这种，复刻过来」，
随后补充「看看他用什么完成的，不一定要 SVG」。

## 调研结论（这一步决定了整件事的做法）

**它的技术栈**（package.json）：
- `pixi.js ^8.18.1`（WebGL 2D 渲染）
- `@esotericsoftware/spine-pixi-v8 ~4.2.0`（**官方 Spine 骨骼动画运行时**）
- React 19 + Vite（外壳）

**它的资源**（public/assets，这才是"好看"的来源）：
- `office/office.png` **1513KB** —— 整间办公室是**一张预渲染的大图**（不是实时 3D）
- `office/desk.png` 277KB + `office/chair.png` 122KB —— 桌椅贴图
- `characters/chibi-stickers` —— Spine 骨骼：`.json` 241KB + `.atlas` + 10 张图集共约 900KB

**作者自己在 README 里写明**：「点击小人会有菜单弹出，其他按钮没有功能，不要惊讶，**样式只是给你们参考的**」
以及「**注意素材版权问题！**」

⇒ 结论：它好看的原因是**专业美术资源**（预渲染 3D 房间图 + 骨骼动画角色），**不是技术栈**。
换渲染器不会自动变好看；而它的素材**不能搬**（版权明示），Spine 数据也需要收费编辑器才能改。

**它的行为设计（这部分值得完整复刻，且与素材无关）**：
- 工位阵列 2 列 × 3 行（`DESK_COL_GAP=150 / DESK_ROW_GAP=140`）
- 朝向规则：`working / thinking → back`（**工作中背对镜头看显示器**），空闲/走动才转正面
- 头顶状态标签：当前任务 + 姓名 + 在线点
- 交接走的是「**工位拜访**」：`desk_visit`（单次）/ `desk_visit_tour`（连续拜访多人），
  话术池 8 条按 rosterNo 取模选（「{名字}，这件事交给你了。」「接力给你，上下文在线程里。」…）

## 做法：用我们自己的 SVG 复刻它的**画面语言与行为规则**

新增 `office-iso.ts`（斜俯视投影：地板是后窄前宽的梯形，家具用归一化地面坐标 (u,v)
+ 纵深缩放定位，避免早先"各画各的绝对坐标导致集体漂移"）；重写 `OfficeFurniture`（等距家具）
与 `OfficeScene`（房间 + 2×3 工位 + 头顶标签），色板换成它的**极简浅色现代办公室**语言。

复刻到的要素：斜俯视房间（后墙 + 两面内收侧墙 + 天花板边缘 + 地板拼缝 + 地台边）、
靠墙吊架/画框/挂钟/木柜/冰箱/饮水机/打印机/绿植、工位（白桌 + **深灰显示器背面** + 椅子）、
**工作中背对镜头**、头顶「动作 + 姓名 + 在线点」标签、串门拜访/跑腿/派任务/交成果的飞行卡片。

## 迭代中修掉的两个构图错（都靠截图发现）

1. **人被自己的桌子压住**：人物没上抬，头顶落在桌面下方 ⇒ 像"躲在桌子底下"（上抬 76 修正）。
2. **显示器正对头**：居中放会正好盖住坐在桌前那个人的头（偏到 x+38 侧面）。
   另外工位列距 0.27~0.73 太开 ⇒ 画面空旷（收到 0.36~0.64），纵深缩放从 0.74~1.0 抬到 0.86~1.16
   （否则人只有 78px 高，在 960×640 里显得"人小屋子大"）。

## 判据

tsc 0 错、预检 0 条真红（守卫【154】【168】全绿 —— 重写没有打断既有断言）；
离线预览按真实时间截图逐轮比对。
