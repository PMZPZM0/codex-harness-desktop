---
id: 2026-10-31-change-云助手清理一二布布残留-codex-身份卡两栏布局
date: 2026-10-31
kind: change
area: ui
title: 云助手清理一二布布残留 + Codex 身份卡两栏布局
tags: [avatar, bubu, user-center, cloud-ui]
commits: []
files: [src/styles/16-settings-ssh.css, src/lib/avatar-presets.ts, src/features/markdown/Markdown.tsx, scripts/guards/06-app-behavior.mjs]
importance: normal
---

# 云助手清理一二布布残留 + Codex 身份卡两栏布局

## 背景
用户截图两处：① 用户中心「换个头像 / 内置形象」里仍有一二布布与熊系头像；② 「Codex 的身份」卡右半边大片空白。

## 结论
① 一二布布主题包在**云助手仓**从未同步主仓 10-25 的移除提交（主仓 / PPcode 早已干净）。本次整套删除：5 张头像、布布贴纸包（public/stickers/bubu）、`bubu://` 渲染与 URL 放行分支、预设表条目、`persona_apply` 里 self/yierbubu 的描述、布布守卫 12ae 与验收项；守卫 06 改成**负向断言**防止复活。云端界面已重新部署并校验（旧素材线上 404）。
② 身份卡是整宽容器，但内置形象网格写死 `max-width: 392px` ⇒ 右侧永远空着。最终版（用户看过两栏草稿后反馈「注释太多且换行、左下空一块」）：回到**整宽单列**，6 个内置形象**一行铺满整卡**（窄窗 3 列），名字输入框弹性填充；两条说明注释直接删除（只留标题 / 名字 / 形象）；守卫 06 与验收口径同步（codexCols 6）。

## 依据
- 主仓删除提交 `2e4e260ad`（10-25，版权原因）的文件清单与文案。
- 线上校验：`/cloud/app/index.html` 引用新哈希；`avatars/user-bubu.png`、`avatars/bear-brown.png` 均 404，`user-panda.png` 200。
- 守卫输出：三仓「用户头像 5 列；Codex 形象 6 个铺满整行（窄窗 3 列）」与云助手「第三方 IP 头像与贴纸包不许复活」均 ✓。

## 影响面
- 云助手：头像/形象列表少 4 项（布布 1～2 项 + 熊系 3 项），贴纸语法 `bubu://` 不再渲染（回退为普通图片/alt）。
- 三仓：Codex 身份卡布局；验收 `用户中心` 项的列数断言。
- 其它：用户若曾选过已删除头像，档案里的路径会失效（与主仓 10-25 之后的行为一致，未做迁移）。

## 回滚
回退对应提交即可；云助手需重新 `node scripts/deploy-cloud-ui.mjs` 才生效（本地 dist 仅兜底）。
