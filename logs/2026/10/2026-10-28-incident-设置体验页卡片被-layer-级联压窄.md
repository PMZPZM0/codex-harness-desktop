---
id: 2026-10-28-incident-设置体验页卡片被-layer-级联压窄
date: 2026-10-28
kind: incident
area: settings-ui
title: 设置体验页卡片被 @layer 级联压窄
tags: [settings, layout, css-layers]
commits: []
files: [src/styles/45-settings-experience.css, scripts/accept.mjs, scripts/guards/12ad-settings-unified.mjs]
importance: high
---

# 设置体验页卡片被 @layer 级联压窄

用户截图：个性化页「回复风格」「自定义指令」卡只占左边一半，右边一大片空白。用户原话：「我昨天特意让做的自适应长度到右边」。

根因：10-28 的 @layer 重构后，全局 `.settings-section { align-items: flex-start }`（components 层）对本页生效；`.settings-exp-page` 没显式 align-items ⇒ flex 纵向容器的直接子卡按内容宽收缩（实测 page 726px，group 328px）。不是个性化页自己的 max-width 问题。

修法：`.settings-exp-page` 加 `align-items: stretch`（pages 层，晚于 components）。实测 group 722 / page 726，右侧铺满。

防回归：
· 验收 ⑧ 增加 `groupW >= pageW - 12`（真窗口几何）；
· 守卫 12ad 加一条：`.settings-exp-page` 必须有 `align-items: stretch`。

影响面：所有 `.settings-exp-page`（控制台/外观/个性化/宠物/应用锁）一并恢复满宽。
