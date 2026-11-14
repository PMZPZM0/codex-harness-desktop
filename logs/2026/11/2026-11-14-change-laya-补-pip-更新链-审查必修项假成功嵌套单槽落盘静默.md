---
id: 2026-11-14-change-laya-补-pip-更新链-审查必修项假成功嵌套单槽落盘静默
date: 2026-11-14
kind: change
area: devtools
title: Laya 补 pip 更新链 + 审查必修项（假成功/嵌套/单槽/落盘静默）
tags: [laya, pip, devtools, husk, remote, review]
commits: [53dc7add5, 8f858befd]
files: [electron/features/runtime-ipc.ts, src/features/settings-devtools/LayaCard.tsx, src/features/settings-devtools/HuskCard.tsx, electron/remote-pairing-lock.ts]
importance: high
---

# Laya 补 pip 更新链 + 审查必修项（假成功/嵌套/单槽/落盘静默）

## 现象

用户在开发工具页打开「Laya 智能判断」卡片，只有「刷新 / 卸载」，没有任何更新入口，且卡片上的版本停在 v0.4.20（用户原话：「这里没有更新功能啊，这个好久没更新了」）。

## 根因

`runtime:update-check` / `runtime:update` 只有两条清单：`UPDATEABLE_TOOLS`（npm 包）与 `GITHUB_UPDATEABLE`（release 直下）。Laya / 手机控制 / markitdown 都是 **pip 包**，两条链都不认 ⇒ `checkRuntimeUpdateRow("laya")` 直接抛「该工具不支持在线更新」，卡片因此从来没人接更新行。

实测：本机 `pip show laya` = 0.4.20，PyPI 最新 0.4.31 —— 落后 11 个小版本。

## 方案

1. 新增 `PIP_UPDATEABLE`（只登记 `laya`，与实际有 UI 入口的工具一致，避免留死表项）。
2. `pipInstalledVersion(pkg)`：`bundledPython() + pip show` 解析 `Version:`（同步，20s 超时）。
3. `fetchPypiLatest(pkg)`：官方 `pypi.org/pypi/<pkg>/json` 与清华镜像同构 JSON 都试；**两边都失败就抛错**，界面显示「检查更新失败」，不假装「已是最新」。
4. `checkRuntimeUpdateRow` / `performRuntimeUpdate` 加 pip 分支，必须排在 npm 分支之前（否则先撞 `!UPDATEABLE_TOOLS[id]` 抛错）。升级复用 `layaInstall()`（已带 `-U`、多镜像回落、装后 `pipShow` 复核）。
5. ⛔ **pip 型不进 `updateableToolIds()`**：那张表被后台「自动更新」消费，laya 带 PyTorch 依赖（几百 MB 到上千 MB），不能无人值守重装。只做卡片里的手动检查/升级。
6. `RuntimeUpdateRow` 加 `cancellable`（pip 子进程没有中断钩子 ⇒ 传 false，界面显示「更新中」而不是点了没反应的取消键）。

## 同轮修掉的审查必修项（11-14 审查结论）

- **假成功**：Husk download 分支只判 `result.ok`，而 `runtime:install` 取消时返回 `{ok:true, cancelled:true}` ⇒ 用户点「取消」后模型会收到「已下载、SHA256 校验通过」。改走 `bag.installDevRuntime`（返回 boolean，且会置 `runtimeInstalling` 让卡片出现进度与取消），并按返回值判失败。
- **非法嵌套**：HuskCard 的「iPhone 连接」整行被塞进 TIPA 行的 `<span className="runtime-copy">` 里（`span > div`，4 列 grid 压进 1fr 列）。改为独立 `runtime-row`。
- **单槽互踩**：IPA / TIPA 共用 `runtimeInstalling` 单值，旧 `otherBusy = Boolean(runtimeInstalling) && !installing && !tipaInstalling` 恰好把两行都放行 ⇒ 点 TIPA 会让 IPA 行进度条与取消键消失。改为「任一在装即禁用」。
- **安全开关静默降级**：`setPairingLocked` 写盘失败只保留内存态且返回 true，界面宣称「已关闭」，重启后却能再被新设备配对。改为返回 `{locked, persisted}`，UI 明示「只在本次运行有效」。
- Optional：`pairSignKey` 空值不入缓存（否则首次读到缺失文件会让本进程永久不签名）；`mirror-download` 的 drain promise 收敛（abort 胜出后不留 unhandled rejection）；配对锁开关加 in-flight 保护。

## 判据

- `npm run build` 通过；受影响守卫单跑：`12bq 52` / `12bo 45` / `12bp 58`。
- 编译产物探针真跑：`laya_current=0.4.20`、`laya_latest=0.4.31`、`hasUpdate=true`；未登记工具仍被明确拒绝；`laya_in_auto_update_ids=false`。
- 界面实测（computer use）：Laya 卡显示「更新 / 有新版本 0.4.20 → 0.4.31 / 更新到 0.4.31」；Husk 卡六行各自独立对齐（下载 / 更新 / 侧载 / TrollStore / iPhone 连接 / 兼容性）。
- 三仓：PPcode `a1c5b79a`、云助手 `1db20d3d`（已部署云端界面，服务器哈希与本地产物一致），各自 `npm run build` 通过、守卫同绿。

## 回滚

pip 链是纯新增分支：删掉 `PIP_UPDATEABLE` 三项引用（表 + `updateableToolMeta` 的 pip 分支 + 两个 update 分支）即可回到「Laya 无更新入口」的旧状态，不影响其它工具。Husk / 配对锁的修复是独立行级改动，可单独 revert。

## 遗留

- `performRuntimeUpdate` 的 pip 分支当前只分派 `laya`；新增 pip 工具时必须同时补安装器分派（代码里是显式 throw，不会静默走错安装器）。
- 主仓 `npm run check` 整链在本轮收尾时与并行会话的 `clean-dist` 互相踩 dist（`uiverse-data` 报 `dist/assets` 不存在），未能稳定复现「预检通过」；已用单跑守卫 + 构建替代，并在合并后的 HEAD 上由并行线记账棘轮（1220）。
