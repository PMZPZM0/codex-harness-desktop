# 自研 Windows UI 自动化 MCP 服务 · 落地方案

日期：2026-10-10
参照：`resources/tools/harness-uia.mjs` + `resources/tools/desktop-uia.ps1`（10-04 上线，提交 `74b7f81`）

> **范围前提（用户已拍板）**：macOS **不动**，继续用 `open-computer-use`。
> 本方案只做 Windows 侧；跨平台仅在**契约层**对齐，mac 实现零改动。

---

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| 现有 harness-uia 能复用什么 | **MCP 门面层几乎全留**（门面/校验/熔断/非 Windows 静默），**桥层重写** |
| 最大短板 | 只有 `index` 定位（界面一变就失效）、**没有等待与重试**、没有坐标闭环 |
| 能否替换 nuphus | **部分替换**：桌面组可换，**浏览器组 23 个必须保留**（Playwright 能力，UIA 做不到） |
| 比 pywinauto / uiautomation 强在哪 | **零依赖**（不要求用户装 Python）、能接我们的权限体系、能加守卫 |
| 最大风险 | 每次调用 `spawn` PowerShell 的启动开销 ⇒ 必须做**常驻进程** |

---

## 1. 架构梳理：harness-uia 拆解

### 1.1 三层结构与调用链

```
引擎（Codex）
  │ MCP stdio（行分隔 JSON-RPC）
  ▼
① 门面层  harness-uia.mjs（Node，零依赖）
  · TOOLS 定义 4 个 · 参数校验（confirm 强制 / index / limit 夹紧）
  · runBridge：spawn + 参数数组（**绝不开 shell**）
  · 超时 25s、输出 >4MB 熔断、PS 输出怪癖归一化
  · 非 Windows ⇒ tools/list 返回 []（干净消失，不是报错）
  ▼
② 桥层  desktop-uia.ps1（PowerShell 5.1）
  · Add-Type UIAutomationClient / UIAutomationTypes（**系统自带，零体积**）
  · 4 个 Action：windows / snapshot / invoke / value
  · ASCII-only · 强制 UTF-8 · Infinity/NaN 兜底
  ▼
③ 注册层  custom-model-apply.ts → config.toml [mcp_servers.harness-uia]
  · 只在 win32 + 桌面总闸开时写
```

### 1.2 逐层判定

| 层 | 判定 | 理由 |
|---|---|---|
| **MCP 门面（协议处理 / JSON-RPC 分发）** | ✅ **直接复用** | 与 harness-dispatch 同形，稳定 |
| **参数校验（confirm 强制 / limit 夹紧）** | ✅ **复用 + 扩展** | 安全口径要保留，新增 selector 校验 |
| **runBridge 熔断（超时 / 大小 / spawn 失败）** | ✅ **复用** | 这层是踩过坑才有的（PS 卡死、清单过大） |
| **PS 输出归一化（BOM / 空数组 / 混警告行）** | ✅ **复用** | 纯防御代码，与实现无关 |
| **非 Windows 返回空工具表** | ✅ **复用** | 平台契约，不能变 |
| **desktop-uia.ps1 桥** | 🔁 **重写** | 只有 index 定位、无等待、无缓存、每次 spawn 全量遍历 |
| **元素定位方式（纯 index）** | ❌ **废弃** | 界面一变就失效，是最大短板 |
| **每次调用 spawn 一次 PS** | ❌ **废弃** | 冷启动 ~1s/次；改常驻进程 |

### 1.3 必须继承的五条硬约束（改错就是安全回归）

1. **只用 `spawn` + 参数数组，绝不开 shell** —— title/text 是外部输入，拼命令行即注入面。
2. **写操作必须 `confirm:true`** —— 与 nuphus `desktop_mouse` 同一口径。
3. **非 Windows 一律返回空工具表**，不报错。
4. **`.ps1` 保持 ASCII-only** —— PS 5.1 无 BOM 时按 GBK 读，多字节尾字节会吃掉引号（10-04 实测）。
5. **几何值 Infinity/NaN 必须兜底为 null** —— 最小化窗口坐标是 ±Infinity，不是合法 JSON。

---

## 2. 能力设计

### 2.1 统一能力清单（7 组，14 个工具）

吸收现有 Windows MCP 的：UIA 元素定位与控件树遍历、等待与重试、状态获取、截图与坐标操作。

| 组 | 工具 | 新增/兼容 | 说明 |
|---|---|---|---|
| **会话** | `desktop_ui_windows` | 兼容 | 列顶层窗口（pid/hwnd/标题/矩形） |
| | `desktop_ui_focus` | **新增** | 激活窗口到前台（操作前必须先聚焦） |
| **控件树** | `desktop_ui_snapshot` | 兼容 | 拍控件树（增 `depth`/`filter` 参数） |
| | `desktop_ui_find` | **新增** | **按 selector 查元素**（不是只靠 index） |
| **元素操作** | `desktop_ui_invoke` | 兼容 | 点击（InvokePattern） |
| | `desktop_ui_set_value` | 兼容 | 写值（ValuePattern） |
| | `desktop_ui_toggle` / `_select` / `_expand` | **新增** | 复选框 / 列表项 / 树节点 |
| **等待** | `desktop_ui_wait` | **新增** | **等元素出现/消失/可点击**（轮询 + 超时） |
| **状态** | `desktop_ui_get` | **新增** | 读单个元素（名字/值/矩形/是否启用） |
| | `desktop_ui_text` | **新增** | 取元素文本（比整树快照轻） |
| **坐标兜底** | `desktop_ui_locate` | **新增** | 元素 → 屏幕坐标（UIA 不可用时的桥梁） |
| | `desktop_ui_screenshot` | **新增** | 截屏（窗口/区域） |
| **输入兜底** | `desktop_ui_type` / `_key` | **新增** | UIA 写不了时逐字输入（含剪贴板粘贴长文本） |

### 2.2 核心接口定义

#### `desktop_ui_find`（最关键的新能力）

```jsonc
// 入参
{
  "processId": 1234,            // 二选一：pid 优先
  "title": "记事本",             // 或按标题模糊匹配
  "selector": {                 // 组合条件，全部可选，给的越多越准
    "name": "保存",             // 名字包含
    "automationId": "btnSave",  // 精确匹配
    "controlType": "Button",    // Button / Edit / CheckBox / Text ...
    "index": 0                  // 同类第 N 个
  },
  "waitMs": 3000,               // 等元素出现的超时（0 = 不等）
  "limit": 20                   // 最多返回几个候选
}
// 出参
{ "ok": true, "elements": [{ "index": 7, "name": "保存", "controlType": "Button",
    "automationId": "btnSave", "rect": {"x":10,"y":20,"w":60,"h":24},
    "enabled": true, "actions": ["invoke"] }] }
```

#### `desktop_ui_wait`

```jsonc
// 入参
{ "processId": 1234, "selector": { "name": "完成" },
  "state": "exists",            // exists | gone | enabled | focused
  "timeoutMs": 5000, "pollMs": 300 }
// 出参
{ "ok": true, "matched": true, "waitedMs": 840, "element": { "index": 12, ... } }
```

#### `desktop_ui_invoke`（兼容现有，增强）

```jsonc
// 入参
{ "processId": 1234,
  "index": 7,                   // 兼容：仍支持 index
  "selector": { "name": "保存" }, // 新增：优先用 selector，找不到再退回 index
  "confirm": true,              // ⛔ 必须显式 true
  "retry": 2 }                  // 新增：失败自动重拍清单再试
// 出参
{ "ok": true, "invoked": { "index": 7, "name": "保存" }, "attempts": 1 }
```

### 2.3 错误码（统一，两侧一致）

| 码 | 含义 | 建议动作 |
|---|---|---|
| `invalid_params` | 入参缺失/超范围 | 改参数 |
| `target_not_found` | 没找到匹配窗口 | 先 `desktop_ui_windows` |
| `element_not_found` | selector 没匹配到 | 放宽条件或先 snapshot |
| **`element_stale`** | index 失效（界面变了） | **重拍清单**（这是 index 模式的典型故障） |
| `pattern_unsupported` | 元素不支持该动作 | 换工具（如改用 `desktop_ui_type`） |
| `write_requires_confirm` | 写操作没给 confirm=true | 补 confirm |
| `timeout` | 等待超时 | 加大 timeoutMs 或检查前置条件 |
| `uia_unavailable` | UIA 程序集加载失败 | 系统环境问题，回退坐标通道 |
| `bridge_timeout` / `bridge_too_large` / `bridge_unparsable` | 桥层故障（继承现有） | 缩小 limit / 重试 |
| `platform_unsupported` | 非 Windows | 不该被调用 |

⛔ **关键设计**：`element_stale` 必须**可区分于** `element_not_found`。
现有实现里 index 失效只会报"找不到"，模型无法判断该重拍还是该放弃。

---

## 3. 迁移兼容：上层零改动

### 3.1 核心策略：**接口不变，实现可换**

```
server 名不变：harness-uia          → config.toml 不动
4 个工具名不变：desktop_ui_*        → 常驻指令 / 技能 / 守卫【273】 全部不动
新增工具名：desktop_ui_find/wait/…  → 纯增量，老调用方不受影响
```

内部拆成两个 provider，靠开关选：

```ts
type UiaProvider = {
  windows(): Promise<Window[]>;
  snapshot(q: SnapshotQuery): Promise<Element[]>;
  find(q: FindQuery): Promise<Element[]>;
  invoke(q: ActionQuery): Promise<ActionResult>;
  setValue(q: ValueQuery): Promise<ActionResult>;
};
// v1 = 包装现有 desktop-uia.ps1（行为逐字一致）
// v2 = 新实现（selector + 等待 + 常驻进程）
```

开关：`HARNESS_UIA_ENGINE=v1|v2`（写在 app-settings，UI 可切）。

### 3.2 灰度与回滚

| 阶段 | 动作 | 回滚 |
|---|---|---|
| P1–P3 | v2 只跑**新增工具**，4 个老工具仍走 v1 | 关掉新工具即可 |
| P4 | 灰度：`%5 → 50% → 100%` 用户切 v2 | **一条开关拨回 v1**，秒级生效 |
| P5 | v1 保留为 fallback，v2 失败自动降级 | 自动降级 + 告警 |

⛔ **回滚判据要预先定死**（不能"看着办"）：
- 连续 3 次 `bridge_unparsable` / `bridge_timeout` ⇒ 自动切 v1
- 同一 selector 在 v2 找不到、v1 能找到 ⇒ 记一条 diff 日志，累计 5 条则切 v1

---

## 4. 跨平台：mac 冻结，只做契约对齐

**mac 实现零改动** —— 继续 `open-computer-use`（Accessibility 拿控件清单）。

统一只做在**契约层**，不是实现层：

| 契约元素 | Windows（自研） | macOS（computer use，不动） |
|---|---|---|
| 能力名 | `desktop_ui_*` | 保持现有命名 |
| 定位语义 | selector + index | 保持现有语义 |
| 写操作 | `confirm: true` | 保持现有口径 |
| 错误码 | 上表 | **映射**到同一张表（加适配层，不改 mac 代码） |
| 平台缺席 | `tools/list` 返回 `[]` | 同 |

⇒ **上层选路表只需一份**：Windows 走 UIA、网页走 `browser_*`、mac 走 computer use。
mac 侧只加一个**错误码映射薄层**，不改任何自动化逻辑。

---

## 5. 交付物

### 5.1 模块划分

```
resources/tools/
├─ harness-uia.mjs          门面（复用，扩工具表）
├─ uia-providers/
│  ├─ v1-ps-bridge.ts      包装现有 ps1（兼容基线）
│  ├─ v2-core.ts           selector 定位 / 缓存 / 重试
│  ├─ v2-session.ts        常驻 PowerShell 会话（消除冷启动）
│  └─ selector.ts          选择器解析与匹配
└─ desktop-uia.ps1         v1 桥（保留）；v2 另起 desktop-uia-v2.ps1
```

⛔ 新目录不得引入新域前缀 —— 它不作为 Electron 域，只作为随包脚本（不进 `ipc-registry`）。

### 5.2 分阶段计划

| 阶段 | 内容 | 验收标准 | 风险点 |
|---|---|---|---|
| **P0** | 抽 `UiaProvider` 接口；v1 包装现有 ps1 | 4 个老工具行为**逐字不变**（对比测试全绿） | 接口设计过度 ⇒ 只抽 5 个方法，别贪 |
| **P1** | 新增 `find` / `get` / `text` / `wait` | 能按 name+controlType 定位到记事本的菜单项 | 新增工具名撞 engine 保留字 ⇒ 先查占用 |
| **P2** | selector 定位 + 元素缓存 + 自动重试 | `element_stale` 能被正确区分并自动重拍 | 缓存失效判据写错 ⇒ 保守：每次操作前校验 rect |
| **P3** | 截图 / 坐标 / 输入兜底，形成闭环 | UIA 拿不到时能走坐标点击完成同一步操作 | 与 nuphus 职责重叠 ⇒ 只做"UIA 失败后的兜底"，不抢主路径 |
| **P4** | 常驻 PowerShell 会话 | 单次调用从 ~1s 降到 ~100ms | 会话泄漏 ⇒ 空闲 60s 自动回收 + 异常重建 |
| **P5** | 灰度 v2，v1 保留回滚 | 100% 用户 v2 后 7 天无 P0 故障 | 见 §3.2 自动降级判据 |

### 5.3 验证与回归

**功能验证（真机，必须人工过）**
- 原生 Win32：**记事本**（菜单、保存对话框、中文标题）
- WPF：任一 WPF 应用（验证 controlType 覆盖）
- 边界：**最小化窗口**（Infinity 坐标）、**中文/含空格标题**、**超长控件树**（limit 熔断）
- 故障注入：杀掉 PowerShell 进程 ⇒ 应报 `bridge_spawn_failed` 并自动重建

**回归范围**
1. nuphus 桌面 15 个工具（确认未被抢占）
2. `browser_*` 23 个（确认网页仍走 Playwright）
3. 常驻指令选路表（`developer-instructions.ts` 第 48 行）
4. 守卫【273】9 条（工具名逐字比对）
5. 权限：总闸关闭 ⇒ 工具必须整体消失（不是报错）
6. mac：computer use **行为不变**（只验证错误码映射）

**编码回归（重点）**：中文窗口标题 —— 10-04 踩过 GBK 吃掉引号的坑，必须复测。

---

## 6. 选型评估

### 6.1 能否替换 nuphus

| nuphus 分组 | 能否替换 | 理由 |
|---|---|---|
| 桌面组 15（截屏/窗口/鼠标/输入/剪贴板） | ✅ **可逐步替换** | UIA 覆盖大部分；OCR 视觉部分需另做或保留 |
| **浏览器组 23** | ❌ **必须保留** | 那是 Playwright 能力（navigate/click/type/snapshot/exec），UIA 对网页无效 |

⇒ **结论：部分替换。** 目标是"桌面组去 nuphus 化"，浏览器组长期保留 nuphus（或换自研 Playwright 封装，那是另一个项目）。

### 6.2 与 pywinauto / uiautomation 对比

> 许可/星数：`pywinauto` **BSD-3-Clause / 6,204★**（GitHub API 实测，最近推送 2026-05）。
> `uiautomation` 未核到官方仓库，按公开认知定性（纯 Python UIA 封装，中文资料多）。

| 维度 | **自研** | pywinauto | uiautomation |
|---|---|---|---|
| **依赖** | ✅ **零**（系统自带 UIA 程序集） | ❌ 需 Python | ❌ 需 Python |
| **定位能力** | ✅ UIA + selector + 等待 | ✅ Win32 + UIA（更全，含老式控件） | ✅ UIA |
| **老式 Win32 控件** | ⚠️ 仅 UIA（MSAA 老旧控件可能拿不到） | ✅ 双后端，覆盖更广 | ⚠️ 仅 UIA |
| **稳定性** | ⚠️ 需自建（新代码） | ✅ 十年打磨 | ✅ 成熟 |
| **性能** | ⚠️ 进程外（P4 常驻后改善） | ✅ 进程内 | ✅ 进程内 |
| **可维护性** | ✅ **完全可控** | ❌ 第三方节奏 | ❌ 第三方节奏 |
| **接我们的权限体系** | ✅ 原生 | ❌ 要包一层 | ❌ 要包一层 |
| **可加守卫** | ✅ 项目纪律要求 | ❌ | ❌ |

### 6.3 自研**真正**更强的点（不吹）

1. **零依赖是决定性的** —— 用户机器上不一定有 Python。为自动化能力要求用户装 Python 3.13 + UV，对桌面产品不可接受。
2. **能接既有权限体系** —— `confirm` 强制、总闸、`effectiveNuphusPermission` 掩码，UI 与 config.toml 同一判据。第三方库要包一层才能接入，且包了也容易漂移。
3. **能加机器校验的守卫** —— 本项目纪律"改了就要留判据"。第三方库升级时我们只能被动接受。
4. **契约与 mac 对齐** —— 上层选路表只有一份。

### 6.4 诚实承认的劣势

- **稳定性**：新代码必然不如十年打磨的 pywinauto，前 6 个月要交学费。
- **覆盖度**：老旧 Win32/MSAA 控件，pywinauto 的双后端比纯 UIA 强。
- **性能**：进程外调用，P4 常驻前每次 ~1s。

⇒ 所以策略是**渐进**：先用自研覆盖"现代应用（Win32/WPF/WinForms）"这个高频区间，
老旧控件与浏览器继续用 nuphus，不追求一次性全替换。

---

## 7. 待你拍板

1. **是否现在开工 P0**（抽 provider 接口，行为不变，风险最低）。
2. nuphus 桌面组替换的**优先级** —— 建议先换"窗口管理 + 控件操作"，OCR 视觉最后。
3. 是否接受 **P4 常驻进程**（性能翻倍，但多一个要管理的长生命周期子进程）。
