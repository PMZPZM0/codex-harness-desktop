---
id: 2026-11-22-incident-macos-自定义模型自动探测超时windows-正常
date: 2026-11-22
kind: incident
area: other
title: macOS 自定义模型自动探测超时（Windows 正常）
tags: [mac, probe, network, timeout]
commits: []
files: [electron/features/custom-model-probe.ts, scripts/guards/06-app-behavior/part-01.mjs]
importance: high
---

# macOS 自定义模型自动探测超时（Windows 正常）

## 现象
用户截图：mac 上「自动配置模型 → 自动检测模型」报
`custom-model:probe: 该网关不提供 /models 列表接口：连接超时（服务器长时间无响应）`；
同一 Base URL / Key 在 Windows 上正常（本机实测 `GET /v1/models` 87ms 返回 401 = 网络通）。

## 根因（两层）
1. `/models` 探测只有 **8 秒**。mac 上 Chromium 若拿到 AAAA 但 IPv6 无路由，Happy Eyeballs
   回落 IPv4 可能超过 8s ⇒ 被当成超时。
2. 超时被归入「/models 返回不可用」分支，界面文案说成「**该网关不提供 /models**」——
   把网络问题甩给供应商，用户会去换网关/找模型，方向全错。

## 修复
- `probeFetch` 改**双传输栈**：Electron `net.fetch`（Chromium，遵循系统代理）先试 70% 预算；
  网络层失败后，用 Node `fetch` + `dns.setDefaultResultOrder("ipv4first")` 再试 30%。
  两条栈都失败才算失败（HTTP 4xx/5xx 是正常响应，不兜底）。
- `/models` 预算 8s → **20s**（14s + 6s）。
- 网络失败单独报：给出 macOS 代理 / VPN / 防火墙排查指引 + `curl -I <base>/models` 自检；
  不再说「不提供 /models」。
- 失败写 `userData/logs/probe.log`：平台、host、两栈错误、代理模式（DIRECT/PROXY）、地址族；
  ⛔ 不写 Key / URL 路径 / IP。
- 守卫 06 part-01 新增一条断言（双栈 + ipv4first + 20s + 新文案）。

## 影响面 / 回滚
- Windows 主路径不变（net.fetch 成功即返回），仅失败时的等待上限变成 20s。
- 回滚：恢复 `probeFetch` 单栈与 8s 即可；新文案可保留。
- 需要在 mac 上重新构建/发版才生效；当前已发布版本不含此修复。
