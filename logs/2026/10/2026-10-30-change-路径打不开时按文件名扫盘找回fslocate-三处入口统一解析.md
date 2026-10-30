---
id: 2026-10-30-change-路径打不开时按文件名扫盘找回fslocate-三处入口统一解析
date: 2026-10-30
kind: change
area: file-preview
title: 路径打不开时按文件名扫盘找回（fs:locate）+ 三处入口统一解析
tags: [file-preview, fs, locate, path]
commits: [892e7fd63]
files: [electron/file-locate.ts, electron/features/fs-ipc.ts, src/lib/path-fallback.mjs, src/features/app-view/AppView/RightFileBridge.tsx]
importance: high
---

# 路径打不开时按文件名扫盘找回（fs:locate）+ 三处入口统一解析

# 路径打不开时按文件名扫盘找回（fs:locate）

## 结论

卡片点开报「文件不存在或不可读：D:\测试\src\lib\x.mjs」时，**文件本身存在，是卡片手里的路径错了**
（把命令里/消息里出现的相对路径按会话目录拼）。读取闸门早已放开，问题不在权限。

修法分三层，缺一层就还是打不开：

1. **路径归一**（上一轮已做）：命令卡按命令自己的 `cd` 解析（`resolveCommandTarget`）。
2. **会话台账**（上一轮已做）：同名真实文件 + `%xx` 解码（`pickKnownPathFallback`）。
3. **按文件名扫盘**（本轮新增）：没有命令上下文、台账里也没有时，只能问磁盘 ——
   `electron/file-locate.ts` + IPC `fs:locate`（fs 域 4→5）。

渲染层收口到唯一入口 `resolveForOpen`：补绝对路径 → 台账同名 → 扫盘。三处入口共用
（居中预览 `useFilePreview` / 右栏 `03-workspace-files` / 跳转桥 `RightFileBridge` 里的
`registerRightFileResolver`）。

## 扫盘的判据（三层，缺一层就会「明明有却打不开」）

- **同名**：basename 完全一致（大小写不敏感），不做模糊匹配。
- **尾段证据**：从文件名往左数连续相同的目录段数打分；同名多个时选目录结构对得上的
  （⛔ 取「第一个命中」会打开另一个同名文件，比报找不到更糟）。含「文件名」本身那段，
  所以完美匹配 = 全部段相同，可提前结束。
- **有界**：总预算 2.6s、**每根各自**的目录数预算、跳过 node_modules/.git/dist/AppData/Windows 等重目录。
  根顺序 = 目标盘根 → 各会话 cwd → 用户主目录（先扫最可能命中的）。
- 结果缓存：正结果 5 分钟、负结果 60 秒；同一 basename 并发走 single-flight。

## 三个实测踩到的坑（都是"看起来像没找到"）

1. **目录数预算写成全局**：主目录一扫就吃光，目标盘根压根轮不到 ⇒ 同盘仓里的文件永远找不回。
2. **提前结束阈值**：用 `tailScore*1000 - depth` 和 `tail.length*1000` 比，深度惩罚让完美匹配也
   达不到阈值 ⇒ 必须单独记 `bestTail`。
3. **「像文件」的门**写成 `\.[a-z0-9]{1,8}$` 会把 `.bak-20261029` / `.d.mts` / `.tar.gz` 全挡掉
   —— 用户点的正好是 `.bak-*` 那张卡（且那个文件其实已被撤回、真不存在，第一版探针把它当"找不到"报红，
   是探针错，不是实现错）。

## IPC 契约（⚠️ 差点静默失效）

`invokeArgs` 必须是 `{ path, threadId }` **对象**形态。写成位置参数 `path, threadId` 时：
handler 收到的是字符串 ⇒ `input?.path` 恒 `undefined` ⇒ 扫的目录退化成进程 cwd ⇒ **1ms 就返回空串**。
表现与「磁盘上没有」完全一样，肉眼分不出。已在 `scripts/verify-preload-args.mjs` 加
`locateFile` / `readFile` 两条探针钉死。

## 判据（真机 CDP，全部真跑）

| 场景 | 结果 |
|---|---|
| 路径本来就对 | 原样返回 · **1ms**（不扫盘） |
| 文件在 `D:\zz-locate-probe\deep\nested`、路径指向 `D:\测试\src\lib` | **1190ms** 找回真身 |
| 磁盘上真没有 | 返回空串（⛔ 不编路径） |
| 点命令卡文件名 | 居中预览 **22,843 字符**、显示真实路径 |
| 点回合文件卡 | 右栏预览 **22,745 字符**、路径为真实路径（不再是空态） |

## 守卫

- `03-runtime-boot` +3：`fs:locate` 走 `locateFile` 且路径归一与 `fs:read` 同源 / `file-locate` 有界
  （时间 + 每根目录数 + 跳过重目录）/ 尾段打分存在。
- `07-turn-fold`【127】改成钉**三处入口**都接同一套回落（原来只钉两处）。
- `EXPECTED_CHECKS` 3357→3360；`vite-env.d.ts` 行数棘轮 1022→1023；`03-runtime-boot` 棘轮 1122→1138。

## 三仓

主线 `892e7fd63` / PPcode `2b6a75ff` / 云助手 `19d2b416`（界面已部署，入口哈希一致）。

## 遗留

- 全量 `npm run check` 仍剩 3 条红，全属并行工作线在途改动（`boot.ts` ponytail 自愈与
  「不再自动种」断言冲突、【180】function-menu 默认顺序、【265】boot.ts 1079→1086）。
- 副本 `check-preflight` 本就有几十条存量红（AUMID / CSS 变量 / bot-pairing 产物 / setPath 等），
  历史上被 `npm run check` 在 voice-call 处提前中断而从未暴露；本轮只保证自己新增断言全绿。
