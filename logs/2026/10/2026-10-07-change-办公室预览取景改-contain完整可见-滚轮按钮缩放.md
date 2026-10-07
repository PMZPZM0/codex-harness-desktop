---
id: 2026-10-07-change-办公室预览取景改-contain完整可见-滚轮按钮缩放
date: 2026-10-07
kind: change
area: 外观
title: 办公室预览：取景改 contain（完整可见）+ 滚轮/按钮缩放
tags: [办公室, 缩放, 取景, canvas, 守卫口径变更]
commits: [393fb05]
files: [src/features/team-office/OfficeCanvas.tsx, src/features/team-office/TeamOfficePreview.tsx, src/styles/20-team-office.css, scripts/guards/11d-office-screen.mjs, scripts/guards/06-app-behavior.mjs, DESIGN.md]
importance: high
---

# 办公室预览：取景改 contain（完整可见）+ 滚轮/按钮缩放

## 用户报的问题

「预览画面过大，无法完整展示整个办公室，底部内容被裁剪掉了，需要调整为完整呈现整个办公室。
同时为该预览画面增加缩放功能，支持通过鼠标滚轮以鼠标所在位置为中心进行放大和缩小。
在关闭按钮（叉号）左侧添加一组对应的功能按钮，包括"放大""缩小""重置"三个操作。」

## 根因（不是尺寸写错，是取景规则选错）

`OfficeCanvas.fitCover()` 用的是 `Math.max(sw/CANVAS_W, sh/CANVAS_H)` = **cover**。
cover 的定义就是「必然溢出」，溢出的部分由舞台 `overflow:hidden` 裁掉 —— 而舞台当时是
`align-items: flex-start`（顶对齐，只保上半）⇒ 缺的正好是**底部**。

⚠️ 这条规则是 10-05 我自己按「铺满全屏」加的（当时用户报的是「画面未铺满，只显示在中间区域」）。
两次需求方向相反：10-05 要铺满（cover），10-07 要完整（contain）⇒ 换需求时必须**同时改守卫**，
否则守卫会拦住正确修复。守卫 `11d 组 G` 当时钉的就是 `Math.max` 那一行。

## 改法

**取景**：`baseSize()` 改 `Math.min`（contain）；舞台去掉 flex 对齐、画布改 `position:absolute`；
尺寸 + 平移全由视图状态写死。⛔ 不用 `object-fit`（元素盒≠渲染区 ⇒ 点击命中整体偏移）；
⛔ 不用 CSS `scale`（像素会糊）—— 尺寸走 `width/height`，`transform` 只做平移。

**缩放**：视图 = `{ zoom, cx, cy }`（cx/cy = 画布中心在舞台坐标系里的位置），范围 `[1,4]`、每档 ×1.25。
两条入口**共用同一条实现** `zoomAt(nextZoom, ax, ay)`，判据 = 「锚点在画布内容里的相对位置缩放前后不变」：

- 滚轮：锚点 = 指针在**舞台坐标系**里的位置（⛔ 不是画布中心）。监听必须 `{ passive: false }`
  —— 否则 `preventDefault` 被静默忽略，缩放时宿主页面跟着滚。
- 按钮：托盘挂顶栏关闭钮**左侧**，放大/缩小/重置 + 倍率读数；到上下限置灰。
- 单轴夹取：比舞台小 ⇒ 居中；比舞台大 ⇒ 不许露出舞台的边。
- 不做过渡动画：像素画布换尺寸是重画，补间只会糊/抖。

## 两个容易漏的点

1. **顶栏整条是 `pointer-events: none`**（当初为了让画布最上沿的角色能点中）⇒ 新托盘必须自己
   把事件收回来（`pointer-events: auto`），否则三个按钮全是死的。守卫已加这条。
2. **`getBoundingClientRect` 与缩放的关系**：`transform` **只平移不缩放**，所以 rect 的宽高
   就是渲染宽高，既有的命中换算 `(clientX - rect.left)/rect.width*CANVAS_W` 依然精确 ——
   这也是选「改 width/height + translate」而不是「`scale`」的原因之一。

## 真机取证（隔离 profile 跑 dist，14/14）

- 舞台 1280×757、画布 1136×757 居中 ⇒ `min(1280/960, 757/640)=1.1828` ⇒ 960×1.1828≈1136 ✓
  ratio 1.501 = 3:2；完整落在舞台内（旧 cover 会算成 1280×853 ⇒ 底部溢出 96px 被裁）。
- 滚轮在 (320,270) 放大到 125% 后，该点在画布内容里的相对位置 0.2183 → 0.2255（±0.01 内）
  ⇒ 「以鼠标位置为中心」成立。
- 连点到 400% 后「放大」置灰；「重置」回 100% 且重新完整可见。

## 守卫口径变更（本轮唯一"改断言"）

`11d-office-screen.mjs` 组 G 整组重写：cover → contain，并加**负向**断言禁止回退 cover
（`!Math.max(sw / CANVAS_W, …)`），补滚轮锚点 / `passive:false` / 夹取 / 控制句柄 / 范围常量。
与形态无关的两条负向断言（不许 object-fit、舞台必须裁溢出）原样保留。
`06-app-behavior.mjs`【154】新增 4 条：控制组在关闭钮**左侧**（DOM 顺序）、三个操作都接句柄、
画布回报倍率 + 接收句柄、托盘自己收回点击。

## 结果

提交 `393fb05`。26 个守卫 0 条红；收尾三项【93】【94】【96】全绿；`tsc -b` EXIT=0；dist 已重建。
