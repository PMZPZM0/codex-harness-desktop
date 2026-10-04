---
id: 2026-10-04-decision-界面草图嵌第三方静态产物-sketch-协议而不是并源码
date: 2026-10-04
kind: decision
area: ui-sketch
title: 界面草图：嵌第三方静态产物 + sketch:// 协议，而不是并源码
tags: [架构, 板块, iframe, 协议]
commits: []
files: [public/sketch, electron/sketch-protocol.ts, scripts/build-sketch-bundle.mjs, scripts/sketch-bridge.js]
importance: normal
---

# 界面草图：嵌第三方静态产物 + sketch:// 协议，而不是并源码

## 背景
用户要把开源项目 **m3e-canvas**（Material 3 Expressive 屏摄画布，Next.js 16 + React 19 + Tailwind v4，MIT）
做成应用里的新功能板块，并明确要求「直接嵌入到应用里面，反正就 1.4MB，按它原来的布局和功能做一个弹窗展示」，
同时把**我们自己的组件库**接进去，让前端开发更快。板块必须是独立的（用户反复强调的一条纪律）。

## 结论
1. **不并源码，提交它的静态导出产物** `public/sketch/`（4.2MB，含本地化字体），布局与功能一字不动。
2. 用**新的只读自定义协议 `sketch://app/`** 加载，弹窗宿主 = `src/features/ui-sketch/UiSketchModal.tsx`（iframe + 组件库侧栏）。
3. 双向通道 = 我们自己的 `scripts/sketch-bridge.js`（构建时内联进产物的 index.html）+ postMessage；
   **写方向复用上游自己的导入机制**（`#doc=` → hashchange → `arrive()`，可撤销、不重载）。
4. 组件库融合**不复制第二份数据**：右侧面板直接用基座 `src/lib/ui-skin`（`loadCategory`），
   勾中的组件追加成一个新 group，引用锚写进 item 的 `note`（上游文档明确 note 原样进它导出的提示词）。
5. 侧栏「···更多」收纳五项：AI 画布工作流 / 界面草图 / 知识库 / 组件库 / 人格市场。

## 依据
- **为什么不并源码**：实测上游 `app/ components/ lib/` 共 **30,722 行 TS/TSX**（`app/Editor.tsx` 单文件 4,861 行），
  且自带 Tailwind v4 + 一整套 Material 3 色板 ⇒ 进本仓等于在设计体系里再塞一个体系，
  【170】的色板真值对账与【265】的巨型文件棘轮都会当场失焦。
- **为什么必须自定义协议**：产物里资源引用**全是站点根绝对路径**（`/_next/static/chunks/*.js`、`/material-symbols.json`），
  `file://…/dist/sketch/index.html` 会把它们解析到文件系统根 ⇒ 全站 404。`sketch://app` + `standard: true` 才有"站点即根"。
- **为什么不复用 `harness-image` / `pet`**：两者扩展名白名单只放图片（`boot.ts` 里 `.html/.js/.css` 直接 415）；
  放宽它们 = 扩大任意文件读取面，安全回归。新协议的根恒等于打包内 `dist/sketch`，能读的文件集合与"随包只读资源"重合。
- **`secure: true` 不是摆设**：上游用 `navigator.locks` 做单写者锁（`Editor.tsx` 的 editAccess 判定），
  非安全上下文里该 API 不存在 ⇒ 静默降级（与 `pet://` 的 CSP 事故同型）。
- **字体必须本地化**：`app/layout.tsx` 引的是 `fonts.googleapis.com` 的 Roboto + **Material Symbols Rounded**；
  后者是这套 UI 的**全部图标**（连字文本），取不到就渲染成 `home` / `add_circle` 这样的单词，看着像坏了。
- **产物只能落 `public/`**：`scripts/clean-dist.mjs` 每次 check 会 `rmSync(dist)`；
  而 `before-pack.cjs` 的可达闭包只遍历 `dist/assets` ⇒ `dist/sketch` 天然不被裁（同 `public/pets` 口径）。
- **实测踩到并已被判据钉住的两个坑**（都有变异/真跑证据）：
  ① 构建脚本用整文件正则改字体链接时，把 body 里的 React flight 数据（`self.__next_f.push([1,"…"])`，
     其中原样嵌着 `<head>` 的元数据标记）咬断 ⇒ 草图永远停在骨架屏，症状是
     `Uncaught SyntaxError: Invalid or unexpected token @index.html:118`；现在改动只允许发生在 `</head>` 之前，
     且脚本自检「`</head>` 之后逐字节没动」，判据也只扫 head 区。
  ② CSP 断言最初拿**整份 index.html** 去匹配 `frame-src … sketch:`，被讲解注释顶成**恒真**
     （摘掉真指令后照样绿）；改为只取 meta 的 content 字面量本体后变异测试才报 ✗。
- 判据：守卫 `scripts/guards/11h-ui-sketch.mjs` 67 条（含**真跑** `resolveSketchFile` 的越界/越类型/404/MIME，
  与 `sketch-doc.mjs` 的追加、幂等、编码、提示词预算）；验收项 `ui-sketch` 8 条（真产物里点到底，
  含「编辑器真挂载并把画布内容读回宿主」——桥应答本身不算，它内联在 head 里，骨架屏阶段就能应答）。

## 影响面
- 新增：`electron/sketch-protocol.ts`（协议根 / MIME 白名单 / 路径校验）、`electron/main.ts` 多一条 privileged scheme、
  `electron/features/boot.ts` 多一行 `protocol.handle`、`index.html` 的 CSP `frame-src` 加 `sketch:`。
- 新增板块 `src/features/ui-sketch/`（4 文件 / 477 行，**零 IPC** ⇒ manifest / ipc-registry / capability skill 都不动）。
- bag 多一位 `uiSketchOpen`（与 `dramaCanvasOpen` 同档：只挂"开没开"）⇒ `bag-types.ts` +2 行（【265】基线已同步）。
- 侧栏导航区少两个平铺入口（知识库 / AI 画布工作流），换成一个「···更多」；【180】的 hub 窗口尾锚同步换成 `{moreHubOpen &&`。
- 随包体积 +4.2MB（远低于 50MB 内置口径）；`public/sketch/` 是**提交进仓库的第三方产物**，
  刷新只能靠 `node scripts/build-sketch-bundle.mjs`（人工工具，不进 check / CI：要联网 + Next 工具链）。

## 回滚
删四处即可，无数据迁移：① `src/features/ui-sketch/` + `src/styles/26-ui-sketch.css` + `styles.css` 那一行 @import；
② `public/sketch/` + `scripts/sketch-bridge.js` + `scripts/build-sketch-bundle.mjs`；
③ `electron/main.ts` 的 privileged 条目与 `electron/features/boot.ts` 的 `protocol.handle` + `electron/sketch-protocol.ts`；
④ `index.html` CSP 的 `sketch:` 与守卫 `11h-ui-sketch.mjs`（含 check 链里那一行）。
侧栏若要回到平铺：把两个按钮搬回 `.sidebar-tabs` 并同步【180】/【283】的负向断言。
草图内容存在 e2e/用户 profile 的 `localStorage["m3e:doc"]` 里，删板块不会动它。

## 未做 / 待办
- 「送进草图」目前把组件写成 `note` 锚点 + 占位 kind（Buttons→button、loaders→box 等 11 类映射），
  **不是**把 Uiverse 控件的真实外观画在草图上；要在画布里显示真控件得改上游渲染层（= 开始 fork），未经用户点头不做。
- 没有把草图落盘到工作区（零 IPC），所以引擎侧暂时只能靠「交给 Codex 实现」把结构 + 组件源码送进会话；
  要做 `sketch:save` / MCP 工具得先加 IPC 域（manifest + registry + capability skill 三处同步）。
- 上游 `agent.md` 那份「给编码代理读的草图文档格式说明」已随产物在 `sketch://app/agent.md`，
  但还没写进 `harness-api` 技能 / 常驻指令 —— 引擎目前不知道可以手写文档喂草图。

