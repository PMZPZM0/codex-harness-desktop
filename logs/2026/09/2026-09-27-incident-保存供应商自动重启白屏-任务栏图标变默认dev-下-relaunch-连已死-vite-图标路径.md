---
id: 2026-09-27-incident-保存供应商自动重启白屏-任务栏图标变默认dev-下-relaunch-连已死-vite-图标路径
date: 2026-09-27
kind: incident
area: engine
title: 保存供应商自动重启白屏 + 任务栏图标变默认：dev 下 relaunch 连已死 vite / 图标路径单源（guard174）
tags: [relaunch, white-screen, icon, dev, concurrently, guard174]
commits: []
files: [electron/features/app-diagnostics.ts, electron/features/window-factory.ts, scripts/guards/06-app-behavior.mjs]
importance: high
---

# 保存供应商自动重启白屏 + 任务栏图标变默认：dev 下 relaunch 连已死 vite / 图标路径单源（guard174）

修「保存供应商 → 自动重启 → 白屏 + 任务栏图标变默认」（用户实测两连，同一根因）。

**根因（探针实证）**
1. **白屏**：dev 启动脚本 `concurrently -k "vite" "wait-on tcp:5173 && electron ."`，
   `-k` 让旧 electron 一退出就把 vite 一起杀掉；而 `app.relaunch()` 让新实例
   **继承 VITE_DEV_SERVER_URL=http://localhost:5173** ⇒ 连已死的 vite ⇒
   `did-fail-load code=-102 ERR_CONNECTION_REFUSED` ⇒ DOM 全空 = 白屏。
   实证：探针日志 `did-fail-load -102` + `DOM 文本: ""`。
2. **图标**：`window-factory` 只认 `app.getAppPath()/build/icon.ico` 一条路径；
   relaunch 等场景 appPath 不落在仓库根 ⇒ existsSync=false ⇒ `icon: undefined`
   ⇒ dev 无 AUMID 兜底 ⇒ 任务栏回退 Electron 原子图标。

**修法（保留重启语义，只修失败）**
- `app:relaunch`：dev 下**摘掉 VITE_DEV_SERVER_URL**（`delete process.env.…`），
  新实例走 loadFile(dist) 一定加载成功；打包版无该变量、不受影响。
- `window-factory`：dev URL 加载失败**回落本地 dist**（第二道保险，宁可看构建版不白屏）。
- `window-factory`：窗口图标**多源兜底**（appPath / execPath 上溯两档 / cwd，取首个存在的）。
- 保留 `app.quit()` 优雅退（before-quit 清理链，避免打断任务栏图标）。

**验收**
- 守卫【174】4 条全绿（锚接线与多源兜底，不锚文件存在）
- 端到端实证：修复前场景（dev URL 死端口）`ERR_CONNECTION_REFUSED` → 回落生效仍有 DOM；
  修复后场景直接 loadFile 成功；图标兜底链**两场景均命中** build\icon.ico
- 探针实测 execPath 上溯两档指向真实图标 ✓
- tsc 双 0、vite build 通过、预检非 team-office 域 0 真红

**保留不变**：保存供应商仍会重启应用（用户 09-27 明确要求保留该交互）；
引擎侧 `custom-model:save → applyCustomModel() → server.restart()` 原地重载不变。
