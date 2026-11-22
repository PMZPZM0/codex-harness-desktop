---
id: 2026-11-22-milestone-v0077-pp-v0125-发布含-macos
date: 2026-11-22
kind: milestone
area: release
title: v0.0.77 / PP v0.1.25 发布（含 macOS）
tags: [release, mac]
commits: []
files: []
importance: high
---

# v0.0.77 / PP v0.1.25 发布（含 macOS）

v0.0.77 发布完成（两仓 + macOS），CI 全绿。

- 主仓 `PMZPZM0/codex-harness-desktop` 标签 `v0.0.77`，Release 已公开（draft=false），资产 uploaded：
  `Codex.Harness.Desktop-0.0.77-win-x64.exe` 672.2MB、
  `…-0.0.77-arm64-mac.zip` 906.7MB、`…-0.0.77-x64-mac.zip` 912.2MB（+ blockmap / latest.yml）。
- PPcode `PMZPZM0/PPcode` 标签 `v0.1.25`，资产 uploaded：
  `PPcode-0.1.25-win-x64.exe` 673.3MB、`PPcode-0.1.25-arm64-mac.zip` 897.5MB、`-x64-mac.zip` 913.8MB。
- 组件体检：引擎 0.171.0、nuphus 0.3.4、agent-desktop 1.3.1、ponytail v5.3.3 均最新；
  open-computer-use 1.1.4→1.1.5；lucide-react 1.76→1.77（PP 从 1.73 一并对齐）。
  TypeScript 7 / Electron 45 / xyflow 13 跨大版本不升（peer 约束与原生模块 ABI 需单独验证）。
- mac 审计：14 条命中全在平台门控或跨平台正则内，无真缺口。
- 口径变更（用户 11-22 令）：发版说明改**简洁版**（≤12 行、≤7 条），根因/实测进台账与 logs；
  `codex-harness-release-publish` §10 已重写。
- 资产名注意：mac 是 `-arm64-mac.zip` / `-x64-mac.zip`（不是 `-mac-arm64.zip`），查 404 前先对名字。
