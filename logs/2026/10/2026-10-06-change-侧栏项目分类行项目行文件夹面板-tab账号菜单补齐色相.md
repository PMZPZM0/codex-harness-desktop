---
id: 2026-10-06-change-侧栏项目分类行项目行文件夹面板-tab账号菜单补齐色相
date: 2026-10-06
kind: change
area: 外观
title: 侧栏项目/分类行、项目行文件夹、面板 tab、账号菜单补齐色相
tags: [图标, 色板, 侧栏, CSS变量]
commits: [56ce3a0]
files: [src/features/app-view/AppView/01-sidebar-shell.tsx, src/features/app-view/AppView/03-review-panel.tsx, src/styles/15-queued-messages.css, src/styles/05-composer-input.css, src/styles/01-base-and-chrome.css, scripts/guards/11v-icon-palette.mjs, DESIGN.md]
importance: normal
---

# 侧栏项目/分类行、项目行文件夹、面板 tab、账号菜单补齐色相

## 需求

用户截图圈出侧栏「项目 / 分类」那一行（含右侧两个工具钮）与下面项目行的文件夹图标：
「这些图标，你还漏了彩色图标，完善一下，其他再检查一下」。

## 处理原则（本轮的关键判断）

不是"所有图标都染色"，而是分两类：

- **① 纯图标容器**（工具条两个钮）⇒ 容器挂 `ic-*`，规则读 `var(--ic, <原色>)`。
- **② 图标与文字/邻居图标混排** ⇒ 只给**那一个 svg** 挂 `ic-*`，文字与邻居保持中性。
  为此新增一条**枚举**规则 `svg.ic-blue, … { color: var(--ic) }`。
  ⛔ 必须逐个枚举：`[class*="ic-"]` 会误命中 `topic-*` / `basic-*` 之类类名。

## 上色清单

| 位置 | 图标 | 色 |
|---|---|---|
| 视图 tab 项目 / 分类 | FolderOpen / Layers | amber / cyan |
| 工具条 刷新 / 全部折叠 | ListRestart / Minimize2·Maximize2 | blue / violet |
| 项目行 文件夹 | FolderOpen | amber（同行展开箭头保持中性） |
| 筛选 chip 前缀文件夹 | FolderOpen | amber（同行关闭 × 保持中性） |
| 右侧面板 变更/终端/浏览器/项目树 | GitBranch/TerminalSquare/Globe2/FolderTree | green/cyan/blue/amber |
| 设置弹窗头 齿轮 | Settings2 | blue |
| 账号菜单 六项 | 语言/主题/缩放/更新/统计/用户中心 | cyan/pink/violet/green/blue/blue |

**刻意不染色**（写进守卫做负向断言）：项目行「⋯ 项目操作」与退出登录（破坏性动作）、
项目行展开箭头（状态指示）、顶栏调度开关（用主色表达开/关）。

## ⛔ 途中踩到一次文件损坏（已修，值得记）

`01-sidebar-shell.tsx` 核对时出现**未提交的行截断**：`setRemoteQr(s` 后半行没了，文件尾还少 4 行
⇒ `tsc` 报 JSX 不闭合。查证：HEAD 该行 503 字符且完整、工作区只有 415 字符 ⇒ **未提交的损坏**。
恢复：脚本内置"内容形状不符即中止"双重校验（防恢复错行），从 HEAD 精确取回该行 + 尾部 5 行，
`tsc -b` EXIT=0。
⚠️ 该文件同时有并行线的 `NewbieGuide` 改动 ⇒ 提交按 hunk 筛分（12 hunk：归我 10、归并行线 2）。

## 验证

- 守卫 `11v-icon-palette` 38 → **62/62**。
- **CDP 在构建产物上读到计算色**（证明确实生效，且中性项确实没被染色）：
  - 项目 tab `rgb(232,131,12)` amber / 分类 tab `rgb(11,114,133)` cyan
  - 刷新 `rgb(47,107,221)` blue / 折叠 `rgb(112,72,232)` violet
  - 项目行文件夹 `rgb(232,131,12)` amber / **同行展开箭头 `rgb(111,111,105)` = `--muted` 未染色**
- ⛔ 真跑抓到本轮新写的断言**连续两次假红**，都是同一个老坑：`[^>]*` 被 `onClick={() =>` 的 `>`
  截断 ⇒ 面板 tab 断言改成 `title="…"[\s\S]{0,200}?><\w+ … className="ic-x"`。
- 26 个守卫：2 条红均属并行线在途（`11h-ui-sketch`、`11r-whats-new`）。
  收尾三项全绿；`tsc -b` EXIT=0；已 `npm run build`。
