# Archify 调研评估报告

> 调研对象：<https://github.com/tt-a1i/archify> · 主分支 `main` · 2026-09-27 取自 GitHub API 与仓库源码
> 调研目的：评估是否将其引入本项目（Codex Harness Desktop），供团队选型。
> ⛔ 事实来源全部为 GitHub 官方 API 与仓库实际文件；无法核实的项已在文中标注「**待核实**」。

---

## 0. 一句话结论（评估摘要）

**Archify 是一个「Agent Skill + 零依赖 CLI」**：把一段 typed JSON 规格渲染成**自包含、可交互、带校验回执的 HTML 架构图**（架构 / 工作流 / 时序 / 数据流 / 生命周期 五种）。它**不是服务、不是依赖库、不是编辑器**，本质是给 AI 编码智能体用的「画图技能包」。

对本项目的判断：**可以低成本引入（技能直接落 `$CODEX_HOME/skills/`，零代码改造），价值点明确（补齐「从描述/代码证据生成可交互架构图」这块空白），但要清醒两点**：① 它与我们已有的 Mermaid 渲染是**互补不是替代**；② 它的星数与活跃度信号存在**需要核实的异常**（见 §9.1），不宜把 star 量作为采信依据，应以源码质量与实际跑通为准。

---

## 1. 项目档案

| 项 | 值 | 来源 |
|---|---|---|
| 仓库 | `tt-a1i/archify` | GitHub API |
| 许可 | **MIT**（保留 Cocoon AI 版权行；第三方图标另有 NOTICE） | LICENSE / THIRD_PARTY_NOTICES.md |
| 语言 | JavaScript（ESM，`"type": "module"`） | package.json |
| 版本 | `2.17.0-dev.1`（**开发版，非稳定版**） | package.json / CHANGELOG |
| Stars / Forks | **72,575** / 4,903 | GitHub API（`repos` 与 `search` 两个端点一致） |
| Open issues | 178 | GitHub API |
| 创建 → 最近推送 | 2026-04-15 → 2026-09-27（调研当天仍在推） | GitHub API |
| 仓库体量 | 565 个文件 / 48.2 MB | git trees API |
| 定位自述 | 「Turn anything you want to understand, plan, or share into an interactive visual」 | README |
| 底座来源 | `based_on: Cocoon-AI/architecture-diagram-generator (MIT, v1.0)` | archify/SKILL.md 元数据 |
| 官网 / 演示 | <https://tt-a1i.github.io/archify/>（gallery / guide / start 三页静态站） | README |

---

## 2. 核心功能与定位

**它做什么**：把「一句自然语言描述 / 一份 JSON 规格 / 一段 Mermaid」变成一份**单文件 HTML**，内含：

- 内联 SVG 拓扑（非 canvas 位图 → 主题、字体、无障碍、缩放不失真）；
- 深色 / 浅色主题、四种视觉预设（`classic` 默认 / `signal-flow` / `blueprint` / `editorial`）；
- 浏览器端交互：平移缩放、节点搜索、聚焦、**关系追踪**、语义视图、演示模式、章节（≤5 个）；
- 导出：PNG / JPEG / WebP / SVG / WebM（WebM 即「可播放的trace 动画」）；
- **可选** `trace` 动画（`meta.animation`，默认关闭 —— 静态输出才是默认，动画只在用户要演示时开）。

**五种图型与适用面**（`SKILL.md` Type router）：

| 类型 | 适用 | 典型场景 |
|---|---|---|
| `architecture` | 组件 / 服务 / 存储与边界 | 云与安全拓扑、服务依赖、部署归属 |
| `workflow` | 流程 / 审批门 / 工具调用 | CI/CD、runbook、agent 工具调用链 |
| `sequence` | 调用链 / 请求生命周期 | API 调用时序、缓存未命中路径、异步返回 |
| `dataflow` | 管道 / 血缘 / 治理 | ETL/ELT、PII 边界、消费者关系 |
| `lifecycle` | 状态机 / 重试 / 终态 | 订单状态、任务重试、取消路径 |

**它刻意不做的事**（`PRODUCT.md` Anti-references，这条很能说明作者品味）：不做「Mermaid 美化器」（只换主题不改善信息架构）、不做 WYSIWYG 绘图套件、不做「动画暗示了数据里不存在的活动」的演示品、不做无边界的图标市场。

---

## 3. 整体架构与技术栈

```
JSON-IR（typed 规格，6 份 JSON Schema 约束）
        │
        ▼
archify CLI（bin/archify.mjs，2140 行，零运行时依赖）
        │   validate → deliver → visual-check
        ▼
渲染器（renderers/<type>/，每型一个）+ 共享层（geometry / i18n / brand-marks / validators）
        │
        ▼
自包含 HTML = viewer 运行时（template.html 0.74MB）+ 内联 SVG + 内嵌 JetBrains Mono 子集字体
```

**技术选型的三条硬约束**（从 `package.json` 与 SKILL.md 反推，均已在源码核实）：

1. **零运行时依赖**：`dependencies` 为空，`devDependencies` 仅 4 个（`ajv` 8.17 校验、`parse5` 7.3 HTML 解析、`saxes` 6.0 XML 解析、`simple-icons` 16.28 品牌图标）。校验器与品牌图标是**生成产物**（`renderers/shared/generated-validators.mjs` 431KB、`generated-brand-marks.mjs` 163KB），生成后进包，运行期不再依赖。
2. **产物自包含**：每份 HTML 内嵌字体子集（约 +96KB）、CSS 语义类而非内联色、`<?xml?>` 声明（修中文乱码）、离线可用 —— **不引任何 CDN、不需要宿主运行时**。
3. **确定性输出**：`deliver` 把规格字节冻结进同目录快照、原子写 HTML、回执 SHA-256；`archify.zip` 用确定性打包（同字节可复现）。

**Node 要求**：`"engines": { "node": ">=18" }`。

---

## 4. 主要模块及职责

| 模块 | 体量 | 职责 |
|---|---|---|
| `archify/SKILL.md` | 16.4 KB | **给智能体的操作手册**：五步快速路径（选题型 → 读 schema+example → 先写候选 → validate → deliver）、类型路由、Mermaid 转换规则、13 条 authoring 不变量、更新提示协议 |
| `archify/bin/` | 111 KB | CLI：`validate` / `deliver` / `render` / `preview` / `compare` / `guide` / `brands` / `doctor` / `demo` / `visual-check` |
| `archify/schemas/` | 6 份 | JSON Schema（`architecture` / `workflow` v1+v2 / `sequence` / `dataflow` / `lifecycle` + `common`） |
| `archify/renderers/` | ≈1.1 MB | 每型一个渲染器 + 共享层：`geometry.mjs` 57KB（路由/间距/端口展开）、`i18n.mjs` 48KB、**生成校验器 431KB** |
| `archify/references/` | 30 KB | 按需阅读的契约文档：authoring-contract / delivery-contract / viewer-runtime / brand-marks |
| `archify/examples/` | ≈4 MB | 5 型 JSON 示例 + **渲染好的成品 HTML**（供 agent 学字段形状，不许抄事实） |
| `archify/recipes/scenarios.mjs` | 32 KB | 场景路由表（`guide` 命令的数据源） |
| `viewer/` | 0.81 MB | viewer 运行时**源码**（`template.source.html` 353KB + focus / guided-views / route-probe / semantic-lens 等），经 `generate-viewer` 生成进 `assets/template.html` |
| `archify/test/` | 137 项 | 含浏览器级测试（desktop-reader / export / motion-governor / viewer-camera…）、golden、发布门禁 |
| `benchmarks/ordinary-model-floor/` | 0.52 MB | **弱模型下限跑分**：5 个 case × 3 个模型，验证「普通模型也能用」（2026-07-26 三模型结果已入档） |
| `experiments/v3-mermaid-validation/` | 1.88 MB | Mermaid 原生 vs 主题化 vs Archify 的三路输出对比（A/B/C 截图对比实验） |
| `integrations/deepseek-harness/` | 21 项 | DSH（DeepSeek Harness）插件适配器，含分发验收脚本 |
| `docs/` | 22.76 MB | gallery / 案例文章 / 验收记录（如 `cursor-acceptance-2026-07.md`、`deployment-ownership-profile-acceptance-*.md`） |

---

## 5. 依赖与运行环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| Node | **≥ 18** | 跑 CLI 必需；装成 Skill 后生成 HTML 也要跑它 |
| 运行时依赖 | **0** | 生成物已内联；校验器/品牌图标是预生成产物 |
| 浏览器 | 仅 `visual-check` 需要（本地 Chromium） | 生成与校验**不需要**浏览器 |
| 网络 | **默认会做一次版本检查**（GET 固定 manifest，约 72h ±20% 一次） | `ARCHIFY_UPDATE_CHECK_DISABLED=1` 可完全关闭；**绝不自动下载/安装更新** |
| 磁盘 | 核心 Skill 去掉测试与示例后 **2.27 MB / 63 文件**；官方打包 `archify.zip` 1.80 MB | 仓库整体 48MB 主要是 docs/gallery 演示物 |

---

## 6. 安装与配置

```bash
# 标准（装到 agent 的全局技能目录）
npx skills add tt-a1i/archify -g

# 显式指定 agent 与方式
npx -y skills add tt-a1i/archify --skill archify --agent cursor --global --copy --yes

# 试装不落盘
npx skills use tt-a1i/archify@archify --agent codex

# DeepSeek Harness（DSH）渠道
dsh plugin --profile web add @tt-a1i/archify-dsh@0.1.0
```

支持宿主：**Cursor / Claude Code / Codex CLI / OpenCode**（start 页有 agent 切换器）；另有 Kimi Work 插件商店上架（「Interactive Architecture Diagram」）。

健康自检（装完跑一次即可）：

```bash
node archify/bin/archify.mjs doctor
node archify/bin/archify.mjs demo <输出目录>     # 生成一份演示 HTML 验证端到端
```

关闭联网检查：`ARCHIFY_UPDATE_CHECK_DISABLED=1`。无 shell 的极端场景有手工兜底路径（把 SVG 塞进 `assets/template.html`，走 CSS 语义类）。

---

## 7. 典型使用流程与示例

**作者约束（SKILL.md 的 fast authoring path，这是它工程品味的核心）**：

1. 按问题选五型之一；
2. **只读**对应 schema + `common.schema.json` + 一份对应 example（明令「用示例学字段形状，不许抄事实」）；
3. **先写候选再读渲染器源码**（禁止在 prose 里规划坐标）——一条主路径、短支路、稀疏标签、**主节点 ≤12**、`quality_profile: "showcase"`；
4. 每次改动后立即校验：`validate <type> <候选.json> --quality showcase --json` —— **showcase 通过 = 9 项 artifact 检查全过 + 0 composition error + 0 warning**（只有 4 项 = 基本校验，不算数）；
5. `deliver` 是唯一验收命令（非零退出**永远不许**说成功）；失败后只改诊断点名的 `subject`，连续两轮无改善就**如实报告未解决**。

**三条命令的分工（这是它最值得抄的设计）**：

| 命令 | 证明什么 | 不证明什么 |
|---|---|---|
| `deliver` | 确定性产物检查 + SHA-256 字节回执 | 不等于浏览器里没毛病 |
| `visual-check` | 真实浏览器在 4 个桌面视口的实测与截图 | 不等于「好看」（感知层） |
| 人 / 图像模型评审 | 感知层 polish | 不能替代前两项 |

**示例（`examples/web-app.architecture.json` 节选）**：

```json
{
  "schema_version": 1, "diagram_type": "architecture",
  "meta": { "title": "Sample Web App", "quality_profile": "showcase",
            "views": [{ "id": "request-path", "label": "Primary request path",
                        "focus": ["users","cdn","lb","api","db"], "note": "从边缘到持久化的主请求" }] },
  "components": [
    { "id": "users",  "type": "external",  "label": "Users",         "sublabel": "Browser / Mobile", "pos": [40, 300],  "size": [120, 60] },
    { "id": "api",    "type": "backend",   "label": "API Server",    "sublabel": "FastAPI :8000",    "pos": [670, 300], "size": [130, 60] },
    { "id": "cache",  "type": "database",  "label": "Redis",         "sublabel": "cache :6379",      "pos": [670, 150], "size": [130, 60] }
  ],
  "boundaries": [{ "kind": "region", "label": "AWS Region: us-west-2", "wraps": ["cdn","lb","api","cache","db","s3","queue","worker"] }],
  "connections": [{ "id": "users-to-cdn", "from": "users", "to": "cdn", "...": "..." }]
}
```

**迭代方式**：在对话里继续说「加 Redis」「auth 挪到左边」「高亮回滚路径」——typed 源规格保留在盘上，改的是规格不是重画。**架构对比**（PR 评审场景）：`compare architecture base.json head.json delta.html --json`，产出带机读回执的 Before/Delta/After 三联图。

---

## 8. 适合引入的场景 / 解决什么问题 / 具体帮助

### 8.1 适合引入的场景

| 场景 | 为什么它合适 |
|---|---|
| 给 AI agent 装一个「会画正经架构图」的技能 | 它就是为此设计的：SKILL.md 是操作手册，普通模型也有下限跑分背书 |
| 把仓库代码画成**有证据**的架构图 | `meta.repository`（url + 40 位 revision）+ `repository-evidence.mjs` 把节点锚到真实文件/行，来源可点开核对 |
| 架构 / PR 评审的可携带产物 | 单文件 HTML 离线可开；Route / Reach Share Card 可显式声明范围后单独分享 |
| Mermaid 存量的升级 | 接受 flowchart / sequenceDiagram / stateDiagram 三种输入，**读拓扑重绘**而不是套壳美化（有专门的三路对比实验佐证） |
| 文档站 / 汇报里的图 | 主题跟随、键盘可达、`prefers-reduced-motion`、导出多格式 |

### 8.2 对本项目（Codex Harness Desktop）的具体帮助

1. **补齐「架构可视化」能力位**：本项目是引擎工作台，用户经常要理解/讲解一个代码库或一条链路；现在聊天里只有 Mermaid 渲染（`mermaid` 依赖 + `MermaidDiagram.tsx`），**没有**「从描述/代码证据生成 + 校验 + 交互探索」这条链。Archify 补的是这一段，与 Mermaid **不冲突**（我们继续渲染聊天内已有的 mermaid 代码块；Archify 负责生成与交付高质量产物）。
2. **接入成本接近零**：本项目技能体系已实测两个落点 —— 全局 `$CODEX_HOME/skills/<名>/SKILL.md` 与项目级 `<cwd>/.codex/skills/`（引擎原生发现，`skills/list` 返回 `scope:"repo"`）。Archify 本身就是标准 Agent Skill，**按现状落盘即可用，不需要改我们一行代码**。官方 `archify.zip` 1.80 MB / 核心去测试后 2.27 MB，随包内置体积可接受。
3. **产物能直接在应用里看**：本项目文件预览已支持 `.html/.htm`（`09-file-preview-editor.tsx` 有显式分支），产出可走「在浏览器打开」；自包含离线特性意味着不依赖网络。
4. **运行时满足**：应用自带 Node（`resources/tools/node`），`node >= 18` 满足。
5. **可借鉴的工程做法**（即使不引入也值得抄）：① **三层证据分离**（deliver ≠ visual-check ≠ 人眼评审，禁止把一层说成三层）；② **弱模型下限跑分**（`benchmarks/ordinary-model-floor`，用跑分而非感觉判断「换个便宜模型行不行」）；③ **`visual-check` 只取证不下结论**（测量四个视口 + 截图，把「好看」留给人）；④ SKILL.md 的「**先写候选再读源码**」纪律（防 agent 在细节里打转）。

---

## 9. 潜在限制与风险

### 9.1 ⚠️ 活跃度信号存在需要核实的异常

**事实**：GitHub `repos` 与 `search` 两个端点一致返回 **72,575 stars**、4,903 forks、178 open issues；但 `subscribers_count`（watchers）只有 **209**（约为 star 的 0.29%，常见项目为 1%–5%）。且最近 20 条提交里 **12 条以上是 docs / branding / CI**，代码修复集中在 09-16 一天。

**判断**：数字取自 GitHub 官方 API，本身可信；但「星数极高 × watchers 极低 × 近期以营销提交为主」三者叠加，**无法排除宣传/推广因素在星数中的占比**。stargazers 时间分布接口需要认证，本机无法进一步核实 → **标「待核实」**。**建议采信依据改为源码与实测，不用 star 数做决策输入。**

### 9.2 产品形态限制

| 限制 | 影响 |
|---|---|
| **无自动布局引擎** | `architecture` 等型靠 authored `pos` 或 grid；坐标要 agent 自己给（workflow v2 有编译器但那是特例）。画 30+ 节点会明显费 token |
| **产物是只读 HTML** | 改拓扑必须回 JSON 重跑；不存在「在图上拖一下就改了系统」的工作流 |
| **版本是 dev** | `2.17.0-dev.1` 非稳定版；CHANGELOG 的 Unreleased 段在持续变动 |
| **中文 UI 仅两种 locale** | `meta.locale` 只认 `en` / `zh-CN`；其他语言回退英文 Viewer UI，且**渲染器不翻译正文**（作者内容要自己写对语言） |
| **单份 HTML ≈ 0.78 MB** | 内嵌字体 +96KB/份。分享没问题；若想塞进聊天正文或存进记忆层会撑体积 |
| **品牌图标带商标义务** | `simple-icons` 集合需保留第三方 NOTICE（仓库在发行物里做了 fail-closed 校验）；我们若随包分发要同步这份义务 |
| **会发一次网络请求** | 版本检查默认开（约 72h 一次，只取固定 manifest、不带任何项目数据）；要严格离线就设 `ARCHIFY_UPDATE_CHECK_DISABLED=1` |

### 9.3 许可合规要点

MIT 本体，但发行物**必须**：保留 Cocoon AI 的原样 MIT 版权行、保留 JetBrains Mono 的 OFL 文本、携带 simple-icons 的第三方商标说明。上游用发布门禁（`release-package-gates.test.mjs`）**在缺 LICENSE 时直接构建失败** —— 我们若随包分发，应照抄这套 fail-closed，而不是只嘴上说遵守。

---

## 10. 采用建议

| 若目标是… | 建议 |
|---|---|
| **先试用**（推荐第一步） | 不动仓库：`npx skills use tt-a1i/archify@archify --agent codex`，让引擎画一张我们自己项目的架构图，人工验收「证据是否真的锚到文件」 |
| **接入给用户用** | 走我们既有技能安装链落 `$CODEX_HOME/skills/archify/`（与 phone-harness 同一路径），加「开发工具」卡片或技能中心入口；**零代码改造** |
| **借鉴而不引入** | 至少抄两条进我们自己的产出链：① 三层证据分离；② `visual-check` 式「只取证、不下视觉结论」 |
| **不要做** | 不要把 star 数当采信依据；不要在没跑通 `doctor` + `demo` + 一张真图之前就讨论内置随包 |

**下一步若要落地**，工作量预估：接入技能 ≈ 半轮（落盘 + 开发工具卡片 + `doctor` 体检，同 phone-harness 形态）；若要「会话里自动把聊天中的系统描述转成图并归档」，需另评估产物路径与文件预览的打通，属于独立一轮。

---

## 附：本报告的核实边界

- 所有源码引用均取自 `main` 分支实际文件（GitHub contents API，UTF-8 解码）；
- 星 / fork / issue 数取自 GitHub API 两个端点交叉一致；watchers 取自 `subscribers_count`；
- stargazers 时间分布接口需要 GitHub 认证，本机无凭据 → 该项无法核实，已标注；
- 本机未实际安装运行（`doctor` / `demo` / 真实出图未验证）→ 「能跑通」的结论全部来自源码与官方文档，标注为**待实测**。
