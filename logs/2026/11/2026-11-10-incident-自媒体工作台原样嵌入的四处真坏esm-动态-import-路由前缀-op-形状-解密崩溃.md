---
id: 2026-11-10-incident-自媒体工作台原样嵌入的四处真坏esm-动态-import-路由前缀-op-形状-解密崩溃
date: 2026-11-10
kind: incident
area: media-desk
title: 自媒体工作台原样嵌入的四处真坏：ESM 动态 import / 路由前缀 / op 形状 / 解密崩溃
tags: [media-desk, embed, tsc, esm]
commits: []
files: [electron/features/media-desk/embed.ts, electron/features/media-desk/tool.ts]
importance: normal
---

# 自媒体工作台原样嵌入的四处真坏：ESM 动态 import / 路由前缀 / op 形状 / 解密崩溃

## 背景
用户令「审查一下」。对上一轮「开源原版界面原样嵌入」做实测复核（真 Electron 探针 + 验收项），挖出四处「结构看着接好了、跑起来必坏」的缺陷。

## 结论
① tsc（module=CommonJS）把 `import()` 降级成 `require()`，而 `resources/media-desk/host/host.js` 是 ESM 且用 file:// URL 传入 ⇒ 随包宿主永远加载失败。修法：`nativeImport = new Function("specifier","return import(specifier)")` 保住原生动态 import。
② `mediaDeskRequest` 直接用 `pathname` 拼 endpoint（`/state`、`/ops`），缺上游的 `media-desk/` 路由前缀 ⇒ Codex 工具全部 404。修法：统一拼 `media-desk/${pathname}`。
③ 上游 op 是**扁平字段**（`{op:"add_item", title, body…}`），工具套了一层 `{op, item:{…}}` ⇒ 被判「灵感内容为空」。修法：`{op:"add_item", ...item}`。
④ e2e 持久档案里 `safeStorage.decryptString` 抛错（密钥来自原档案）⇒ 整个工作台启动失败。修法：解密失败按「无 Key」继续（页面照常打开，生成时再报模型错误）。
同轮加固：随机令牌前缀 `/t/<TOKEN>/` + Host 头校验（防本机 CSRF/DNS rebinding）、30s 请求超时、启动失败清 Promise、工具语义对齐上游（capture→capture-url、styleId→set_style、postId→schedule_item）、schema 删除未实现参数、React 包改生产压缩（1.2MB→219KB）。

## 依据
- 编译产物实测：`dist-electron/features/media-desk/embed.js` 原为 `Promise.resolve(...).then(s => require(s))`。
- 真 Electron 探针（隔离 userData）：修复前 host 加载即 `Cannot find module 'file:///…host/host.js'`；修复后 `state-items 25`、capture/schedule/undo 全通过；无令牌 404、伪造 Host 403。
- 验收 `media-desk`：修复后 7/7，iframe target 读到上游界面文字「灵感 内容 排期 复盘 风格」。
- 解密崩溃：验收持久 profile 实报 `Error while decrypting the ciphertext provided to safeStorage.decryptString`。

## 影响面
- `electron/features/media-desk/embed.ts`、`tool.ts`、`electron/features/dispatch-core.ts`（media_desk schema）。
- `resources/media-desk/index.html`（相对脚本路径）、`react.bundle.js`（生产压缩包）。
- 守卫 `scripts/guards/12bi-media-desk.mjs` 19→22 条（8 处变异全抓）；新增验收项 `media-desk`。

## 回滚
回退本轮提交即可；数据格式未变（`userData/media-desk-host/media-desk/state.json` 仍是上游 Store 原格式）。
