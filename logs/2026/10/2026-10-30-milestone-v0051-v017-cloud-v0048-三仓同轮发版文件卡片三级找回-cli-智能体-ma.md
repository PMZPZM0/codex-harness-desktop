---
id: 2026-10-30-milestone-v0051-v017-cloud-v0048-三仓同轮发版文件卡片三级找回-cli-智能体-ma
date: 2026-10-30
kind: milestone
area: release
title: v0.0.51 / v0.1.7 / cloud-v0.0.48 三仓同轮发版：文件卡片三级找回 + CLI 智能体 + mac 四处硬伤
tags: [release, mac, file-locate, cli]
commits: []
files: []
importance: high
---

# v0.0.51 / v0.1.7 / cloud-v0.0.48 三仓同轮发版：文件卡片三级找回 + CLI 智能体 + mac 四处硬伤

## 结论

三仓同轮发版：主线 **v0.0.51** / PPcode **v0.1.7** / 云助手 **cloud-v0.0.48**。
本版重点是把「文件卡片点不开」整条链路修通，并补 CLI 智能体板块；mac 侧修掉三处会让功能
整体失效的硬伤。

## 版本号口径（本轮踩到的坑）

远端实际只有 `v0.0.47` / `v0.1.5`：**0.0.48 / 0.0.49 / 0.0.50 三版与 PPcode 0.1.6 都建过
说明但从未打 tag**（10-26 那份 v0.0.48 里程碑档案写着「发版」，远端查无此 tag）。所以本版
说明里必须写清「中间版本均未发布，装本版即可」，否则用户以为装错版本。

云助手包版本的真相源是 `electron-builder.assistant.yml` 的 `extraMetadata.version`，
**不是 package.json**（那条属于桌面版发布线）；守卫 11r 也按 extraMetadata 比对。

## mac 适配（本轮真缺口 4 处）

审计口径 `scripts/mac-audit.mjs <上版tag> HEAD`，只扫新增行：400 处命中 / 273 条条目，
逐条判读后 4 处真缺口 —— 全部是「Windows 专有能力被当成通用的」：

1. `isCodexProcess` 读 `/proc/<pid>/comm` —— darwin 没有 `/proc`，恒抛 ⇒ 一律 false ⇒
   「清理上次遗留引擎」是死代码，孤儿引擎继续占会话 writer。改 `ps -p <pid> -o comm=`。
2. `whereExe` 写死 `where` —— mac 上恒失败 ⇒ 中枢「本机 CLI agent」整列判成未检测。
   抽 `binOnPath()`（win `where` / 其余 `which`）到 `cli-agents.ts`，分叉只留一处。
3. `runCliMember` 写死 Windows 的 shell 前缀 —— darwin 上 execFile 直接 ENOENT ⇒
   **派给 CLI 成员的活 100% 失败**。非 Windows 走 `/bin/sh -c`。
4. `file-locate` 用 `path.parse().root` 当「目标盘根」—— POSIX 恒为 `/` ⇒ 1.2s 预算扫整个
   文件系统且必进 `~/Library`。新增 `scanRootOf()`（mac 退到头两段）+ 按**绝对路径**跳
   `~/Library`（⛔ 不按名字跳，否则项目里的 `library/` 被误杀）。

## 判据与边界

- 主仓 `npm run check` 全绿（0 红；【93】1415 项 /【94】0 条死导入 /【96】1360 处 require 全解析）。
- 副本仓：PPcode 预检 29→28（少的正是【265】行数棘轮，按实测记账后归零）、云助手 21 条
  全是既有漂移，本轮 0 新增。⛔ 副本仓守卫普遍落后主线 57/85 文件，别拿它的红当本轮判据。
- ⛔ 4 处 mac 修复**只做了类型检查与平台分支复核，没有 mac 真机回归**（构建机之外无 mac 环境）。
