---
id: 2026-10-31-change-回复风格新增敢于反驳并配套-challenge-requirements-技能
date: 2026-10-31
kind: change
area: ui
title: 回复风格新增「敢于反驳」并配套 challenge-requirements 技能
tags: [reply-style, skill, personalization]
commits: []
files: [src/lib/reply-style.mjs, electron/builtin-skills/25-skill-challenge-requirements.ts, src/components/PersonalizationPage.tsx]
importance: normal
---

# 回复风格新增「敢于反驳」并配套 challenge-requirements 技能

## 背景
用户在「设置 → 个性化 → 回复风格」要求加一档：Codex 敢于反驳用户的错误需求、指出需求中的错误、阐述自己的观点并给更好方案；并明确「跟那个需求询问一个运行逻辑，配套技能，提示词不够硬」。

## 结论
- 新增风格值 `challenge`（界面名「敢于反驳」），与「需求询问」同构：
  - 引擎 `personality` 仍下发 `none`（引擎只认官方三档；行为靠 developer instructions）；
  - `challengeInstruction()` 注入行为块，并**点名让模型按 `challenge-requirements` 技能执行**（与需求询问点名 grill-me 同一逻辑）。
- 新增内置技能 `challenge-requirements`（`electron/builtin-skills/25-skill-challenge-requirements.ts`）：
  1. 把需求拆成 目标 / 前提 / 约束 / 交付物 / 代价 五块，逐块找错误前提、自相矛盾、不可验收、代价失衡；
  2. 固定输出结构：结论 → 问题 → 依据（文件/行号/实测）→ 影响 → 替代方案 → 要你定；
  3. 硬规则：**先反驳再动手**、不许空口/模糊表述、不为反对而反对（需求没问题就直接做）、用户坚持原方案则照做并写清风险且只提醒一次、安全与不可逆操作优先、对事不对人。
- 技能按内置技能通道随包安装；`#` 面板保底名单、中文导读、entries 三处同轮登记（守卫【229】对账）。
- 用户中心风格 chip、`/status` 文案同步显示「敢于反驳」。

## 依据
- 需求询问的既有实现：`src/lib/reply-style.mjs` 的 `inquiryInstruction()` 点名 grill-me；本风格照此扩展。
- 守卫 12ad 断言：个性化页含 `value: "challenge"` 与「敢于反驳」，且 `challengeInstruction` 含「仍坚持/坚持原方案」边界。
- 守卫 04【229】：内置 entries 28 个 = 中文导读 28 个 = `#` 面板保底名单 28 个（含 challenge-requirements）。

## 影响面
- 个性化页回复风格多一档；选择后每回合 developer instructions 多一段行为约束（不改变事实准确性与安全纪律）。
- 内置技能列表 +1；启动时随 `ensureBuiltinSkills` 落盘到 codexHome/skills。

## 回滚
回退对应提交即可（风格值退回未知值会被当作 `none` 处理；技能目录随下次启动清理或手动删除 `codexHome/skills/challenge-requirements`）。
