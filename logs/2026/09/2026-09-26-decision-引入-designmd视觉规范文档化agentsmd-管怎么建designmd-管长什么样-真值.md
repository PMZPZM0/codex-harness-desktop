---
id: 2026-09-26-decision-引入-designmd视觉规范文档化agentsmd-管怎么建designmd-管长什么样-真值
date: 2026-09-26
kind: decision
area: docs
title: 引入 DESIGN.md：视觉规范文档化（AGENTS.md 管怎么建、DESIGN.md 管长什么样）+ 真值对账守卫
tags: [design-md, design-system, visual-spec, google-stitch, docs]
commits: []
files: [DESIGN.md, scripts/guards/06-app-behavior.mjs]
importance: high
---

# 引入 DESIGN.md：视觉规范文档化（AGENTS.md 管怎么建、DESIGN.md 管长什么样）+ 真值对账守卫

## 起因

用户给了开源项目 `VoltAgent/awesome-design-md`（MIT，118k stars）让我看。

**它是什么**：DESIGN.md 是 **Google Stitch** 提出的概念 —— 一个纯文本的**设计系统文档**，
AI agent 读它来生成视觉一致的 UI。定位对照：

| 文件 | 谁读 | 定义什么 |
|---|---|---|
| `AGENTS.md` | 编码 agent | 项目**怎么建** |
| `DESIGN.md` | 设计/改 UI 的 agent | 项目**长什么样** |

该仓库收集了 **73 个品牌**的 DESIGN.md（Claude / Cursor / Linear / Figma / Notion / NVIDIA / Ferrari…），
每个约 33KB，章节结构成熟：Overview / Colors（含语义分组）/ Typography / Layout / Elevation /
Shapes / Components / Do's and Don'ts / Responsive / Iteration Guide / **Known Gaps**。

## 我们的现状（为什么值得做）

- 20 个 CSS 文件、**24 个语义 CSS 变量**（集中在 `src/styles/01-base-and-chrome.css`）、
  `:root[data-theme="dark"]` 亮暗双主题 —— 视觉规范**全部是隐式的**，散在 CSS 里。
- 根目录已有 `AGENTS.md`，但**没有任何视觉规范文档**。
- 直接后果：每次改 UI 都要**逐个读 CSS** 才能摸清色板与类名约定（v7 办公室那轮就是这么过来的）。

## 落地

根目录新建 **`DESIGN.md`**（与 `AGENTS.md` 并列），照它的成熟结构写，但**所有值都是实测取出的**：

- **Colors**：24 个变量的亮/暗两栏对照表 + 用法规则（不许硬编码色值、层级靠 bg→panel→panel-2 递进、
  语义色只表意、`--accent-text` 必须配 `--accent` 底用）。
- **Typography**：`Inter, "Segoe UI", system-ui, sans-serif`；`--mono` 为 Cascadia Code / Consolas。
- **Components**：真实类名表（`.app-shell` / `.turn-group` / `.action-card` / `.approval-card` /
  `.composer-menu-pop` / `.ofc-*`），并记下命令面板**两列必须按基线对齐**这条实测结论。
- **Theming**：`data-theme` 机制；⛔ 固定插画（办公室）**不跟随主题**（反色会发脏）。
- **Known Gaps**：诚实列出"没有统一间距/圆角/字号 scale""深色主题是另一套手调值，最容易漏"。

## 关键设计：守卫做的是「真值对账」，不是「文件存在」

这类文档最大的风险是**和代码漂移** —— 变量改了文档没跟 ⇒ 它变成骗人的东西，比没有还糟
（后来改 UI 的 agent 会照着错的色板写）。"文件存在吗"这种断言恒真、等于没写。

守卫【170】3 条：存在 / 章节齐备 / **变量表的亮暗两栏必须等于 CSS 里的真值**。
变异验证：把 CSS 里 `--panel` 改成 `#f8f8f8` ⇒ 断言红并精确报出 `panel 亮 #f8f8f7≠#f8f8f8`。

## 判据

tsc 0 错、预检 0 条真红；【170】3 条全绿 + 变异可红。
