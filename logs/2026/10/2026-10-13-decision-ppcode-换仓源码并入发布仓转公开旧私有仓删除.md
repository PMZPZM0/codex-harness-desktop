---
id: 2026-10-13-decision-ppcode-换仓源码并入发布仓转公开旧私有仓删除
date: 2026-10-13
kind: decision
area: release
title: PPcode 换仓：源码并入发布仓、转公开、旧私有仓删除
tags: [repo, release, ci]
commits: []
files: []
importance: high
---

# PPcode 换仓：源码并入发布仓、转公开、旧私有仓删除

# PPcode 换仓：源码并入发布仓、转公开、旧私有仓删除

## 背景
PPcode 原是双仓结构：`ppcode-src`（**私有**源码仓）+ `PMZPZM0/PPcode`（发布仓）。
10-12 用户告知换仓：源码并入发布仓，`ppcode-src` 删除。
隐藏动因（当时我不知道，这是关键）：**私有仓的 GitHub Actions 分钟要计费**，额度用尽后作业**秒失败**
—— 症状是 `runner=(未分配)` + `步骤数=0`，`v0.1.3` 就这样静默失败过；**公开仓的免费分钟才是发版能跑起来的前提**。

## 结论
- PPcode 与云助手两个源码仓**均已转为公开仓**（另：`codex-harness-cloud-src`）
- 源码与发布页**合一**：`PMZPZM0/PPcode` 同时承担源码 + 发布两个角色；`ppcode-src` 已删除
- 本地 `D:/PPcode` 的 `origin` 双向指向 `PMZPZM0/PPcode`
- ⛔ **tag 是快照**：必须**先提交工作流、再打 tag**，否则 CI 跑的是 tag 里冻结的旧工作流
- ⛔ 内置仓会丢弃残留令牌（会导致跳过镜像）
- 用户更新路径自始未变（仍是该仓）⇒ 老用户无感

## 依据
- 提交：`1e36a8d`（`docs(repo): PPcode 换仓拓扑对齐 —— 源码合入发布仓、ppcode-src 已删`）
- 拓扑与陷阱已写进三仓 `docs/REPO-WORKFLOW.md`；本仓 `.workbuddy/memory/MEMORY.md` §5 同步
- 实证：私有仓 Actions 额度用尽 ⇒ 作业秒失败、拿不到 runner（`runner=(未分配)`、步骤数 0）

## 影响面
发版链：CI 改吃公开仓的免费分钟；`tag` 与工作流的先后顺序从"习惯"升格为硬约束。
同步链：PPcode 与原版仓同为"源码仓"，三仓（桌面版 / PPcode / 云助手）同轮同步规则据此成立
—— 见 `2026-10-13-decision-跨仓同步硬规则三个源码仓同轮同步`。

## 回滚
拓扑本身**不可回滚**（旧仓已删）。若将来需要再私有化，须先确认 Actions 额度可用，否则发版会静默失败。
