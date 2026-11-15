---
id: 2026-11-15-incident-卸载确认弹窗点了不关关闭时机被-await-推后-卸载期间卡片谎报正在安装
date: 2026-11-15
kind: incident
area: devtools
title: 卸载确认弹窗点了不关（关闭时机被 await 推后）+ 卸载期间卡片谎报正在安装
tags: [devtools, uninstall, dialog, openmaic, inertia]
commits: []
files: [src/features/settings-devtools/OpenMaicCard.tsx, src/features/settings-devtools/ApkStartCard.tsx, src/features/settings-devtools/HuskCard.tsx, src/features/settings-devtools/FeishuCliCard.tsx, src/features/settings-devtools/FileeCard.tsx, electron/features/runtime-ipc.ts, scripts/guards/11y-devtools-fallback.mjs]
importance: high
---

# 卸载确认弹窗点了不关（关闭时机被 await 推后）+ 卸载期间卡片谎报正在安装

# 卸载确认弹窗点了不关（关闭时机被 await 推后）+ 卸载期间卡片谎报「正在安装」

## 背景

11-15 用户连报三次卸载问题，最后一张截图是：点了 OpenMAIC 卸载确认弹窗里的「卸载」，
**弹窗一动不动**。当时我不知道的有两点：

1. 弹窗不关**不是卡死**，而是代码把 `setUninstallOpen(false)` 写在了 `await uninstallDevRuntime()` 之后
   ⇒ 只要卸载没跑完，弹窗就一直杵着（5GB 目录 + 几十万小文件，几十秒到几分钟）。
2. 更要命的是**看起来完全合理**：用户看到「弹窗没反应」就会再点几次，而按钮其实已经 disabled，
   于是主观上就是「点了没用 / 应用死了」。上一轮修的「主进程同步遍历把事件循环堵死」
   只是这条链的一半 —— 即使主进程不堵，弹窗照样不关。
3. 还有一个躲在同一处的谎：`bag.uninstallDevRuntime()` 为了「全局一次只跑一个」的锁，
   同时置了 `runtimeInstalling = id`，而五张卡片的忙态判据一律是
   `const installing = runtimeInstalling === "<id>"` ⇒ **卸载期间整行显示「正在安装（5–10 分钟）…」**，
   进度条标题也是「安装进度」。用户看到的文案与自己的操作完全相反。

## 结论

1. **点「卸载」= 立即关弹窗，再做卸载**（5 张卡统一）：`onClick` 里同步
   `setUninstallOpen(false)` 后 `void uninstall(purge)`；`purge` 用**入参**传（`setPurgeData` 是异步的，
   函数体里读 state 会读到复位值 ⇒「同时删课程数据」那个勾会丢）。
2. **卸载函数体里不再关弹窗** —— 关窗时机永远是点击那一刻，不等 IPC 回执。
3. **忙态判据减掉卸载那一位**：`const uninstalling = runtimeUninstalling === id;`
   `const installing = runtimeInstalling === id && !uninstalling;`，行内进度条对两者都显示，
   文案/阶段兜底按状态分叉（卸载时「正在统计要删除的文件…」/「正在删除文件」）。
4. 主进程侧补两处「看起来在动」：`removeTargetsWithProgress` 在**统计阶段**就先发一条
   `stage: "正在统计要删除的文件"`（20 万小文件遍历要十几秒，原来一条事件都不发），
   删除从**逐个 await** 改成 **32 路并发**（总耗时从分钟级降到秒级；失败计数与首个失败样本语义不变）。

## 依据

- 用户截图：卸载确认弹窗（「会删除本机安装的 OpenMAIC 程序…约 5GB」+「同时删除课程库与数据库」勾选框）点「卸载」后原样停留。
- 改前代码：`src/features/settings-devtools/OpenMaicCard.tsx` 的 `uninstall()` 末尾才 `setUninstallOpen(false)`；
  同类写法还有 `ApkStartCard.tsx` / `HuskCard.tsx`（飞书 CLI 与 Filee 早就写在 onClick 里，是本轮的正确样板）。
- 真机验收（本机真实 userData，`CODEX_HARNESS_DEBUG_PORT=9333` + CDP 探针）：
  - 确认弹窗在点击「卸载」后 **106 ms** 关闭（改前 = 删完才关；apkstart 实测删除耗时 616 ms，OpenMAIC 规模要长两个数量级）。
  - 行内文案立即变为「正在卸载（删除程序文件；删完这张卡自动变回「未安装」）…」+ 进度条「正在删除文件 · 100%」，按钮显示「卸载中」。
  - `apkstartStatus().installed` → `false`，随后 `installRuntime("apkstart")` 装回成功（恢复测试前状态）。
- 守卫：`scripts/guards/11y-devtools-fallback.mjs` 新增两条（5 张卡）——
  ① 确认按钮单击里同步关窗再 `void uninstall(`；② `uninstall*` 函数体内不许再出现 `setUninstallOpen(false)`。
  变异测试（对 `git show HEAD:` 的旧文件跑同一组判据）：OpenMAIC / ApkStart / Husk 三条红，飞书 / Filee 绿
  ⇒ 判据不是恒真。
- `scripts/guards/09-structural.mjs` 棘轮按实测记账 1277 → **1279**（净代码行口径，`netCodeLines` 实测）。

## 影响面

- 五张开发工具卡（OpenMAIC / ApkStart / Husk / 飞书 CLI / Filee）的卸载交互与忙态文案；
  以及它们共用的 `runtime:uninstall` 主进程删除循环（并发化后所有工具的卸载都更快）。
- ⚠️ 并发删除是 32 路 `fs.rm`：Windows 上「文件被占用」的判定仍是逐文件 try/catch 计数，
  未改成「先整目录 rename 再删」，所以被占用时的失败样本与提示文字与原来一致。
- ⚠️ 遗留：本机 `tools/openmaic` 有 348MB 残留但 marker 已丢（`openmaicStatus().installed === false`），
  即上一次失败的安装/卸载留下的孤儿目录。卡片会显示「安装」，重装会重新下载并换入新目录。

## 回滚

- 前端：把 `onClick` 里的 `setUninstallOpen(false)` 移回 `uninstall()` 末尾即可回到旧行为（但那条 bug 也会回来）。
- 主进程：`flush()` 里的 32 路 `Promise.all` 换回 `for (const file of pending) { await fs.rm(...) }`；
  统计阶段的 `sendToWindow` 一条删掉。棘轮数字要跟着回 1277。
