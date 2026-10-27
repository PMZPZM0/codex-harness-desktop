---
id: 2026-10-27-change-openfilm-对接批次一安装入口-镜像-声明7-通道
date: 2026-10-27
kind: change
area: openfilm
title: OpenFilm 对接批次一：安装入口 + 镜像 + 声明（7 通道）
tags: [openfilm, install, ui]
commits: [5494c25d4]
files: [electron/features/openfilm-ipc.ts, src/features/openfilm/OpenfilmCard.tsx, scripts/guards/23-openfilm.mjs]
importance: high
---

# OpenFilm 对接批次一：安装入口 + 镜像 + 声明（7 通道）

已落地（P0+P1）：openfilm 域 7 通道（status/install/retry/uninstall/settings-get/settings-set/update-check）+ 开发工具页按需下载卡 + 开源声明 + 新守卫 23（37/37）。

关键取舍：CLI 装进 <tools>/openfilm/runtime（私有 prefix，不污染全局）；chromium 走 playwright 自己的 PLAYWRIGHT_DOWNLOAD_HOST（cdn.npmmirror.com → 官方两跳）；ffmpeg 只认内置/系统（不下载第三方二进制，避 GPL 传染）；卸载只删 runtime + 安装标记（⛔ 不碰用户影片）；版本比较只走 compareVersions。

真机实测：status=absent、内置 node 24.19、设置往返、update-check 从 npmmirror 读到 0.2.6、uninstall 幂等、卡片渲染（声明链接/5 分段/4 灯）。

未做（下一批）：Studio open + session 守护 + 内置浏览器联动；openfilm_* dynamicTools 与内置技能；桌面 App 安装包形态。
