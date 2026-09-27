---
name: arch-diagram
description: 架构图引擎（archkit）——把 typed JSON 规格渲染成自包含可交互 HTML（architecture / workflow / sequence / dataflow / lifecycle **5 型齐**，含两版 delta 对比与视觉回归门禁）。当用户要求「画架构图 / 工作流 / 时序图 / 数据流 / 状态机 / 生命周期」「把某个模块的关系可视化」「给这份设计出一张图」「对比两版架构」时使用。产出离线可开、可导出 PNG、节点锚定证据文件。
---

# arch-diagram（archkit）

本技能是 archify（MIT）方法论的**净室复刻**：typed JSON-IR → 严格校验 → 确定性渲染 → 自包含 HTML。
不包含上游任何代码、文案或素材；schema 与实现均为本仓自写（`src/lib/archkit-model.mjs` + `archkit-render.mjs`）。

## 何时用

- 给模块/子系统画架构全景（节点锚定真实文件路径作证据）；
- 画工作流/决策流程（workflow）、参与方消息时序（sequence）；
- 需要**可交付**的图：离线双击可开、可导出 PNG、深浅主题、可缩放平移。

不要用于：聊天里的临时 mermaid 块（渲染层已有）。

## 用法

```bash
node scripts/archkit.mjs demo -o arch.html          # 先看效果：本仓库自己的架构图
node scripts/archkit.mjs validate in.json           # 只校验
node scripts/archkit.mjs deliver  in.json -o a.html # 渲染 + 确定性回执（sha256）
```

## 输入规格（JSON）

```jsonc
{
  "type": "architecture",            // architecture | workflow | sequence
  "title": "…",
  "nodes": [{
    "id": "codex", "kind": "module",  // architecture: entry/module/store/infra/external
    "label": "codex-server",          // workflow: start/end/step/decision; sequence: actor
    "note": "…",
    "evidence": ["electron/codex-server.ts"]   // ⛔ 非 external 节点都应带证据
  }],
  "edges":   [{ "from": "a", "to": "b", "label": "stdio JSON-RPC", "style": "solid" }],
  "messages": [{ "from": "A", "to": "B", "text": "请求", "style": "dashed" }]  // 仅 sequence
}
```

校验是 **fail-closed**：id 重复、连线端点不存在、kind 不认识 ⇒ 整份拒收，不做静默修复。

## 三层证据分离（⛔ 不许混）

1. `deliver` 的回执（sha256 + 计数）只证明"渲染了什么"；
2. 真浏览器截图 / 数非背景像素才证明"看起来对"；
3. 人眼评审证明"这张图该不该这么画"。汇报时不得把其中一层说成另一层。

## 验收口径（写给你的 agent 同伴）

- 产物 HTML 无任何外链（守卫【182】钉死）；同输入两次渲染逐字节一致；
- 视觉取证：Electron 离屏截图后**数非背景像素**，不许只数 `nodes.length`。

## 图型（5 型齐，09-27）

- `architecture`（entry/module/store/infra/external）· `workflow`（start/end/step/decision）·
  `sequence`（actor + messages）· `dataflow`（source/process/store/sink/external，数据从哪来到哪去）·
  `lifecycle`（state + 自环转移，圆环布局状态机）。

## delta 对比与视觉门禁

```bash
node scripts/archkit.mjs delta v1.json v2.json -o delta.html   # 新图渲染 + Δ 增删改摘要面板
node scripts/archkit.mjs visual-check delta.html baseline.png --update  # 首次建基线
node scripts/archkit.mjs visual-check delta.html baseline.png  # 之后每次：像素比对 ≤0.5% 过，否则 exit 1
```

⛔ 基线按机器生成（字体渲染平台差），跨机器比较无意义；确认改动是预期的才 `--update`。

## 未实现（诚实边界）

上游的图形编辑器式 delta 交互（并排拖动对比）未做——当前 delta 是"新图 + 增删改摘要面板"。
需要并排交互视图再排。
