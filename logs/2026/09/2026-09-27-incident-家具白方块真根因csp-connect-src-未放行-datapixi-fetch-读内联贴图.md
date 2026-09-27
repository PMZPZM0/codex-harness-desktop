---
id: 2026-09-27-incident-家具白方块真根因csp-connect-src-未放行-datapixi-fetch-读内联贴图
date: 2026-09-27
kind: incident
area: ui
title: 家具白方块真根因：CSP connect-src 未放行 data:（Pixi fetch 读内联贴图被拦，只在构建产物暴露）
tags: [csp, connect-src, pixijs, data-uri, team-office, guard175]
commits: []
files: [index.html, scripts/guards/03-runtime-boot.mjs]
importance: high
---

# 家具白方块真根因：CSP connect-src 未放行 data:（Pixi fetch 读内联贴图被拦，只在构建产物暴露）

修「构建产物里办公室家具全是白方块」的真根因：CSP `connect-src` 未放行 `data:`。

**完整因果链（探针实测，非推理）**
1. PixiJS 用 **`fetch`** 加载贴图 ⇒ 受 CSP 的 **`connect-src`** 管（**不是** `img-src`）。
2. Vite 构建会把 <4KB 的小图**内联成 `data:` URI** —— team-office 的 23 张家具贴图**全部 <4KB**
   （最大 3620 字节），所以构建产物里 0 个 PNG 文件、24 个内联 data URI。
3. `index.html` 的 CSP `connect-src` 只有 `'self' https: http://localhost:* …`，**没有 `data:`**
   ⇒ fetch 读 data: 被拦 ⇒ 贴图全部加载失败 ⇒ 渲染成白方块（位置对、贴图空）。
4. **dev 下不复现**：dev 贴图走 `http://localhost:5173/...`，被 `connect-src` 里已有的
   `http://localhost:*` 放行 ⇒ 只在构建/打包产物里暴露。

**为什么前两轮误判**
第一轮修 `Texture.from` → `Assets.load` 本身是**必要但不充分**的（v8 确实不自动加载）；
两轮的"验证通过"都是**在 dev 环境或无 CSP 的探针页跑出来的假绿** —— 探针页没有带应用的
真实 CSP，所以从未复现用户环境。第三轮把真实 CSP 加进探针页后**一次复现**，
并用 `securitypolicyviolation` 事件抓到 `connect-src <= data` × N。

**修法**：`index.html` 的 CSP `connect-src` 增加 `data: blob:`（data: 是本页自身内联内容、
无外联能力，放行风险可忽略），并就地写明事故原因。

**验收**
- 探针页改用**修改后的真实 CSP** + **构建产物**（file:// 加载）：CSP 违规 = `[]`，
  截图家具全部正常（书柜/桌/椅/显示器/盆栽/垃圾桶/纸箱/落地灯/小植物）
- 守卫【175】新增：断言 `connect-src` 必须含 `data:`（防回归；这条只在构建产物暴露，
  必须机器守住）
- tsc 双 0、vite build 通过、预检 0 真红
