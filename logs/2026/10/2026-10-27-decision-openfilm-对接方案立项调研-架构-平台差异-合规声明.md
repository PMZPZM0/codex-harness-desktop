---
id: 2026-10-27-decision-openfilm-对接方案立项调研-架构-平台差异-合规声明
date: 2026-10-27
kind: decision
area: openfilm
title: OpenFilm 对接方案立项（调研 + 架构 + 平台差异 + 合规声明）
tags: [openfilm, integration, design]
commits: []
files: [docs/OPENFILM-INTEGRATION-2026-10-27.md]
importance: high
---

# OpenFilm 对接方案立项（调研 + 架构 + 平台差异 + 合规声明）

调研结论：OpenFilm（github.com/openfilm/openfilm，MIT + 商标条款，v0.2.6）是「影片=网页」的 agent 工具，对外接口只有 CLI（open/look/render/get/skills/skill/doctor/update）与本地 Studio HTTP 服务，无 MCP / 无账号。对接本质=装 CLI + 开 Studio + 教模型按 film.html 契约改片。

方案要点：新独立板块 openfilm（一个前缀）；安装器分 5 步可单步重试（Node/npm→CLI 私有 prefix→Chromium→ffmpeg→doctor 校验）；镜像候选序（npm=registry.npmmirror.com、Chromium=cdn.npmmirror.com/binaries/playwright、桌面 App=gh-mirror）；控制台三档自动更新（版本比较只认 compareVersions）；5 个宿主 dynamicTools + 1 个内置技能；film 库放 <workspace>/films（避开含空格的 userData）。

平台硬差异：Windows 桌面端只有 x64 且 NSIS 未签名；macOS 包未公证需 xattr 清 quarantine；ffmpeg 不内置（GPL 传染），只引导 winget/brew。

⛔ 未实施；设计稿里 5 条〔待实测〕（Studio 库共享路径 / playwright 镜像可用性 / NSIS 静默参数 / 未公证启动 / 4K 渲染基线）必须先跑。
