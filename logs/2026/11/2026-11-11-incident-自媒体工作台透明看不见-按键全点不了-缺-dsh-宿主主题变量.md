---
id: 2026-11-11-incident-自媒体工作台透明看不见-按键全点不了-缺-dsh-宿主主题变量
date: 2026-11-11
kind: incident
area: media-desk
title: 自媒体工作台「透明看不见 / 按键全点不了」= 缺 DSH 宿主主题变量
tags: [media-desk, theme, dsw, tokens]
commits: []
files: [resources/media-desk/index.html]
importance: normal
---

# 自媒体工作台「透明看不见 / 按键全点不了」= 缺 DSH 宿主主题变量

## 背景
用户实测「这个界面，按键都点不了」+「不建议都透明啊，都透明看不见」。真鼠标在设置页其它按钮上正常（OS 级点击对照通过），iframe 内 nav 也能点；但画布/弹窗背景是透明的。

## 结论
根因不在点击链路，在**主题变量缺失**：dsh-media-desk 的样式全部建立在 DSH 宿主 token 上（客户端里用到 26 个 `--dsw-alias-*` / `--dsw-elevation-*` / `--dsw-radius-*` / `--dsw-font-family`）。我们只嵌了客户端与宿主源码，最小页面没注入这些变量：
- `--bg`/`--glass` → transparent（画布透明）；
- `--ink` → undefined ⇒ 默认黑字，暗色下看不见；
- `--dsw-alias-bg-mask-1` → 透明 ⇒ **点开弹窗时遮罩看不见，但仍在拦截点击** ⇒ 整页「按键全点不了」。
修法：`resources/media-desk/index.html` 补齐 26 个 token（亮/暗两套，`prefers-color-scheme` 跟随 nativeTheme），body 强制 `background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary)`；弹窗遮罩给半透明真值。

## 依据
- 探针：OS 点击设置页「外观」可切换、iframe 内 nav 五连击全部生效（灵感→内容→复盘→排期→风格），说明输入链路正常。
- 补变量前：`.md-dialog-mask` 背景透明；补后实测 `mask rgba(15,23,42,.34)`、面板 `rgb(255,255,255)`、body `rgb(245,245,243)`。
- 守卫 12bi 新增「token 逐个比对」（删一个 `--dsw-radius-panel` 立即红）；验收 media-desk 10/10（页面不透明 / 遮罩有真值 / 弹窗遮罩可见 + 面板不透明）。

## 影响面
- 仅 `resources/media-desk/index.html`（随包页面壳）与相关守卫/验收；上游 client/host 一字未改。
- 用户在暗色主题下也能看清工作台；所有弹窗可见且不再挡点击。

## 回滚
回退本轮提交即回到「透明壳」状态；不建议（会重现看不见 / 点不动）。
