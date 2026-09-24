---
name: renderer-crash-triage
description: 用户报「界面崩溃 / 白屏 / 界面发生错误 / 老是崩溃」时的定位流程 —— 先分清主进程崩溃还是渲染层拦截，再按报错类型分叉（lazy chunk 加载失败 vs 渲染异常）。当用户发来崩溃截图或说「老是崩溃」时用它。
---

# 渲染层崩溃定位

## 何时用
- 用户发来崩溃截图，或说「老是崩溃 / 白屏 / 界面发生错误」

## 步骤
1. **看报错类型**（决定分叉）：
   - `Failed to fetch dynamically imported module` ⇒ lazy chunk 加载失败，走 2→3→4
   - 其它渲染异常 ⇒ 看 stack，多半是组件逻辑 bug
2. **分清层级**（先别猜）：查主进程崩溃日志
   `Test-Path "$env:APPDATA\Codex Harness Desktop\voice-crash.log"`
   —— **文件不存在 = 主进程级崩溃 0 次**，你看到的是渲染层 ErrorBoundary 卡片（`logCrash` 只写这一个文件）
3. **chunk 加载失败的关键判据**（两条命令定生死）：
   ```powershell
   Test-Path 'dist\assets\<报错里的文件名>'    # False = 这个 chunk 已经没了
   Get-ChildItem dist\assets -File | Group-Object { $_.LastWriteTime.ToString('HH:mm') }
   ```
   所有文件同一个时间戳 ⇒ 那次 build 清空重建过（vite 默认 `emptyOutDir=true`）
4. **查兜底是否存在**：`Select-String -Path dist\assets\*.js -Pattern 'vite:preloadError' -List`
   —— 命中 = 自愈已进包；0 命中 = 运行实例加载的是旧产物，需**重启应用**

## 坑
- ⛔ **别急着判定"是渲染 bug"**：先确认是不是**你自己刚跑过 build**（`npm run check` 含 `npm run build`）—— 09-23 那次崩溃就是收尾跑 check 造成的，运行中实例的旧 chunk 被清掉。
- ⛔ **渲染层错误原先不落盘**（只 `console.error`）⇒ 查历史只能靠截图；09-23 已加 localStorage `__ui_errors`（最近 20 条）+ 错误卡片上的「复制诊断信息」按钮。
- **产物重建 ≠ 运行实例更新**：改源码后必须**重启应用**才生效（跑着的进程加载的是启动时的产物）。

## 判据
- 说清三层：哪一层（主进程 / 渲染层）+ 哪一类（chunk 加载 / 渲染异常）+ 是否与某次 build 相关
- 修复后给出可验证判据：产物里能 grep 到新代码（`Select-String -Path dist\assets\*.js`）+ 用户重启后原复现步骤不再崩