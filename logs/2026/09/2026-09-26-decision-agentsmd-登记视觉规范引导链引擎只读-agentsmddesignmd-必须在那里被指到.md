---
id: 2026-09-26-decision-agentsmd-登记视觉规范引导链引擎只读-agentsmddesignmd-必须在那里被指到
date: 2026-09-26
kind: decision
area: docs
title: AGENTS.md 登记视觉规范引导链：引擎只读 AGENTS.md，DESIGN.md 必须在那里被指到
tags: [design-md, agents-md, guard-chain]
commits: []
files: [AGENTS.md, scripts/guards/06-app-behavior.mjs]
importance: high
---

# AGENTS.md 登记视觉规范引导链：引擎只读 AGENTS.md，DESIGN.md 必须在那里被指到

docs(agents): AGENTS.md 登记视觉规范引导链（改 UI 前先读 DESIGN.md）

引擎只保证自动读 AGENTS.md —— DESIGN.md 写得再好，登记断了就没人看。

- AGENTS.md 新增「🎨 视觉规范」段：三个真相源的分工（AGENTS.md 管怎么建 /
  ARCHITECTURE-RULES.md 管架构怎么划 / DESIGN.md 管长什么样）+ 真值对账提醒。
- 守卫【170】补第 4 条断言：AGENTS.md 必须含 DESIGN.md 登记与「改 UI 前先读」引导
  （钉住这条链，防止将来被删掉后规范变成无人知晓的死文档）。
