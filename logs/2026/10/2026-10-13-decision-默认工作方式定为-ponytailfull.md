---
id: 2026-10-13-decision-默认工作方式定为-ponytailfull
date: 2026-10-13
kind: decision
area: docs
title: 默认工作方式定为 Ponytail（full）
tags: [ponytail, workflow, rule]
commits: []
files: []
importance: high
---

# 默认工作方式定为 Ponytail（full）

# 默认工作方式定为 Ponytail（10-13 用户令，对所有编码类任务默认生效）

## 背景
用户 10-13 直接下令：默认按 `ponytail`（full 强度）干活。
此前默认是"看情况"，agent 容易在两个方向出错 —— 一边**过度设计**（为一点需求铺架构、加没人要的抽象），
一边**跳过理解直接甩小 diff**（穿效率外衣、交付一个自信的错误修法）。
当时我不知道：把"最小改动"设成默认之后，必须**显式列出不许省的清单**，否则连数据安全 / 输入校验这类不可省项也会被"精简"掉。

## 结论
任何编码类任务默认走 `ponytail` 技能（强度 **full**）：写代码、加功能、重构、修 bug、做设计、选库选依赖 —— 全部适用。
装在 `~/.workbuddy/skills/ponytail*`（6 个技能：`ponytail` / `-review` / `-audit` / `-debt` / `-gain` / `-help`），
开关 `/ponytail lite|full|ultra`，`stop ponytail` 退出。

⛔ **规则原文见 `AGENTS.md` §「🦓 默认工作方式 = Ponytail」（第 302–342 行）—— 本条目只记来龙去脉，规则以那里为准，不做第二份真相源。**

三条要点：
1. **决策阶梯**（需要存在吗 → 本仓已有吗 → 标准库 → 平台原生 → 已装依赖 → 一行 → 才写），
   但 ⛔ **阶梯在「读懂问题之后」才走** —— 跳过理解直接甩小 diff 是"危险的那种懒"
2. **修 bug = 修根因不修症状**：动手前 grep 你要改的函数的所有调用方
3. **⛔ 不许省的地方（优先于上面全部）**：信任边界校验 / 防止数据丢失的错误处理 / 安全 / 可访问性基本项 /
   硬件标定旋钮 / **非平凡逻辑留一个可跑的检查**

## 依据
- 提交：`d122703`（`docs(rules): 默认工作方式定为 Ponytail（10-13 用户令）`）
- 规则落点：`AGENTS.md` 第 302–342 行；技能实体 `~/.workbuddy/skills/ponytail{,-review,-audit,-debt,-gain,-help}`
- 用户原话口径：「默认按 ponytail(full) 干活」

## 影响面
所有代码类产出（含三仓同步时的 apply / 手改 / 生成物合并）。与既有「⛔ 已知取舍」注释惯例合流：
刻意简化但有天花板的实现用 `# ponytail: <天花板>，<何时升级>` 标注。

## 回滚
`stop ponytail` 退出，或删 `AGENTS.md` 该段。技能包可留在用户目录，不生效即无影响。
