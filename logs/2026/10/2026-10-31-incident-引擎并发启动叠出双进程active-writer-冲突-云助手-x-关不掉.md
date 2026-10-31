---
id: 2026-10-31-incident-引擎并发启动叠出双进程active-writer-冲突-云助手-x-关不掉
date: 2026-10-31
kind: incident
area: engine
title: 引擎并发启动叠出双进程（active writer 冲突）+ 云助手 X 关不掉
tags: [codex-server, engine, concurrency, remote-assistant]
commits: []
files: [electron/codex-server.ts, electron/headless.ts, scripts/guards/03-runtime-boot.mjs]
importance: normal
---

# 引擎并发启动叠出双进程（active writer 冲突）+ 云助手 X 关不掉

## 背景
用户实测：云助手与 PPcode 打开已有会话后发消息，红条报「这条会话正被另一个引擎进程占用（上一次的进程没退干净）」；云助手点右上角 × 没有任何反应。

## 结论
① 同一份 codex-home 上**同时活着两个 codex.exe**（云助手实测：同一 Electron 主进程下 2016 / 36444 两个引擎并存，`engine-debug.log` 里 05:21:46~55 共 5 次 `[spawn]`）。两个进程抢同一会话 rollout 的 writer ⇒ 引擎侧 `thread-store conflict: thread … already has an active writer`。
② 触发链是 `CodexServer` 的启动/重启并发：旧 `doRestart` **先清 child、等旧进程退出（≤3s）、后 reject 在途请求** —— 等待窗口里任何 `request()` 都会 `start()` 出新引擎，随后被 reject 打成「Codex app-server restarted」并按瞬时失败重试，再 spawn 一个；且 `start()` 的 `finally` 无条件 `this.starting = undefined`，旧序列会抹掉新序列的启动态，`launchOnce` 重试也不回收既有 child ⇒ 漏出的进程永远占着 writer。
③ 云助手 × 关不掉：headless 的 `/__ipc` 给 handler 的 sender 是**死假体**（`isDestroyed: () => true`），而 `shell:window-close/-minimize/-toggle-maximize/-state` 全靠 `fromWebContents(event.sender)` 反查窗口 ⇒ 三个窗口钮全是静默空操作。

## 依据
- 现场：`Get-CimInstance` 显示两个 codex.exe 的父进程同为云助手 Electron 主进程；`%APPDATA%/Codex Assistant/engine-debug.log` 同一分钟 5 次 `[spawn]`，随后连续 `already has an active writer`。
- 代码：`electron/codex-server.ts` 的 `doRestart` / `start` / `launchOnce`；`electron/headless.ts` 的 `/__ipc` fakeEvent（原 `sender: { isDestroyed: () => true }`）。
- 判据：守卫 03【11】新增 6 条（reapCurrentChild / 重启先 reject 再杀 / 并发重启合并 / starting 身份比对 / launchOnce 回收 + 台账全量），两处变异（去掉身份比对、去掉 reap）实测均报 ✗。

## 影响面
- 引擎生命周期：并发重启合并为一次；重启前先拒绝在途请求；每次 spawn 前回收既有 child；多 pid 台账 `engine.pids.json` + 启动时按二进制全路径清理遗留引擎；stop() 清理台账内全部引擎。
- 云助手窗口按钮：/__ipc 的 sender 改为本机窗口（助手窗优先，其次主窗），× 真正退出；minimize / maximize / state 同时恢复。
- 判定口径不变：`active writer` 的中文提示仍保留（其它实例/旧版本残留的兜底）。

## 回滚
回退 `electron/codex-server.ts`、`electron/headless.ts` 与守卫 03/04/_ctx 的对应改动即可；`engine.pids.json` 是运行时台账，删掉无副作用。
