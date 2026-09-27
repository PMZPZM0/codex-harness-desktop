---
id: 2026-09-27-incident-apprelaunch-硬退跳过-before-quit自动重启后任务栏图标变默认appexit
date: 2026-09-27
kind: incident
area: engine
title: app:relaunch 硬退跳过 before-quit：自动重启后任务栏图标变默认（app.exit → app.quit）
tags: [relaunch, icon, taskbar, app-diagnostics]
commits: []
files: [electron/features/app-diagnostics.ts]
importance: high
---

# app:relaunch 硬退跳过 before-quit：自动重启后任务栏图标变默认（app.exit → app.quit）

修复「保存供应商 → 自动重启 → 任务栏图标变默认」（用户实测复现）：

根因：app:relaunch 用 app.exit(0) 硬退——跳过 before-quit 全部清理
（closeConfirmed 不置真、托盘不销毁、引擎不停车），且旧进程瞬时死亡时
新实例已顶上，Windows 任务栏图标被顶成默认图标。

修复：app.exit(0) → app.quit()——走 main.ts 的 before-quit 优雅链
（closeConfirmed / destroyAppTray / cleanupAll / ssh / voice），旧进程
完全退出后新实例才起，任务栏图标重走窗口图标（dev）那条路。
