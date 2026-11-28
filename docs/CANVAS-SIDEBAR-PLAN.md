# 画布 / 组件库统一进侧边栏 · 接入方案

> 立单：2026-11-28（用户：「请把现有的两个画布完整接入侧边栏……两个画布不再保留独立界面，全部统一在侧边栏中展示」）
> 状态：**方案待拍板**（本文只描述改造路径与判据，不动代码）

## 1. 结论（先说三句）

1. **画布其实已经在右栏标签页里了**（`03-review-panel.tsx:467` 的 `variant="inline"`）——
   缺的不是"接"，而是**把另一处独立弹层（`AppView.tsx:897` 的 overlay）拆掉**，让右栏成为唯一载体。
2. **"两个画布" = 同一个组件的两种 flow**：`flow.type === "drama"`（短剧工作流）与 `"image"`（生图工作流），
   见 `DramaCanvas.tsx:367` 的标签文案。它们不需要两套界面，只需要在右栏里能互相切换（现已有切换按钮）。
3. **组件库不在侧边栏**，它现在是**设置页里的一个内页**（`08-settings-sheet/.../capabilities.tsx` 的 `component-library`），
   数据是本地控件皮肤目录（`lib/ui-skin/catalog.gen`），**不是** `ui_component_search` 那 3800+ 网页组件。

⇒ 本轮真正要做的三件事：**① 拆 overlay ② 右栏加宽度两态 ③ 组件库搬进右栏并接 3800+ 组件检索**。

## 2. 现状盘点

| 板块 | 挂载点 | 形态 | 备注 |
|---|---|---|---|
| 短剧 / 生图画布 | `03-review-panel.tsx:467` `variant="inline"` | 右栏标签页「画布」 | 完整功能已可用 |
| 同上 | `AppView.tsx:897`（默认 `overlay`） | **独立弹层**（`dramaCanvasOpen`） | 入口在侧栏「功能入口 → 画布」（`01-sidebar-shell.tsx:742`） |
| 图像工坊 | `image-lab/index.ts` 只导出 `ImageLabBridge` | 事件桥，**无可见界面** | 模型调 `image_edit` 等由它接 |
| 组件库 | 设置页 `component-library` | 设置内页（控件皮肤） | 不在右栏，也不覆盖 3800+ 网页组件 |

右栏尺寸口径（`lib/panel-zoom.mjs`）：默认 **308px**，可拖拽；`setPanelMaximized(true)` = 覆盖主区（实测 1035px）。

## 3. 目标形态

### 3.1 右栏唯一载体

```
右栏标签条：监控 · 变更 · 审阅 · 浏览器 · 文件 · 图片 · 画布 · 组件库 · 终端
                                                        ↑ 新增
画布页内部：flow 切换（短剧工作流 / 生图工作流）—— 保持现状，不加第二个标签
```

### 3.2 两态展示规则（用户原话：收起或较小时只给精简；展开才给完整）

用**宽度断点 + 容器属性**驱动，**不写两套组件**（两套 = 状态分裂）。

| 状态 | 判据 | 展示 | 交互 |
|---|---|---|---|
| **精简**（侧栏窄/默认） | 右栏宽度 < 480px 且未最大化 | 卡片只留：标题 + 类型徽标 + 一行摘要（提示词前 40 字 / 产物缩略图 96px）+ 状态点；隐藏检查器、时间轴、批量工具条、缩放胶囊、连线手柄 | 只读：可滚动；⛔ 禁用拖拽/连线/框选/**右键菜单**/双击检查器（11-28 审查补：这三个入口都是写操作或死交互） |
| **完整**（展开） | 宽度 ≥ 480px，或点击放大（覆盖主区） | 现有一切：卡片全字段、连线、右键菜单、检查器、时间轴、批量生成 | 全功能 |

实现要点：
- 面板根加 `data-density="compact|full"`，由 `ResizeObserver` 测宽度写入（**不是** JS 分支渲染两棵树）；
  CSS 里 `.drama-canvas[data-density="compact"] .drama-canvas-card-actions { display: none }` 这类**减法**规则。
- 断点常量集中一处（`lib/panel-density.mjs`），AppView / 右栏 / 画布三方共用。
- 精简态下 React Flow 传 `nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}`，避免"点了就动"。

## 4. 迁移流程（4 阶段，每阶段独立可验收）

### 阶段 1 · 收口 overlay（约 4 处改动）
1. `01-sidebar-shell.tsx:742` `case "drama-canvas"` → `setRightOpen(true); setRightTab("canvas")`（不再 `setDramaCanvasOpen(true)`）；
2. `AppView.tsx:897` 删 `<DramaCanvas>` overlay 挂载；
3. `bag-types.ts` 删 `dramaCanvasOpen / setDramaCanvasOpen`（**两处**：声明 + 实现文件，见「bag 新字段改两处」纪律）；
4. 守卫 12aa / 侧栏入口断言同步。
判据：全仓 `grep dramaCanvasOpen` 为 0；侧栏点「画布」→ 右栏打开并切到画布页。

### 阶段 2 · 两态密度
1. 新增 `src/lib/panel-density.mjs`（宽度 → `compact | full`，含阈值常量与订阅）；
2. 右栏根与画布根写 `data-density`；
3. CSS 只做**减法**（精简态隐藏次要区），⛔ 不改完整态任何样式；
4. 精简态关掉 React Flow 的拖拽/连线/选择。
判据：CDP 把右栏拖到 360px → `data-density="compact"` 且动作条消失；点放大 → `full` 且全功能回来。

### 阶段 3 · 组件库进右栏
1. `PANEL_TABS` 加 `{ key: "library", name: "组件库" }`；
2. 把 `ComponentLibraryPage` 从设置页搬到右栏页（保留设置页那条入口，改指向右栏）；
3. 组件库补**搜索 + 虚拟滚动**（3800+ 条不能一次渲染，现分页 24/页可先用）；
4. 数据源对齐：把 `ui_component_search` 的目录（3800+）接成**第二个 tab**（「网页组件」）或并入同一搜索框，二者共用一套 `results` 渲染。
判据：右栏点组件库 → 列表出数；搜索"button"能出结果；点卡片能「交给 Codex」（沿用现有 `onHandoff`）。

### 阶段 4 · 工具调用 → 侧边栏实时渲染
现有范式直接复用（`lib/canvas-activity.mjs` 的三类消费者：AppView 桥 / 标签绿灯 / 画布回填队列）。
1. 工具 → 页面映射表（单一真相源，放 `lib/tool-surface-map.mjs`）：
   `workflow_read|workflow_writeback` → `canvas`；`image_edit|image_info|photocraft` → `image`；
   `ui_component_search|ui_component_get` → `library`；
2. 主进程广播事件 → 渲染层桥 `setRightOpen(true) + setRightTab(映射值) + 亮灯`（绿灯时长沿用 9s）；
3. 画布 / 组件库挂载时消费"挂载前到达的事件"（沿用 `takeCanvasImage` 那套排队语义）。
判据：让 Codex 调一次 `workflow_read` → 右栏自动开、切到画布、标签亮绿；调 `ui_component_search` → 切组件库。

## 5. 风险与不变量

| 风险 | 处理 |
|---|---|
| 精简态被当成"坏了"（功能不见了） | 精简态顶部给一条「展开看完整画布」按钮，直接切最大化 |
| 两套渲染导致画布状态分裂 | ⛔ 只做 CSS 减法 + React Flow 交互开关，**不挂载第二份 DramaCanvas** |
| 右栏宽度持久化与断点打架 | 断点只看**实时宽度**，不看"用户上次拖到多少" |
| 3800+ 组件一次渲染卡死 | 虚拟滚动或分页（现成 24/页），而且搜索必须走服务端/索引而非全量 filter |
| 守卫 | 新增 tab 要同步 `PANEL_TABS` + 12aa 右栏断言 + 侧栏入口断言 |

## 6. 需要拍板的三件事

1. **"3000 多个组件"具体指哪个？** 代码里有两个来源：①本地控件皮肤库（`ui-skin`，几十套）；
   ②`ui_component_search` 的 3800+ 网页组件（MCP）。我按 ② 做，①作为第二个子页 —— 对吗？
2. **精简态要不要允许"点卡片进全屏"**？还是彻底只读、必须手动放大？
3. **组件库是否替换设置页那条入口**（避免两个入口维护两套），还是保留双入口？
