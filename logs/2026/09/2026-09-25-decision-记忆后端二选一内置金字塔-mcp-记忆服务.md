---
id: 2026-09-25-decision-记忆后端二选一内置金字塔-mcp-记忆服务
date: 2026-09-25
kind: decision
area: memory
title: 记忆后端二选一（内置金字塔 / MCP 记忆服务）
tags: [memory, mcp, backend]
commits: []
files: []
importance: high
---

# 记忆后端二选一（内置金字塔 / MCP 记忆服务）

## 背景
用户要求 MCP 记忆「不内置」，由用户自主选择装不装。

## 结论
- 后端 = builtin（默认）| mcp，二选一；两者**不会同时写**。
- 选了 mcp 但服务不可用时**回退内置**（宁可回到金字塔，也不能一条记忆都不落）。

## 依据
- electron/memory-backend.ts 的 effectiveMemoryBackend()
- electron/builtin-skills.ts 的互斥改名（SKILL.md ⇄ SKILL.md.disabled）

## 影响面
写入落点、技能启用态、连接器启用态、developer_instructions 的记忆写法段。

## 回滚
设置里切回「内置记忆金字塔」，重启应用即可。
