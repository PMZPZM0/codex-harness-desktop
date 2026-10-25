---
id: 2026-10-25-incident-ppcode-侧栏品牌仍显示-codex-harnesslogo品牌串仓
date: 2026-10-25
kind: incident
area: branding
title: PPcode 侧栏品牌仍显示 Codex Harness（logo/品牌串仓）
tags: [branding, ppcode, logo, sync-rules]
commits: [9e607890, a530e75de, 69bd048]
files: [src/features/app-view/AppView/01-sidebar-shell.tsx, electron/features/window-factory.ts, electron/main.ts, scripts/guards/06-app-behavior.mjs, AGENTS.md, docs/REPO-WORKFLOW.md]
importance: normal
---

# PPcode 侧栏品牌仍显示 Codex Harness（logo/品牌串仓）

## 背景
用户发 PPcode 运行截图，红框圈住左上角品牌区：「不要串了啊，项目规则更新一下，
codexharness logo 和 PPcode logo 不要串了」。
截图里图标已经是 PP 标，但旁边的品牌名仍是 **Codex Harness**。

## 根因
- `01-sidebar-shell.tsx` 是从主仓同步过来的 UI 文件，品牌名写死 `Codex Harness`；
  10-22 的「身份基线改称 PPcode」只改了 `personalization.ts` / 生成器 / index.html，
  侧栏品牌块与窗口标题漏了，后来又被同步覆盖，所以一直没被发现。
- 没有任何守卫检查**界面品牌面**（旧的【235】只查身份基线文案与能力清单品牌）。

## 结论
- 侧栏品牌名单一来源 = `BRAND_NAME = "PPcode"`（图标仍用本仓 `public/icon.png` 的 PP 标）；
- 窗口标题 `PPcode` / `PPcode — 独立会话`；AUMID `com.ppcode.desktop`；
  页面标题、企微接入文案、拓展页数据目录示例统一 PPcode；
- 项目规则新增「**品牌不进同步面**」：桌面版/云助手 = Codex Harness Desktop + CH 图标，
  PPcode = PPcode + PP 图标；同步 diff 碰到品牌行必须保留各仓侧，**图标资产永不互拷**；
- 守卫 06【235】新增 6 条：侧栏品牌常量 + 窗口标题 + AUMID + 企微文案 + 目录示例 + 页面标题。

## 依据
- 实测（CDP，PPcode 持久 profile）：`.brand-name` = `PPcode`，`aria/title` 收起侧栏，
  `img.src=./icon.png` 已加载，`document.title=PPcode`；截图确认左上角 PP 标 + PPcode。
- 守卫 06【235】新增断言全绿；PPcode tsc / vite build / electron build 均 0 错。

## 影响面
仅 PPcode 品牌面与项目规则；不影响主仓/云助手 UI，不改任何数据目录（userData 仍是 `%APPDATA%/PPcode`）。

## 回滚
把 `BRAND_NAME` 与窗口标题/AUMID 改回 Codex Harness 会立刻复现串仓；
回滚需同时删守卫 06【235】新增的 6 条与 AGENTS/REPO-WORKFLOW 的品牌规则。
