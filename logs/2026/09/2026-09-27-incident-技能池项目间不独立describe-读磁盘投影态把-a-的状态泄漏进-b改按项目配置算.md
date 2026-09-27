---
id: 2026-09-27-incident-技能池项目间不独立describe-读磁盘投影态把-a-的状态泄漏进-b改按项目配置算
date: 2026-09-27
kind: incident
area: engine
title: 技能池项目间不独立：describe 读磁盘投影态把 A 的状态泄漏进 B（改按项目配置算）
tags: [skill-pool, per-project, independence, guard173]
commits: []
files: [electron/skill-pool.ts, scripts/guards/06-app-behavior.mjs]
importance: high
---

# 技能池项目间不独立：describe 读磁盘投影态把 A 的状态泄漏进 B（改按项目配置算）

修复技能池「项目间不独立」（用户实测：A 项目禁用的技能，B 项目跟着禁用）：

根因：describeSkillPool 的 active 读的是**磁盘改名态**——磁盘是「最近一次
sync 的项目」的投影 ⇒ A 停用（投影落盘）后切到 B，B 的视图读到 A 的状态；
更糟：B 里点开会把 A 的状态经 patch 反向写进 B 的配置（双向污染）。

修复：active 一律按 **cwd 自己的 skill-pool.json** 算（!globalDisabled &&
!projectDisabled），与磁盘投影解耦。每个项目的配置是该项目生效集的唯一
真相源，A/B 互不可见；sync 只负责把「当前会话所属项目」的配置投影到
磁盘（引擎「扫到就注入」的唯一入口，thread/start 前生效）。

验收：独立性功能测试 5/5（A 停 x B 停 y → 各自视图完全镜像、A 恢复 x
不影响 B、两份配置文件互不含对方条目）；守卫【173】新增 ①b 钉死
「active 按项目配置算、禁读磁盘投影态」。
