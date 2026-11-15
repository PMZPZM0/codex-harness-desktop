---
id: 2026-11-15-incident-重启安装只关应用不装差分-pending-包被当普通-exe-spawn弹出的是交互向导
date: 2026-11-15
kind: incident
area: release
title: 重启安装只关应用不装：差分 pending 包被当普通 exe spawn，弹出的是交互向导
tags: [update, electron-updater, nsis, differential, release]
commits: []
files: [electron/updates.ts, electron/features/updates-ipc.ts, scripts/guards/12h-update-persistence.mjs]
importance: high
---

# 重启安装只关应用不装：差分 pending 包被当普通 exe spawn，弹出的是交互向导

# 「重启安装」只关了应用、不装：差分 pending 包被当成普通 exe spawn，弹的是交互向导

## 背景

11-15 用户报（两句话拼起来就是完整现象）：
「差分补丁更新流程有点问题，我点击重启更新，就重启了，也不行更新安装」
→ 随后补充「那个安装提醒刚刚出来，然后应用关闭了」。

当时我不知道的：
1. 「安装提醒」不是报错，是 **NSIS 交互式安装向导 / UAC 提权框**。本仓 `nsis.oneClick=false`
   + `allowToChangeInstallationDirectory=true` ⇒ 安装器**默认就是向导模式**，除非传 `/S`。
2. 差分下载（electron-updater）拿到的那个 `pending\*.exe` **不是"随便 spawn 就能装"的文件**：
   它必须由**下载它的那个 autoUpdater 实例** `quitAndInstall(true, true)` 来装 ——
   只有这条路径会带 `/S`（静默）+ `--updated`（覆盖更新，装完自动拉起新版本）。
3. 原实现不看来源，一律 `spawn(path, [], {detached})` + `app.quit()`：
   ⇒ 向导弹出、应用同时退出 ⇒ 向导被挡在后面/被用户当垃圾关掉 ⇒ 什么都没装，
   用户视角就是「应用关了、提醒闪一下、版本没变」。回退路径（完整包）同样缺 `/S` 与 `--updated`。

## 结论

1. **差分就绪 ⇒ 交给 updater 自己装**：`updates.ts` 在 `downloadUpdate()` 成功后记住那个实例
   （`differentialUpdater`），导出 `hasPendingDifferential()` / `quitAndInstallDifferential()`；
   `updates:restart-install` 优先调它（`quitAndInstall(true, true)`），**不再** `app.quit()`（updater 自己退）。
2. **完整包 / 回退路径必须 `["--updated", "/S"]`**：`/S` 静默（否则就是用户看到的那个向导），
   `--updated` 让 electron-builder 模板在装完后自动拉起新版本。缺任一个都会退化成「装完没反应」。
3. `quitAndInstall` 抛错（dev 未打包 / pending 被清）→ **回退 spawn** 并 `console.warn`，不静默吞。
4. 顺序纪律不变：先起安装动作、再退出自己（`quitAndInstall` 内部就是这个顺序）。

## 依据

- `electron/features/updates-ipc.ts` 原实现：`spawn(lastVerifiedUpdatePath, [], …)` + `app.quit()`；
  `electron/updates.ts` 的 `downloadUpdateDifferential` 注释明确写着「**不安装** —— 安装仍走
  `updates:restart-install`，保持先起安装包再退出」⇒ 把 updater 的 pending 包当普通安装包用了。
- `package.json build.nsis` = `{oneClick:false, allowToChangeInstallationDirectory:true, include:"build/installer.nsh"}`
  ⇒ 无 `/S` 必弹向导；`build/installer.nsh` 里的 `preInit` 还会 `taskkill /F /T` 强杀同名进程，
  解释了「应用关闭」这一步。
- 本机取证：`%LOCALAPPDATA%\codex-harness-desktop-updater\pending\` 为空、
  `Downloads\codex-harness\` 为空、`%LOCALAPPDATA%\Programs\` 下没有安装目录
  ⇒ 安装器确实**没有走完安装**（不是"装了但用户开旧版"）。
- 守卫 `12h-update-persistence.mjs` 46/46（新增 3 条：差分必须走 quitAndInstall、
  `quitAndInstall(true,true)` 参数、回退 spawn 必须带 `--updated /S`）；
  `verify-update-safety.mjs` 14/14；`check-preflight` 通过；`npm run build` 通过。
- ⚠️ 顺带修掉一条**假红**：该守卫用裸 `indexOf("app.quit()")` 定位，本轮注释里写了
  「这里不许再 app.quit()」就被命中 ⇒ 判成「先 quit 再 spawn」。已改成先 `codeOnly` 剥注释再定位
  （本仓第五次同型坑）。

## 影响面

- 差分更新与完整包更新的**安装阶段**（`updates:restart-install`）；下载/校验/镜像选择未动。
- 打包版：点「重启安装」→ 静默装 → 自动拉起新版本（用户不再面对向导）。
- 源码实例（未打包，本机就是这种）：`quitAndInstall` 会抛错 → 回退 `--updated /S` 静默装到默认目录，
  装完由安装器拉起**打包版**；之后再点「检查更新」看到的仍是源码实例的版本号（这是两种运行形态的差异，
  不是更新失败）。
- 安全口径未变：仍只接受主进程校验过的那个包（`lastVerifiedUpdatePath`），渲染层换不掉路径。

## 回滚

把 `updates:restart-install` 恢复成单一 `spawn(path, [], …)` + `app.quit()`，删掉
`hasPendingDifferential` / `quitAndInstallDifferential` 两个导出；守卫 12h 的三条新断言一并删掉
（保留 codeOnly 锚点修复 —— 那条与本次功能无关，是修假红）。
