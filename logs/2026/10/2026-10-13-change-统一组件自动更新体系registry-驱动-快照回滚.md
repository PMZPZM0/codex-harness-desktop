---
id: 2026-10-13-change-统一组件自动更新体系registry-驱动-快照回滚
date: 2026-10-13
kind: change
area: update
title: 统一组件自动更新体系（registry 驱动 + 快照回滚）
tags: [auto-update, registry, rollback]
commits: []
files: []
importance: high
---

# 统一组件自动更新体系（registry 驱动 + 快照回滚）

# 统一组件自动更新体系（registry 驱动 + 快照回滚）

## 背景
此前每个可更新组件（npm 工具 / pip 工具 / 引擎 / 技能 / 插件…）各写各的更新逻辑，
「哪些能更、默认开不开、失败怎么办」散落在各处；用户还要求把「自动更新开关」收成一个入口。
当时我不知道：统一后会踩到两处真实回归（引擎停在停止态、市场技能双跑），
且行级开关与具名开关的优先级需要一个**单一判据**，否则会出现「界面说开着、后台跳过」。

## 结论
四文件三层，registry 是「哪些能更、默认值、镜像策略」的**单一真相源**：
- `electron/features/update/update-registry.ts` —— 19 条 spec（npm / pip / 引擎 / ponytail / 市场技能 / 专家包 / 市场插件 / 人格包）
- `update-backends.ts` —— 执行层，委托各域既有安装函数（⛔ 不另写一套安装）
- `update-safety.ts` + `update-tar.ts` —— 快照回滚 + 内容指纹 + 自解析 tar

⛔ 内置技能 / 随包工具 / 钩子 / 声明式插件列为「不可单独更新」并写明原因（**结论性**，不是 TODO）。
行级开关 `autoUpdateOverrides` + 读函数 `readAutoUpdateRowSwitch` 是**单一判据**；具名四开关优先，`market-skill` 归属 `skillAutoUpdate`。
⛔ 界面不自己定默认值：行数据自带 `enabled`。
新增 `autoUpdate` 域 5 通道 + 控制台 `AutoUpdateCard` = **全部自动更新开关的唯一入口**；
技能中心与自动化页撤掉开关只留指路。默认值分档：装包类缺省开、`skillAutoUpdate` 缺省**关**（它会覆盖用户技能目录）。

## 依据
- 守卫 `12l` 38/38 + 实证脚本 `scripts/verify-update-safety.mjs` 14/14（真回滚 + 恶意 tar 拦截），均已进 check 链
- 真实回归两处（被守卫 12k 抓到）：
  ① 引擎更新流程先 `server.stop()` 且成功分支不自启 ⇒ 统一后丢接缝会让引擎停在停止态；
  ② `market-skill` 会被旧调度器与新循环双跑 ⇒ 新循环 skip，只留一个 owner
- ⛔ 工具坑：字符串或行注释里出现块注释起始符（斜杠+星号）会让朴素 `stripComments` 从那里吞到下一个块注释结尾
  ⇒ 12l 首跑「mirror:false」只数到 1（真有 4 条）。**文案里别写字面噪点**
- 提交：桌面版 `autoUpdate` 域 + `ad2c179`（统一更新体系）

## 影响面
`readAutoUpdateStatus` 一次拿全五个开关；循环仍在 `skills-ipc`，本板块只承载开关与显示。
关闭态文案明写「不会发起更新检查」（循环里开关判定在 `updateOne` 之前 `continue`；`skills-ipc` 在 `checkSkillUpdateRows` 之前 `return`）。
CSS 告警色是 `--orange`，⛔ 没有 `--warn` / `--warning`（守卫【160】会红）。

## 回滚
删 `update-*` 四文件 + `autoUpdate` 域登记与 `AutoUpdateCard`，恢复各域自带更新入口；
守卫 12l 与 `verify-update-safety.mjs` 同步撤出 check 链。
⛔ 引擎更新的接缝（成功分支自启）**必须单独保留**，回滚时别一起删。
