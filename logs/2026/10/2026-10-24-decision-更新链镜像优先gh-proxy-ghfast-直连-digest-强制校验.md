---
id: 2026-10-24-decision-更新链镜像优先gh-proxy-ghfast-直连-digest-强制校验
date: 2026-10-24
kind: decision
area: updates
title: 更新链镜像优先：gh-proxy → ghfast → 直连 + digest 强制校验
tags: [updates, mirror, gh-proxy]
commits: [b93f506]
files: [electron/gh-mirror.ts, electron/updates.ts, scripts/guards/12e-update-mirror.mjs]
importance: normal
---

# 更新链镜像优先：gh-proxy → ghfast → 直连 + digest 强制校验

## 背景
用户问「GitHub 有国内镜像源吗」，要求把主应用与 PPcode 的检查更新/安装包下载改成国内镜像。GitHub 无官方国内镜像，走第三方反代前缀。

## 结论
- 镜像表单一真相源 `electron/gh-mirror.ts`：gh-proxy → ghfast → 直连（空串兜底）；`mirrorCandidates()` 只对 GitHub 自家五域加前缀，自建清单/非 GitHub host 原样返回（不把私有地址发给反代）。
- 检查与下载按候选序尝试、失败自动落下一档；每档开跑前删半截文件。
- ⛔ 镜像是第三方反代，理论上可篡改包体 ⇒ 接入 asset.digest（GitHub 对资产自带的 sha256），下载后强制比对、不匹配删文件换下一通道（直连是基准真相）。
- ⛔ PPcode 副本：带只读令牌的请求恒直连（令牌发给反代 = 凭据泄露；私有仓镜像也读不到）。401/403/404 语义判定只在直连档。

## 依据
- 10-11 实测（本机）：gh-proxy API 200 / 资产 200 全量流；**ghfast 对 api.github.com 已 403 "Invalid input"**（旧 AGENTS「两个都能代理 API」记录过时，已更正——ghfast 现在只当下载通道）；直连 302。
- 测速（30s 窗口、550MB 资产）：gh-proxy **14.4 MB/s（115 Mbps，约 1 分钟）**、ghfast 1.3 MB/s（约 7 分钟）、直连 ≈0（30 秒 0.1MB）。⛔ 速度随时段波动，需自行核实。
- 守卫 12e（两仓同一份、按 package name 分岔）：真值表真跑 + 5 处变异全抓。

## 影响面
- updates.ts（两仓）、codex-official-market / free-gateway 的本地镜像表收敛为别名；voice/model-store 除外（其顺序按实测速度排，语义不同）。
- 云助手已由并行会话同步（HEAD 已含 gh-mirror + 镜像化 updates.ts + 12d），其 API 名不同（ASSISTANT_RELEASES_LIST_API），12e 守卫不通用。

## 回滚
revert 主仓 b93f506 / PPcode d9f7390。digest 校验链建议保留（纯增益）。
