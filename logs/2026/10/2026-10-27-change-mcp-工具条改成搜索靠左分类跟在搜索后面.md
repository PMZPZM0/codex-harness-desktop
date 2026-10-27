---
id: 2026-10-27-change-mcp-工具条改成搜索靠左分类跟在搜索后面
date: 2026-10-27
kind: change
area: settings-ui
title: MCP 工具条改成搜索靠左、分类跟在搜索后面
tags: [settings, mcp, toolbar]
commits: []
files: [src/features/settings-mcp/McpSettingsSection.tsx, src/styles/07-settings-mcp-connectors.css, scripts/accept.mjs]
importance: normal
---

# MCP 工具条改成搜索靠左、分类跟在搜索后面

用户令（MCP 页截图）：「搜索框靠左，分类选项放到搜索框后面」。

## 事实

- 工具条 = `.resource-toolbar.mcp-market-toolbar`，原顺序 `[分类▾] [搜索] … [添加 MCP][刷新]`。
- 共享样式 `.resource-toolbar .search-field { flex: 1 1 190px; }`（12-settings-skills.css），
  搜索框会吃掉中间所有空间。

## 改法

1. DOM 顺序换成 `[搜索] [分类▾] … [添加 MCP][刷新]`，与技能页同一套排法。
2. 给 MCP 的搜索框加宽度上限：`flex: 0 1 240px; min-width: 170px;`，
   否则它会拉满整行、把分类挤到最右贴着按钮 —— 看起来就不是「跟在搜索后面」。
3. 操作按钮不用动：`.skill-toolbar-actions` 自带 `margin-left: auto`。

## 一个坑

⛔ 选择器必须写成 `.resource-toolbar.mcp-market-toolbar .search-field`（特异度 0,3,0）。
第一版只写 `.mcp-market-toolbar .search-field`（0,2,0），与 `.resource-toolbar .search-field` 同特异度，
而 12-settings-skills.css **后导入**（styles.css 里 07 在前、12 在后）⇒ 被对方压回去，
实测搜索框仍是 305px 满宽、分类贴在按钮边上。

## 验证

- tsc 通过；vite build 通过。
- 守卫 12ad 103/103。
- 真机验收 settings-current 新增第 ⑫ 项：`order === "search-field>mcp-category-filter"` 且
  `search.left < cat.left - 20`、两者垂直中线差 ≤10px（同一行）。
- 几何实测：搜索框 240×（left 408 → right 648）、分类 left 657 → right 837、按钮组 left 911。
- 截图核对：一行「[搜索] [分类 全部▾] … [+ 添加 MCP][刷新]」。

## 备注（同轮并行线）

验收同轮还有 3 条红项（③ 外观思考板块、⑦ 控制台权限卡、⑧ 个性化回复风格），
是**并行会话正在重构那几页**造成的（`.card-reasoning` / `.perm-seg-btn` / `.personalization-style-grid`
被换掉了），不是本轮改动引起；那几条断言应由改版方按新结构更新。
