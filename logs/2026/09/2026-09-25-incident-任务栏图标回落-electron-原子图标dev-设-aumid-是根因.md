---
id: 2026-09-25-incident-任务栏图标回落-electron-原子图标dev-设-aumid-是根因
date: 2026-09-25
kind: incident
area: icons
title: 任务栏图标回落 Electron 原子图标（dev 设 AUMID 是根因）
tags: [icons, aumid, taskbar]
commits: []
files: [electron/main.ts]
importance: high
---

# 任务栏图标回落 Electron 原子图标（dev 设 AUMID 是根因）

## 背景
用户 09-24/09-25 反复报「任务栏图标又变成默认的」。前一轮我误判为「调试实例污染 + 图标缓存」。

## 结论
真根因是 **dev 也在设 AUMID**。Windows 只在 AUMID 能解析到「注册了同一 AUMID 的快捷方式」时才用它；
解析失败会回退进程 exe 图标，**并完全忽略窗口图标**（BrowserWindow.icon 白设）。dev 的 exe 是
electron.exe ⇒ 原子图标。而该前提在本机实测**不成立**（Get-StartApps 里没有本应用）。
⇒ 改为仅在 app.isPackaged 时设置 AUMID。

## 依据
A/B 实证：同一份 build/icon.ico、同一个窗口，仅差一行 AUMID —— 任务栏截图 md5 逐像素比对：
不设 AUMID → 我们的图标；设 .dev AUMID → 与真实应用相同的原子图标。
（守卫【2】改判为负向断言「dev 不得设置 AUMID」。）

## 影响面
electron/main.ts 的 setAppUserModelId 分支；打包版不受影响（NSIS 写规范快捷方式）。

## 回滚
恢复 dev 分支的 .dev AUMID —— 会重新出现原子图标（已验证）。
