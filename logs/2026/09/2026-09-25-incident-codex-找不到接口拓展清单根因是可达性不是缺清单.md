---
id: 2026-09-25-incident-codex-找不到接口拓展清单根因是可达性不是缺清单
date: 2026-09-25
kind: incident
area: skills
title: Codex 找不到接口/拓展清单：根因是可达性，不是缺清单
tags: [skills, harness-api, discovery, instructions]
commits: []
files: []
importance: high
---

# Codex 找不到接口/拓展清单：根因是可达性，不是缺清单

## 背景

用户 09-25：「接口和拓展清单，Codex 好像不知道啊，我今天问了，扫半天都没扫到，不知道能拓展什么，没有内置清单嘛」。

## 结论（实测根因，与直觉相反）

清单**早就做了**（内置技能 `harness-api`，生成器产物，70 域 / 337 通道），引擎的技能目录里也确实有它。
真正卡住的是**可达性**，三条：

1. 引擎技能目录只给 name + description（渐进披露）⇒ 模型**不知道要读**；用户一问「能拓展什么」，
   它第一反应是 **grep 源码** —— 而打包版用户机器上根本没有宿主源码，注定一无所获。
2. 就算判断出该读（会话 `01a0d7b1` 19:06 实测它判断出来了），读文件也很难：`type "D:\11\…\SKILL.md"`
   的**引号被执行通道剥掉**、`workdir` 偶发 `os error 267` ⇒ 十几轮 exec 才读到。
3. 清单正文只有**通道罗列**（渲染层↔主进程的内部接口），没有「想加什么 → 改哪里」的**可拓展点**，
   答不了「能拓展什么」。

## 修法

- `electron/developer-instructions.ts` 加**常驻第 11 条**（`CAPABILITY_INSTRUCTIONS`）：
  点名 `harness-api`、明说「不要 grep 源码找能力」、给出读法（一次读全 / 别用 cmd 拼引号 / 可设 workdir）、
  给出拓展点分类、写明打包版边界（只有接入类拓展）。
- 生成器 `scripts/gen-capability-skill.mjs` 加**「可拓展点」表**（宿主通道 / 内置技能 / 个人技能 /
  MCP 连接器 / 专家团 / 调度器 / IM Bot / RPA / 桌面·浏览器自动化 / 记忆后端 / 主题）+
  **「怎么读这份清单」**段。
- 守卫【159】13 条钉住：指令**真下发**（锚 `text += CAPABILITY_INSTRUCTIONS;`，不是只查常量存在）、
  技能名两处同源、正文两张表都在、打包版边界句还在。

## 依据

- 会话原文取证（rollout `01a0d7b1` 第 4/5 行 = 引擎注入的技能目录确实含 harness-api；行 101 模型推理
  也提到它；行 105/107/113/117 读文件失败 3 次后靠 workdir 成功）。
- 桩替身端到端（隔离 userData）：`ensureBuiltinSkills()` → 14 个技能落盘，
  `harness-api/SKILL.md` 11275 字符、含「可拓展点」与「怎么读这份清单」。
- 变异测试：删掉接线那行（常量仍在）→ 断言变红 —— **第一版断言（只查两个标识符）就是这么被抓出来的空心**。

## 影响面

每轮 developer_instructions 多约 1.4KB（~400 token）；技能正文 +3KB（按需读，不进每轮上下文）。

## 回滚

删 `CAPABILITY_INSTRUCTIONS` 与其接线、删生成器那两张表、删守卫【159】；技能文件由生成器重跑覆盖。
