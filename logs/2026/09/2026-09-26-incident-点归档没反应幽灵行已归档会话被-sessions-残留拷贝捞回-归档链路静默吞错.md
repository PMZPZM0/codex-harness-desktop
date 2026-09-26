---
id: 2026-09-26-incident-点归档没反应幽灵行已归档会话被-sessions-残留拷贝捞回-归档链路静默吞错
date: 2026-09-26
kind: incident
area: sidebar
title: 点归档没反应：幽灵行（已归档会话被 sessions 残留拷贝捞回）+ 归档链路静默吞错
tags: [archive, ghost, rollout, silent-failure]
commits: []
files: []
importance: high
---

# 点归档没反应：幽灵行（已归档会话被 sessions 残留拷贝捞回）+ 归档链路静默吞错

用户报「点归档没反应」。

## 定性（真机探针，一次性 profile 复现）
- 当前源码链路初测全绿（默认视图/分类视图/置顶行归档都成功）⇒ 差异在数据形态。
- 第二轮探针 100% 复现：`thread/archive` 报 `no rollout found for thread id`，渲染层 `void bag.archiveThread(id)` 把异常吞进 unhandled rejection ⇒ 行不消失、无提示 =「点了没反应」。

## 根因（两层）
1. **幽灵行**：`rollout-worker.cjs listRolloutThreads` 去重时 `sessions/` 先扫——同一条会话 rollout 在 `sessions/` 与 `archived_sessions/` 各一份（维护迁移拷贝/归档残留）时，已归档真相被 sessions/ 旧拷贝覆盖（seen 去重），兜底扫描把已归档会话当**活跃会话**捞回侧栏；引擎侧已不认它 ⇒ 归档必报错。
2. **静默吞错**：`archiveThread`/`unarchiveThread` 引擎报错全部无声（对比 clearCurrentConversation 有 catch+toast）。

## 修法
- worker 扫描顺序改为 archived_sessions 先（归档真相赢，幽灵行不再出现在活跃列表）；重跑 gen-rollout-worker + tsc -p electron。
- part08 archiveThread/unarchiveThread 整体 try/catch：幽灵类错误（no rollout found/not found/failed to read session metadata）→ 本地移除 + toast「已从列表清理」；其它错误 → toast「归档失败」+ 引擎原话。
- 守卫【162】6 条（03 域 +1 扫描顺序、06 域 +6）。

## 验证
- 修复后探针：初始行 5→4（两条幽灵行消失）；真实行归档 4→3 消失 ✓；tsc/预检/验收全绿。

## 坑
- 守卫 03 域插断言两次翻车：ternary 漏右括号（`(cond ? ok : fail(...)` 少 `)`）+ 正则跨行锚太脆（换 includes 精确子串）；node --check 报错行定位在 fail 行但根因在上行漏括号。
