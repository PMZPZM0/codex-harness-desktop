---
id: 2026-10-27-change-mcp-页删右上角问号与页头说明只删这一页其余设置页保留
date: 2026-10-27
kind: change
area: settings-ui
title: MCP 页删右上角问号与页头说明（只删这一页，其余设置页保留）
tags: [settings, mcp, question-mark]
commits: []
files: [src/features/settings-mcp/McpSettingsSection.tsx, scripts/guards/12ad-settings-unified.mjs, scripts/guards/07-turn-fold.mjs, scripts/accept.mjs]
importance: normal
---

# MCP 页删右上角问号与页头说明（只删这一页，其余设置页保留）

用户令（MCP 页截图）：「右上角问号删了」—— 只删 MCP 这一页（用户在被问「删到什么范围」时明确选「只删 MCP 这一个」）。

## 事实

- 设置页页头右上角那个 ? = 各页 `<h2>` 里内联的 `PageInfo`（src/components/SettingsHead.tsx），
  被新版式 `.settings-exp-shell > .settings-section > .settings-copy h2` 用 `position:absolute; right:0` 钉到页头右上角
  （src/styles/45-settings-experience.css 末尾那一段）。10-26 那轮把页头大字+副标题整排删掉，只留下这枚 ?。
- 约 20 个设置页都有这枚 ?：技能中心 / MCP / 命令 / 钩子 / SSH / 专家团 / 数据管理 / 记忆 / 人格市场 / 知识库 …
- MCP 页这枚 ? 带 `helpKey="mcp"`，是 HelpDialog 里「MCP · 新手帮助」主题的**唯一**入口。

## 改法

- MCP 页 `.settings-copy channel-heading` 整块撤掉（? + 副标题一起），`PageInfo` import 一并删。
  进页第一屏直接是「分类 / 搜索 / 添加 MCP / 刷新」工具条与市场卡片。
- 守卫 12ad：「每页都有 ?」的循环名单去掉 mcp，另外单钉一条「MCP 页不再挂 ? / 页头说明」，
  免得以后这条判据又把它悄悄加回来。
- 守卫 07：孤儿主题名单（每个帮助主题都必须有 ? 入口）加 mcp 例外 —— 内容库保留「MCP · 新手帮助」，
  只是本页没有入口了，与「模型页按用户令撤掉 ?」同口径。
- 顺手修掉 18f153b40（插件页删页头?）**漏改名单**留下的既存假红：plugins 主题同样进了例外名单。

## 取舍

- 删 ? 后 HelpDialog 的 mcp 主题在界面上没有入口了（内容仍在帮助库里，用户召回时可再挂一枚 ?）。
  这是「删 ? 」的必然代价，用户已明确只删这一页，接受。
- 其他设置页的 ? 一律保留（用户选择「只删 MCP 这一个」）。

## 验证

- tsc 通过；vite build 通过。
- 守卫 12ad 95/95（新增「MCP 页不再挂 ?」1 条）；守卫 07 1246 项全绿（孤儿主题一条不红）。
- 真机验收 settings-current 12/12（新增第 ⑩ 项：页面上无 .page-info / 无 .settings-copy，工具条顶到 118px）。
- 截图核对：MCP 页右上角空出来，工具条上沿与内容区齐平。
