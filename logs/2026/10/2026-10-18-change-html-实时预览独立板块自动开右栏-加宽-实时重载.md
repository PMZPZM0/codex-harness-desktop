---
id: 2026-10-18-change-html-实时预览独立板块自动开右栏-加宽-实时重载
date: 2026-10-18
kind: change
area: ui
title: HTML 实时预览独立板块（自动开右栏 + 加宽 + 实时重载；只在生成时打开）
tags: [html-preview, preview, watch, webview, history-replay]
commits: [585c8d0]
files: [electron/features/html-preview-ipc.ts, src/features/html-preview/HtmlPreviewBridge.tsx, src/lib/html-preview-store.mjs, src/lib/file-url.mjs, src/components/BrowserPane.tsx, src/features/app-view/AppView.tsx, scripts/guards/12t-html-preview.mjs, scripts/accept.mjs]
importance: normal
---

# HTML 实时预览独立板块（自动开右栏 + 加宽 + 实时重载；只在生成时打开）

## 背景
用户 10-18：「我想加一个功能，新功能就是独立板块哦，就是写 html 文件的时候，自动打开右边浏览器，
会话窗口可以自动缩小一点比例，把右边展示全，实时渲染 html 内容可以吗」。

同日实测反馈（截图：右栏自动打开了会话里已有的「余杭·良渚一日路线」HTML）：
「只有生成的时候，才自动打开，正常我进去不要每次都打开对话框里面已有的 html 文件」。

## 结论
- 新独立域 **`html-preview`**（`electron/features/html-preview-ipc.ts`）：
  - `html-preview:watch` / `unwatch` 只盯一个文件；
  - 可信根 + `.html/.htm/.xhtml` 白名单；监听**目录**按 basename 过滤（原子保存不跟丢）；
    120ms 防抖；`persistent:false`；换文件 / 卸载 / 退出 close；
  - 变更广播 harness 事件 `html-preview:changed`；主进程不读正文（渲染交给 webview）。
- 新渲染板块 `src/features/html-preview/`：
  - `HtmlPreviewBridge` 在 `AppView`（主窗口）挂一次，独立弹窗不挂；
  - 当前会话的回合文件变更里出现 HTML ⇒ 自动 `openInBrowserPane` + 右栏加宽到窗口 **45%
    （360~560px）** + 开始 watch；seen 集合防累计报告在两个 HTML 间来回跳；
  - **只认本会话 live 过的回合**：切回/重开会话时 `codex-ipc` 会把历史回合报告重播成
    同样的 `turn-file-changes` 事件；没有 live 记录的报告一律忽略 ⇒ **进入会话不会自动
    打开已有 HTML**（用户 10-18 实测的那条）；
  - 只认**当前会话**的回合（后台专家/被调度会话写 HTML 不抢右栏）。
- `BrowserPane`（基座）订阅**基座** `src/lib/html-preview-store.mjs`，文件变了用
  `reloadIgnoringCache()` 重载当前标签（普通 reload 会吃 file:// 缓存）；用户导航到
  别的网页时不抢。
- `toFileUrl` 下沉 `src/lib/file-url.mjs`（中文逐段编码 / 盘符冒号保留的 10-17 修复；
  `helpers/paths.ts` 原位置 re-export，⛔ 不再重复实现）。
- 分层：`src/components` 不反向 import 域（store 放基座）；`html-preview` 域不深链
  `app-state`（桥只依赖结构化 `HtmlPreviewHost`）；`AppView` 的 `.app-shell` 加
  `data-thread-id` 供验收读当前会话（切回测试用）。

## 依据
- 守卫 `12t-html-preview` **33 条**：纯函数（HTML 识别 / 选目标 / toFileUrl / store）、
  可信根、目录 watch、防抖、当前会话过滤、**只认 live 过的回合**、基座/域分层、
  manifest/registry/composition/preload、IPC 计数。
- 验收 `html-preview` **8/8**（真回合 + 测试进程写文件）：
  ① 新建任务 → ②a 右栏先收起 → ② 真回合跑起来 → ③ 写 HTML 自动打开右栏浏览器并加载
  `file:///...html-preview-acceptance.html` → ④ 宽度 308→**560** → ⑤ 改文件后 webview
  guest 标题 `preview-v1`→`preview-v2` 实时刷新 → ⑥ 切走再切回，历史报告重播**不**自动
  打开（`{"switched":1,"reopened":false}`）。
- 真机截图：右栏浏览器标签 + 文件 URL + 页面渲染（余杭路线示例）；自动加宽后消息区缩小。
- `npm run check` 只剩并行云同步线既有红（cloud 通道未登记 / cloud 域 id）与并行会话的
  CSS 变量红（`--field` / `--line-strong`），与本轮无关；棘轮 accept.mjs 2421→2507（实测净行）。

## 影响面
- 主进程：新域 `html-preview`（2 通道 + harness 事件），组合表启用、gen:domains 挂载。
- 渲染层：`HtmlPreviewBridge`（AppView 挂一次）、基座 store、`BrowserPane` 订阅重载。
- 基座：`file-url.mjs`（toFileUrl 下沉）、`html-preview-store.mjs`（跨层单例）。
- 生成物：preload / vite-env / harness-api（gen:ipc 产出）；拓展接口 IPC 计数 498。
- 未写 HTML 的会话：右栏行为完全不变；写 HTML 的会话：自动打开并加宽，切回不重开历史。

## 回滚
- 回退本轮提交：删 `html-preview` 域与组合表行、删渲染板块、恢复 BrowserPane 的订阅
  与 `helpers/paths.ts` 的本地 toFileUrl（或保留基座 re-export，均不影响既有功能）。
