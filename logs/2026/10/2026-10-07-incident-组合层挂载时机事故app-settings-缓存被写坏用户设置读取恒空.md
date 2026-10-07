---
id: 2026-10-07-incident-组合层挂载时机事故app-settings-缓存被写坏用户设置读取恒空
date: 2026-10-07
kind: incident
area: architecture
title: 组合层挂载时机事故：app-settings 缓存被写坏，用户设置读取恒空
tags: [mount, settings, startup, composition]
commits: []
files: [electron/main.ts, electron/app-settings.ts, scripts/gen-domain-registry.mjs, electron/composition.gen.ts]
importance: normal
---

# 组合层挂载时机事故：app-settings 缓存被写坏，用户设置读取恒空

# 结论

组合层 `composition.gen` 的域挂载原先在**模块作用域**执行 —— 它先于壳 `main.ts` 的句体（`app.setName` / `app.setPath("userData")`）被求值，于是「停用域判定」读的是**默认目录**的 `app-settings.json`；读失败的空对象被写进 app-settings 的**进程级缓存**，此后全进程的设置读取恒为空。真实用户档案里的 `autoCompactRatio: 0.9` **从未生效**（config.toml 恒为默认 0.6 的 629146）。

# 依据

- 复现：e2e profile 里 `.e2e-profile/main/app-settings.json` = `{"autoCompactRatio":0.25}`，而应用内 `appSettings:read` 返回 `{}`；编译序实证 `dist-electron/main.js`：`require("./composition.gen")` 在 172 行，`app.setName` / `app.setPath` 在 244/245 行 —— 模块体先于句体。
- 真实档案对账：`D:/11/app-settings.json` 的 0.9 对应阈值应为 round(1048576×0.9)=943718，而 `D:/11/codex-home/config.toml` 实测 `model_auto_compact_token_limit = 629146`（= round(1048576×0.6) 默认值）⇒ 设置从未进入阈值计算。
- 二次坑：壳可能被域**间接 require**（域 → `../main` 白名单依赖）而在组合层求值中途跑完 —— 此时 `ENABLED` 表尚未赋值，同步调用挂载直接 `TypeError: exports.ENABLED is not iterable`（守卫【270】真跑 dist 产物实测捕获）。

# 影响面

- 所有用户设置的**读取**路径（保存本身不坏）：自动压缩比例漂移自愈、设置页读取、记忆后端判定、webSearch / adaptiveTone / 桌面自动化开关、hardwareAcceleration 等 —— 在 10-07 修复前的每次启动全部拿到空对象。
- 停用域名单在启动时恒为空 ⇒「下次启动不挂载」功能整体失效（重启后被停用的域又挂回来）。
- 同一根因也解释了「改设置重启后没生效」这一类历史现象的一支。

# 处置

1. 挂载挪出模块作用域：`composition.gen` 只导出 `mountEnabledDomains()`；壳在 `app.setPath("userData")` 之后 `process.nextTick(mountEnabledDomains)` 调用（nextTick 推迟到调用栈展开后，同时规避循环 require 窗口 —— 生成物被直接 require 时嵌套的 main 不会提前跑挂载）。
2. app-settings 缓存**按文件路径归属**：`cached && cachedFor === file` 才命中 —— 任何"重定向前的读"不再污染之后（同步/异步两条读取路径 + 保存路径三处同款）。
3. 判据：【253】②「生成物只导出 + 壳在 setPath 之后调用（认 nextTick / 裸调两种形态）」；【270】真跑「require 生成物本身 0 挂载（非 0 = 事故会复活）」；【159】「两条读取路径 + 保存路径都带路径命中（退回裸 if(cached) 即红）」。

# 回滚

四处文件：`electron/main.ts`、`electron/app-settings.ts`、`scripts/gen-domain-registry.mjs`（模板）、`electron/composition.gen.ts`（重跑 `npm run gen:domains` 再生成）。回滚即恢复"模块作用域挂载"——不推荐（上述三条判据会红）。
