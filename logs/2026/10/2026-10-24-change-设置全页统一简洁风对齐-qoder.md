---
id: 2026-10-24-change-设置全页统一简洁风对齐-qoder
date: 2026-10-24
kind: change
area: ui
title: 设置全页统一简洁风（对齐 Qoder）
tags: [settings, layout, flat, shell]
commits: [79339ef]
files: [src/styles/45-settings-experience.css, src/features/app-view/AppView/08-settings-sheet/01-settings-layout/02-settings-content.tsx, src/features/settings-model/ModelSettingsSection.tsx, scripts/guards/12ad-settings-unified.mjs, scripts/accept.mjs]
importance: high
supersedes: 2026-10-24-change-设置内页统一版式长卡片页头两行切页回顶
---

# 设置全页统一简洁风（对齐 Qoder）

# 设置全页统一简洁风（10-24 四轮，取代同日的「统一版式」方案）

## 结论

用户给出 Qoder 设置页截图（模式配置：平面标题、灰色分组小标题、白卡 + 细线、行内小图标），要求「设置里面都统一这种风格，简洁一点」。因此撤销同日上午那版的渐变头图 / 彩色卡片 / 强调色图标，改为：

1. **页头**：只有 20px 标题 + 一句 12.5px 灰色说明；操作按钮在标题行右侧，不再包卡片、不做渐变。
2. **分组**：12px 灰色小标题（如「常用」「记忆存到哪里」），不画分隔线。
3. **卡片**：`--panel` 底 + `--line-soft` 1px 细线 + 12px 圆角；图标胶囊统一 `--panel-2` 底 + `--muted` 图标，不按页面色相上色。
4. **全页覆盖**：`.settings-content` 无条件挂 `settings-exp-shell`，不再按 18 页白名单；模型 / 用户中心 / 中转站 / OpenAI 订阅 / 开发工具 / 拓展接口 / 会话备份一并扁平化。
5. **长卡**：供应商卡、中转/OpenAI 账号卡、开发工具/拓展入口、备份卡全部一列；模板两列且落单占满整行；记忆内容卡一列。
6. **切页**：`Suspense key={settingsPage}` 先把旧页卸成骨架，再滚回顶部（首帧 + 120ms 补两次），懒加载期间不再显示上一页。

## 为什么

- 上一版渐变与彩色卡片被用户判为「不简洁」；截图里 Qoder 的层级靠留白、字号、细线，而不是背景色和阴影。
- 之前「切页读到上一页页头」的验收失败，根因是 React 在懒加载期间保留旧树；`key` 让旧树立即卸载，顺带修好 UX。

## 判据

- 守卫 `12ad-settings-unified.mjs`：55 条；负向断言「统一简洁风里不再有渐变」；变异测试（改回三列方卡、把定时任务标题改回「自动化」）均当场报 ✗。
- 验收 `settings-unified`：24 页逐页等待新页头挂载后量真实 DOM，8/8；模型页页头 `background-image:none`、`padding-top:0`，供应商一列 672px 白卡。
- 主仓 `npm run check` 退出码 0；10-24 默认验收 21/21。
- 截图 `.e2e-artifacts/shots/01~31-简洁-*.png`（31 页全量）。
