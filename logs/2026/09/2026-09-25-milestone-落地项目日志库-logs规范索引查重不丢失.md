---
id: 2026-09-25-milestone-落地项目日志库-logs规范索引查重不丢失
date: 2026-09-25
kind: milestone
area: guards
title: 落地项目日志库 logs/（规范+索引+查重+不丢失）
tags: [logs, index, dedupe, guards]
commits: []
files: []
importance: high
---

# 落地项目日志库 logs/（规范+索引+查重+不丢失）

## 背景
用户要求新增独立日志目录 + 规范 + 技能 + 与 WorkBuddy 一致的索引 + 查看/清理/删除 + 不丢失；
随后追加「确保没有重复写日志哈」。

## 结论
- 三层分工（用户确认「归档层+索引」）：日报=流水 / `.codex-harness` L4=注入 / **`logs/`=结论归档**。
- 交付：`logs/README.md` 规范 + `scripts/logs.mjs` 十个子命令 + `.codex/skills/log-archive` 技能 +
  守卫【158】22 条。
- **防重复写做成机制**：写入时拦（标题相似 ≥0.75 / 正文哈希相同 ⇒ 拒写）+ `dedupe` 随时可查；
  边界写进规范（同一段正文只允许一份，别处只留指针）。
- **不丢失五道**：进 git / 追加写 / sha256 校验 / 索引可重建 / 删除留永久墓碑。

## 依据
- 变异测试 4/4 全红（dedupe 改名绕过、墓碑写出被移除、删掉防重复边界、去掉写入时查重）
- `verify` ✓ 一致；日报 44694 字符与新条目**零句原样重复**（派生关系而非复制）
- 预检【158】22 条全绿、0 条新增真红（2381 条断言）

## 影响面
新增目录与工具；收尾流程多两步（`verify` + `dedupe`）；AGENTS.md 新增一节。

## 回滚
删 `logs/`、`scripts/logs.mjs`、`.codex/skills/log-archive/` 与守卫【158】段；无运行时依赖。
