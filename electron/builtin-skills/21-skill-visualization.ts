/**
 * builtin-skills 的「visualization-guide」部分（10-17 用户立项：Codex 画可视化只会随手写 HTML，
 * WorkBuddy 的可视化规范与配套工具从未移植过来 —— 轻档先补"规范"，输出走既有的
 * 文件卡 → 预览 → 浏览器打开 通道（16:2x 已修中文路径与收起逻辑））。
 *
 * ⛔ 重档（render_widget 式宿主渲染通道）是独立立项：涉及 harness-api 生成器 + IPC + 渲染层，
 *    不要在本技能里教模型"直接碰"任何宿主内部。
 * ⛔ 目录名必须与 frontmatter 的 name 一致：visualization-guide。
 */
export const VISUALIZATION_SKILL = `---
name: visualization-guide
description: Produce visual outputs (flowcharts, architecture diagrams, sequence/state diagrams, roadmaps, gantt charts, comparison infographics, data charts, posters) as self-contained single files that render correctly in the app's built-in browser. Use when the user asks to 画/生成 流程图、架构图、时序图、路线图、甘特图、思维导图、对比图、数据图表、信息图、海报, or asks to visualize a plan/process/data. Covers format selection, hard output requirements, and design standards.
---

# 可视化输出规范（visualization-guide）

你要产出**可直接打开即看**的可视化文件。宿主有"文件卡 → 预览 → 浏览器打开"的完整通道，
所以正确姿势是：**把可视化做成一个自包含文件写到约定目录，然后在回复里给出路径**。

## 一、形态选择（先选对，再动手）

| 用户要的东西 | 形态 | 说明 |
|---|---|---|
| 流程图 / 判定图 / 时序图 / 状态图 / 甘特图 / 思维导图 / 饼图 | **回复里直接输出 \`\`\`mermaid 代码块** | 宿主对话内**交互渲染**（缩放/拖拽）+ 一键导出 SVG/PNG —— ⛔ 优先走这条，不要另写 HTML |
| 架构图 | 单文件 SVG 或 \`\`\`mermaid（graph TD/LR） | 节点少用 mermaid；节点多/要精确排版用手写 SVG |
| 路线图 / 行程 / 时间线 / 海报式信息图 | **单文件 HTML**（内联 CSS） | 固定宽度画布（如 1200px）+ 大标题 + 分区卡片 |
| 甘特图 | 单文件 HTML/SVG | 按天/周刻度画条带，标注依赖 |
| 数据对比 / 柱状 / 折线 / 占比 | **手写 SVG**（简单）或 HTML+内联脚本（复杂交互才用） | ⛔ 不引外部图表库——离线会白屏 |
| 思维导图 | 单文件 SVG | 中心向四周辐射，层级≤4 |

⛔⛔ **硬性输出要求（违反任何一条 = 交付失败）**：
1. **单文件**：CSS/JS 全部内联；**禁止**引用外部 CDN、网络字体、网络图片（用户可能离线/内网）。
2. 图片一律**内联 base64** 或用 SVG 原生图形替代。
3. 文件写到 \`.codex/visual/<slug>.html\`（或 .svg），**文件名用 ASCII slug**（如 \`hangzhou-route.html\`）；
   用户点名要别的位置/文件名时听用户的。
4. \`<meta charset="utf-8">\` 必须有；\`<body>\` 给 \`max-width\` + \`margin:auto\` 保证窄窗口可看。
5. 写完**必须在回复里给出文件的完整路径**（宿主会渲染文件卡，用户一键打开）——不写路径等于没交付。
6. **mermaid 语法错误 = 渲染失败**：节点 id 不用中文/括号，标签放 \`["文字"]\` 里；写完逐行检查箭头与节点定义是否成对。

## 二、设计规范（默认设计 token）

- **画布**：固定宽 1000–1200px；浅色底（#f7f5f0 / #f4f0e6 系），内容卡片用纯白 + 圆角 12–14px + 柔和阴影。
- **配色**：主色绿系 #1f6f5c / #134b3e；强调金 #c8a15a；警示橙 #c25a2b；文字 #20302c；辅助文字 #6b7d76。
  ⛔ 不用荧光色/深底浅字（打印和投影都差）。
- **字号层级**：主标题 40–52px / 区块标题 20–24px / 正文 14–16px / 注释 12px；行高 ≥1.5。
- **留白与对齐**：区块间距 26–34px；卡片内边距 20–28px；对齐只用网格（左对齐为主，居中仅用于标题/图例）。
- **信息密度**：一屏一个焦点；单块文字 ≤6 行；列表条目带序号；关键数字放大加粗。
- **图例齐全**：颜色/形状有含义就必须给图例；时间轴要有刻度和方向。

## 三、工作流

1. 判断形态（查表）；信息不足先问一句（要给谁看/横向还是纵向）。
2. 按"硬性输出要求"产出文件到 \`.codex/visual/<slug>.<ext>\`。
3. **自查**：改用浏览器打开视角过一遍——字体是否内联、颜色是否有图例、窄窗口是否不破版。
4. 回复里给出路径 + 一句"已生成可视化，点击文件卡或用预览的『浏览器打开』查看"。
`;
