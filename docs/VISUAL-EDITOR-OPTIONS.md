# 可视化编辑界面方案调研

日期：2026-10-10
范围：① 开源可视化编辑器调研 ② JSON 结构化配置路径评估 ③ 推荐方案 ④ Compositor 复刻 / 编译 Windows 的实证结论

> ⛔ 本文所有「许可 / 星数 / 平台要求」均来自 GitHub API 与仓库原文实测，不凭印象。
> 项目纪律：文档数字滞后 = 主动误导下一轮。

---

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| 复刻 Compositor 源码到自己 GitHub | ✅ **可以，合法**（MIT） |
| 把它编译成 Windows 版 | ❌ **不可能**（不是难，是框架不存在）—— 实证见 §4 |
| 开源可视化编辑器能不能直接用 | ⚠️ 能省掉「编辑器机制」，但**物料层必须自己写** |
| JSON 配置驱动页面 | ✅ **可行，且是行业标准做法**，但要付迁移链与校验的维护成本 |

**一个必须先解决的分岔口**：你第 1 条描述的是**页面搭建器**（区块 / 属性面板 / 导入导出），
第 3 条说的「跟 Compositor 一样」是**图像图层编辑器**。这两者不是一回事，方案完全不同（见 §1）。

---

## 1. 分岔口：你说的「区块」是哪种

| | **A. 页面区块**（如 Hero / 文本 / 按钮 / 卡片） | **B. 图像图层**（Compositor 那种） |
|---|---|---|
| 编辑对象 | 组件树（树形结构、父子嵌套） | 图层栈（底→顶、像素叠加） |
| 画布 | DOM / iframe 实时预览 | 位图画布（需 GPU 或 Canvas 合成） |
| 属性面板 | 组件 props（文本 / 颜色 / 间距） | 不透明度 / 混合模式 / 变换 / 蒙版 / 调整 |
| 导入导出 | 页面 JSON | `.comp`（manifest + PNG 图层） |
| 现成轮子 | GrapesJS / Puck / Craft.js | **几乎没有成熟的 Web 版**（这也是 Compositor 只做 Mac 的原因之一） |
| 我们的现状 | 无 | **image-doc 引擎已开工**（jimp 纯 JS，双系统同源） |

⇒ 请先确认走 A 还是 B。下面 §2/§3 按 **A** 展开（你第 1 条的字面描述）；
若走 **B**，主线应该是 §5 的「自研画布 + image-doc 内核」。

---

## 2. 开源可视化编辑器调研（自托管 / 非商业依赖）

### 2.1 许可与规模（实测）

| 项目 | 许可 | 语言 | ★ | 定位 |
|---|---|---|---|---|
| **GrapesJS** | BSD-3-Clause | TypeScript | 26,289 | Web 页面构建框架（最成熟） |
| **Puck** (`puckeditor/puck`) | MIT | TypeScript | 13,452 | React 可视化编辑器 |
| **Craft.js** | MIT | TypeScript | 8,755 | React 拖拽编辑**框架**（非成品 UI） |
| **VvvebJs** (`givanz/VvvebJs`) | Apache-2.0 | JavaScript | 8,697 | 零依赖拖拽页面构建器 |
| **Amis**（百度） | Apache-2.0 | TypeScript | 18,890 | **JSON 驱动渲染器**（编辑器本体闭源） |
| **LowCodeEngine**（阿里） | MIT | TypeScript | 15,879 | 企业级低代码技术栈 |
| **Appsmith** | Apache-2.0 | TypeScript | 41,043 | 管理面板 / 内部工具平台 |
| **Payload** | MIT | TypeScript | 45,170 | Next.js 全栈框架（含 Admin 面板） |
| craftile/editor | MIT | TypeScript | 14 | 新项目，太小，仅作观察 |

> ⛔ 两个仓库名坑：Puck 已从 `measuredco/puck` 迁到 `puckeditor/puck`；VvvebJs 在 `givanz` 组织。
> GrapesJS 的 LICENSE 是自定义文本，GitHub 识别为 `NOASSERTION`（实为 BSD-3 三条款）。

### 2.2 能力对照（对照你的五条需求）

| 需求 | GrapesJS | Puck | Craft.js | VvvebJs | Amis | LowCodeEngine |
|---|---|---|---|---|---|---|
| 区块 / 组件编辑 | ✅ Blocks | ✅ 组件 blocks | ⚠️ 需自建 | ✅ | ⚠️ JSON 描述 | ✅ 物料体系 |
| 属性配置面板 | ✅ Style Manager / Traits | ✅ props 面板 | ❌ 自建 | ✅ | ❌ | ✅ 设置器 |
| 实时预览 | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ |
| 撤销重做 | ✅ UndoManager | ✅ 内置 | ⚠️ 自建 | ✅ | — | ✅ |
| 配置导入导出 | ✅ `getProjectData()` JSON | ✅ data JSON | ⚠️ 自行序列化 | ✅ HTML/JSON | ✅ JSON | ✅ 协议 JSON |
| 自托管 / 无商业依赖 | ✅ | ✅ | ✅ | ✅ | ✅（编辑器闭源） | ✅ |
| **React 原生** | ❌（面向 HTML/CSS DOM） | ✅ | ✅ | ❌（vanilla） | ⚠️（有 React 版） | ⚠️（React 渲染器） |

### 2.3 差距（为什么不能直接拿来用）

1. **物料层永远要自己写** —— 编辑器只提供「机制」，你自己的区块（比如我们的图像工坊画布、模型查看器）必须逐个做成物料。**这是唯一不可替代的工作量**。
2. **GrapesJS 面向 HTML/CSS，不是 React 组件树** —— 我们的应用是 Electron + React，接 GrapesJS 要额外写「GJS 组件 ↔ React 组件」的双向适配，等于多一层。
3. **Amis / LowCodeEngine 是渲染器，不是可视化编辑器** —— Amis 的 `amis-editor` **闭源**；想"拖着改"要自己补编辑器。
4. **Appsmith / Payload 是"内部工具 / CMS"范式** —— 偏数据库 CRUD 表单，跟"可视化搭建界面"不是一个目标。
5. **都不含我们特有的区块** —— 无解，只能自建。

---

## 3. JSON 结构化配置路径评估

**结论：可行，是低代码的标准做法，且是「AI 生成界面」唯一现实的通道。**

### 3.1 结构建议

```jsonc
{
  "schemaVersion": 3,               // 迁移链的锚点，必须有
  "meta": { "id": "...", "name": "...", "createdAt": "..." },
  "theme": { "tokens": { "colorPrimary": "#..." } },
  "tree": [                          // 组件树
    { "id": "n1", "type": "Hero", "props": { "title": "..." }, "children": [] }
  ],
  "bindings": {},                    // 数据源绑定（可选，先留空接口）
  "assets": []                       // 引用的图片 / 文件
}
```

关键：**`type` 必须是受限枚举**（物料注册表的 key），不能是任意字符串 —— 否则校验形同虚设。

### 3.2 导入流程

```
parse JSON → 结构校验（JSON Schema / zod）→ 版本迁移（v1→v2→v3 逐级 upgrade）
  → 物料化（type 经组件注册表查表，查不到就报错，不静默降级）
  → 渲染
```

⛔ **迁移必须逐级、不可跳级**：`v1→v3` 不存在，只有 `v1→v2→v3`。跳级迁移是版本地狱的起点。

### 3.3 版本兼容与校验

- **单一真相源**：用 **zod schema 生成 TS 类型 + JSON Schema**（`zod-to-json-schema`），
  避免「类型和校验两处各写一遍」—— 本项目反复踩过这类漂移。
- **校验错误信息要能驱动自我修正**：Codex 生成 JSON 必然出错，错误信息必须精确到
  `路径 + 期望 + 实际`，让它能自己改对（这是"AI 生成界面"能不能闭环的分水岭）。

### 3.4 维护成本（如实估算）

| 成本项 | 说明 | 量级 |
|---|---|---|
| 物料表 ↔ schema 双维护 | 用 zod 单一真相源可消除 | 低（设计对了就低） |
| 迁移链 | 每改一次结构加一个 `upgrade` 函数，**只增不减** | 中，随时间线性增长 |
| 表达力边界 | 条件渲染 / 列表循环 / 事件编排最难表达 | 高（越到后面越明显） |
| 调试反馈 | 用户看不到"为什么这块没渲染出来" | 中 |

### 3.5 风险

1. **表达力天花板** —— JSON 擅长"静态结构"，不擅长"行为编排"。一旦要做交互流程（点击 A 弹出 B），schema 会迅速膨胀成一门新语言。**建议：先只做静态结构，交互留到插件层**。
2. **Codex 输出不稳定** —— 必须配「生成 → 校验 → 报错 → 修正」循环，且**限制重试次数**，否则会陷入死循环烧 token。
3. **schema 与渲染器漂移** —— 物料改了但 schema 没改 ⇒ 导入的旧 JSON 静默渲染错。**必须加守卫**（物料表与 schema 的 key 集合逐一比对）。

---

## 4. Compositor：复刻与编译的实证结论

### 4.1 复刻到自己 GitHub —— ✅ 可以，合法

MIT 授予的权利包括：复制、修改、再分发、甚至商用。
**唯一义务**：保留 LICENSE 全文与版权声明。

⛔ 两点提醒：
- **商标不在 MIT 授权范围**：版权放开 ≠ 名字也能用。想长期安全，改名+注明上游来源更稳。
- 改了要**说明改了什么**（MIT 不强制，但是惯例，也是自我保护）。

### 4.2 编译成 Windows —— ❌ 不可能（实证）

浅克隆源码（`230` 个 `.swift`）统计 import 命中：

| 框架 | 命中文件数 | Windows 可用性 |
|---|---|---|
| **AppKit** | 146 | ❌ macOS 专有 UI 框架，Windows 上根本不存在 |
| **SwiftUI** | 58 | ❌ Apple 专有，仅 Apple 平台 |
| CoreGraphics | 48 | ❌ |
| **Foundation** | 42 | ✅ Swift 官方 Windows 工具链提供 |
| CoreImage | 23 | ❌ |
| UniformTypeIdentifiers | 22 | ❌ |
| ImageIO | 10 | ❌ |
| Observation | 8 | ✅ |
| **Metal** | 6 | ❌ Apple GPU API（Windows 是 DirectX / Vulkan） |
| Vision / Accelerate / Sparkle / QuartzCore / CoreText / CryptoKit / ObjectiveC | 13 | ❌ |

- 不含任何 Apple 专有框架的文件：**9 / 230（3.9%）**，其中 5 个是测试代码
- 真正可编译的**业务**代码：**4 个（1.7%）** —— `LayerGroups` / `ToolDefaults` / `ProjectWatcher` / `ProjectTabLayout`

**构建链同样锁死在 macOS**：`Compositor.xcodeproj`（无 `Package.swift`，Xcode 只在 mac 跑）、
`Config/Compositor.entitlements` + `Info.plist` + `ExportOptions.plist`、`scripts/dmg` + `create-dmg`、
CI 仅一个 `verify.yml`；README 明文要求 **macOS 26.0+ / Apple silicon / Xcode 26+**，
发布还需 Developer ID 证书 + Apple 公证（notarization）。

> ⛔⛔ **最容易搞混的一点**：**Swift 语言本身有官方 Windows 工具链，Foundation 也能用** ——
> 所以「Swift 能上 Windows」是真的。但 SwiftUI / AppKit / Metal **一个都没有**。
> 「能编译 Swift」推不出「能编译这个 App」。
>
> ⇒ **能编译的恰好是最不值钱的部分（数据模型 / IO / 文件监视），
> 编译不了的正是值钱的部分（界面 204 处 AppKit+SwiftUI 引用 + Metal 渲染）。**

### 4.3 那复刻还有什么用

1. **当规格书**（最有价值）—— `.comp` manifest 的字段级规格、24 种混合模式、12 种调整图层。我们已经在这么用。
2. **当算法参考** —— 混合模式公式、调整图层参数模型，照抄比自己调准得多。
3. **fork 一份当实现基线** —— 标注来源、逐步替换成自己的实现。适合长期项目，不适合"快速上 Windows"。

---

## 5. 推荐方案

### 若走 A（页面区块搭建器）

**混合方案：编辑器机制用开源，物料与 schema 自己定。**

```
编辑器机制层（不自己写）  ← GrapesJS（BSD-3）或 Puck（MIT）
   画布 / 拖拽 / 属性面板 / 撤销重做 / 导入导出
物料层（必须自己写）      ← 我们的区块 + 组件注册表（单一真相源）
契约层（自己定）          ← JSON schema（zod 单一真相源 → JSON Schema）
AI 通道（差异化）         ← Codex 生成 JSON → 校验 → 迁移 → 导入
```

- **选型建议**：我们的应用是 **Electron + React** ⇒ **Puck（MIT，React 原生）** 更贴，
  没有「GJS 组件 ↔ React 组件」那层适配。
- **换 GrapesJS 的理由**：只有当你需要它那套完整编辑器 UI（图层树、样式管理器、设备切换、资源管理）时。代价是多一层适配。
- **别选**：Craft.js（只有框架，UI/序列化全要自己写，工作量接近自研）；Amis / LowCodeEngine（没有开箱的可视化编辑器）。

### 若走 B（Compositor 式图像编辑器）

**没有现成轮子可用**，主线是自研：**WebGL/Canvas 画布 + 工具条 + 图层面板 + 属性面板**，
合成内核接我们已有的 **image-doc**（jimp 纯 JS，双系统同一份代码，已开工）。
界面范式照 Compositor 抄（左工具条 / 顶选项条 / 中画布 / 右图层），**代码一行都搬不了**。

这就是 §4.2 那条实证的直接推论：**它是 Mac 原生，唯一能"一样"的方式是在 Web 栈上重写。**

### 共同的两条纪律

1. **物料表 / 组件注册表 = 单一真相源**，schema 由它生成，加物料必须同轮同步（本项目反复踩"两处各说各话"）。
2. **AI 生成的 JSON 必须先校验再导入**，且错误信息要精确到字段，否则闭环不成立。

---

## 6. 待你拍板

1. **走 A 还是 B**（页面区块 vs 图像图层）—— 决定整个方案。
2. 若走 A：Puck 还是 GrapesJS。
3. **image-doc P0 要不要接完** —— 内核 5 个文件已写完、`tsc` 0 错，但尚未接线（manifest / composition / registry / 渲染层工具面 / 守卫）、未提交。
