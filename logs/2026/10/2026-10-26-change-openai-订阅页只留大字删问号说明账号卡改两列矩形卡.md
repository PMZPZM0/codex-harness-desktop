---
id: 2026-10-26-change-openai-订阅页只留大字删问号说明账号卡改两列矩形卡
date: 2026-10-26
kind: change
area: settings-ui
title: OpenAI 订阅页只留大字：删问号/说明、账号卡改两列矩形卡
tags: [openai, settings, ui]
commits: []
files: []
importance: normal
---

# OpenAI 订阅页只留大字：删问号/说明、账号卡改两列矩形卡

# OpenAI 订阅页只留大字：删问号/说明，账号卡改两列矩形卡

用户截图令：「问号删除，小文字注释删除大字就行，账户长卡片改成长方形卡片，不要拉这么长，注意美观度布局」。

## 改动

- 页头整块（`settings-copy`）删除：页头 `PageInfo` 问号与副标题「多账号统一监控订阅与额度；切换后重启生效。」都不再渲染。本页现在没有 ? 说明入口，是用户明确要求删的，别再补。
- 空态卡改为一行状态文字「暂无已保存账号」（`.openai-empty-line`，图标 + 12.5px 灰字），原来的说明段「点下方「添加 OpenAI 账号」…」删除。
- 两张添加卡删掉 `<small>` 说明，只留图标 + 大字。
- 添加卡不再 `grid-column: 1 / -1` 横贯整行：`.settings-exp-shell .openai-account-grid` 改两列 `minmax(300px,1fr)`，两张添加卡并排成 335×64 的矩形卡；账号卡也从一列长卡恢复两列网格。
- 与中转站页（007386190）保持同一套「只留大字」语言，但中转站页的 `grid-column: 1/-1` 仍只作用于中转站页。

## 验证

- 守卫 12ad：新增 3 条（无 PageInfo / 无页头说明；两张添加卡无 small；添加卡 `grid-column:auto`），73/73 通过。
- 验收 `settings-current`：新增第 ⑤ 项，实测 682px 网格下两张 335×64 卡片同一行、无 `page-info`、无 `settings-copy`，5/5 通过。
- 截图：CDP 隔离 profile 实测页面（`openai-layout-01-openai-subscription-layout.png`）。
