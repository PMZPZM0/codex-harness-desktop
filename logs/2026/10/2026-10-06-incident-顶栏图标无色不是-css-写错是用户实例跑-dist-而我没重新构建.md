---
id: 2026-10-06-incident-顶栏图标无色不是-css-写错是用户实例跑-dist-而我没重新构建
date: 2026-10-06
kind: incident
area: 外观
title: 顶栏图标无色：不是 CSS 写错，是用户实例跑 dist 而我没重新构建
tags: [图标, BUILD, dist, 色板, 踩坑]
commits: [3894481]
files: [src/styles/19-misc-hints.css, src/features/app-state/parts/part09/02-seg.tsx, scripts/guards/11v-icon-palette.mjs]
importance: high
---

# 顶栏图标无色：不是 CSS 写错，是用户实例跑 dist 而我没重新构建

## 需求

用户报「没生效嘛，还是没有颜色」（顶栏图标仍无色）。

## 根因（**不是 CSS 写错**）

用户那个实例加载的是**构建产物 `dist/`**（`netstat` 确认 **5173 没在监听** ⇒ 不是 vite dev/HMR 模式）。
上一轮（`1a2381a`）我只跑了守卫 + `tsc -b`，**没跑 `npm run build`** ⇒ dist 里的
`.icon-button` 还是旧的 `color:var(--muted)`。
实证：旧 dist CSS 里 `\.icon-button{...color:var(--muted)...}`，没有 `var(--ic,`。
（第一轮之所以"看起来生效"：那轮的 `npm run check` **顺带** build 了 dist。）

⇒ 本轮 `node scripts/clean-dist.mjs` + `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run build`。

## 顺带修掉两处「挂了 ic-* 也会被盖掉」的真冲突

| 位置 | 毛病 |
|---|---|
| `.popout-open-btn:not(:disabled):hover`（19-misc-hints.css） | 权重 (0,3,0) > `.icon-button:hover` (0,2,0) ⇒ 一悬停就把 ic-violet 刷成主色 |
| `.popout-return-btn`（返回主应用） | **故意**保持主色（唯一动作不是分类）⇒ 撤掉我上一轮加的 `ic-violet`，写负向断言 |

## 真跑取证（构建产物 + 隔离 profile + CDP `getComputedStyle`）

    .tb-workspace        ic-amber  → rgb(232,131,12)
    .history-search-wrap button ic-cyan → rgb(11,114,133)
    .popout-open-btn     ic-violet → rgb(112,72,232)
    .tb-task-menu        ic-green  → rgb(26,127,55)
    .tb-right-panel      ic-blue   → rgb(47,107,221)
    .dispatch-topbar-btn 无 ic-*   → rgb(111,111,105) 即 --muted（**故意**：状态色）
    .sidebar-tab.ic-blue / .sidebar-settings → rgb(47,107,221)

用项目自带 harness：`scripts/e2e/lib/harness.mjs`（`ElectronHarness`）—— 空 profile 会停在登录页，
**必须先点 `.login-skip`**（"暂不登录，直接体验主界面"）才会渲染 `.topbar`。
取证脚本留在 `.workbuddy/tmp/verify-icon-colors.mjs`（一次性，未入库）。

## 守卫

`11v-icon-palette` 36 → **38/38**（新增：更具体的 hover 也必须读 `var(--ic,…)`；返回钮负向）。
⛔ 真跑抓到一条**自己顶红**的断言：19-misc-hints.css 里那条规则上方的**注释**写着
「不挂 ic-*、不加 var(--ic)」⇒ 负向断言读到自己注释里的字面量 ⇒ 改为先 `codeOnly()` 剥注释
（11u 里记过的同一个坑，这次在 CSS 上又踩一次）。

## ⛔ 长期教训（已进 MEMORY.md）

**用户实例跑 dist ⇒ 改渲染层必须 `npm run build`（只跑守卫不算）。**
`npm run check` 会顺带 build，所以链断了（本轮断在并行线的 11h）也要**单独 build 一次**。
