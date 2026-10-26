---
id: 2026-10-26-change-mcp-分类改为筛选下拉删除市场跳转
date: 2026-10-26
kind: change
area: settings-ui
title: MCP 分类改为筛选下拉，删除市场跳转
tags: [settings, mcp, ui]
commits: []
files: [src/features/settings-mcp/McpSettingsSection.tsx, src/styles/07-settings-mcp-connectors.css]
importance: normal
---

# MCP 分类改为筛选下拉，删除市场跳转

用户截图令：「那个分类做成筛选形式，几个市场跳转删了」。横向分类 tab 收成「分类」下拉筛选（AppSelect，选项来自 SKILLHUB_MCP_CATEGORIES，标签 nowrap），删除 SkillHub MCP 广场 / AIbase 广场两个外链，保留添加 MCP、刷新与搜索。守卫 12ad 85/85，验收 settings-current 8/8。
