# 架构与扩展点（目标形态）

> 配套：`docs/REFACTOR-PLAN-2026-09-21.md`（怎么分批改）、`docs/REFACTOR-COMPARE-2026-09-21.md`（现状 vs 目标 + 利弊）。
> 本文回答：**新功能放哪、接口在哪、怎么不改别人就加功能、mac 上会不会瘸**。

---

## 0. 一句话目标

**两个壳 + 一堆域 + 一张注册表。** 加一个功能 = 新增一个目录 + 在注册表加一行，
**不碰 `App.tsx`、不碰 `main.ts`、不碰别人的目录**。

---

## 1. 分层（三层，职责不重叠）

| 层 | 是什么 | 允许做什么 | 禁止做什么 |
|---|---|---|---|
| **壳层** `src/App.tsx` / `electron/main.ts` | 装配：路由、布局骨架、Provider 组合、启动链 | 遍历注册表渲染、调各域注册函数 | 写具体业务逻辑、持有域状态 |
| **域层** `src/features/<域>/`、`electron/features/<域>.ts` | 一个功能的自有组件 + 状态 + 样式 + IPC 实现 | 域内自由实现 | 直接引别的域的内部文件；直接 `window.codex.*` |
| **基座层** `src/lib/`、`src/components/`、`src/hooks/`、`electron/*.ts`（基础设施） | 纯函数、通用组件、通用 hook、引擎/桥/存储/策略 | 被任何域依赖 | 反向依赖某个域 |

---

## 2. 目标模块树

```
src/
  main.tsx                引导（挂载 + Provider）
  App.tsx                 < 800 行：遍历注册表 → 布局 + 路由
  features/
    registry.ts           ★ 域注册表（唯一新增入口）
    relay/                index.ts  RelayCenterPage.tsx  useRelayAccounts.ts  relay.css
    openai/ voice/ memory/ dispatch/ channels/ agents/ models/ extensions/ threads/ …
  lib/                    纯函数（.mjs + 同名 .d.mts）
  components/             跨域通用件
  hooks/                  跨域通用 hook
  styles/index.css        @import 各域 css
electron/
  main.ts                 < 1,200 行：启动链 + 窗口 + 各域注册调用
  ipc-registry.ts         ★ channel → handler → 模块（"接口在哪"查表）
  features/               relay.ts / openai.ts / voice.ts / …（每个导出 register<Domain>Handlers(ctx)）
  *.ts                    引擎、桥、存储、策略（基础设施）
```

---

## 3. 前端扩展点（★ 你问的"哪里留接口"）

**设计原则**：把"要改壳层才能加功能"的每一处，都改成"注册表加一行"。
现在有 **29 个设置页分支写在 `App.tsx` 的 `settingsPage === "xxx"` 里** —— 这就是要消掉的样板。

| # | 扩展点 | 目标文件 | 用途 | 新增功能时的写法 |
|---|---|---|---|---|
| 1 | **域注册表** | `src/features/registry.ts` | 声明"本域有哪些页面/入口/设置区/命令" | `defineFeature({ id, pages, settings, topbar, commands })` |
| 2 | **设置页插槽** | 同上 → `settings` | 设置页分区不再硬编码 | 声明 `{ id, title, group, order, Component }` |
| 3 | **顶栏动作槽** | 同上 → `topbar` | 顶栏按钮（调度、通知、独立弹窗…）按注册顺序渲染 | 声明 `{ id, order, Component }` |
| 4 | **侧栏面板槽** | 同上 → `sidebar` | 左侧导航项 | 声明项 + 图标 + 排序 |
| 5 | **命令与快捷键** | `src/features/registry.ts` + `src/lib/hotkey.mjs` | 命令面板 / 快捷键集中注册，不散落 | `{ id, title, run, keys }` |
| 6 | **UI 插槽（slot）** | `src/components/Slot.tsx` | 往"别人的"界面里塞东西而不改它 | 输入区工具条 `composer.toolbar`、消息操作条 `message.actions`、卡片脚 `card.footer`、设置页头 `settings.header` |
| 7 | **服务访问层** | `src/lib/ipc.ts` | 域**不直接** `window.codex.*`，统一走包装层 | `ipc.relay.accounts()` —— 便于测试替身与批量改名 |
| 8 | **域公开面** | `features/<域>/index.ts` | 域的"接口声明" | 只导出组件 + hook + 动作；内部实现文件不 export |
| 9 | **跨域通信** | `src/lib/bus.mjs` | 域之间**不互相 import**，用事件解耦 | `emit("thread:changed", …)` / `on(...)` |
| 10 | **主题与样式** | `src/styles/index.css` + 域内 `*.css` | 主题色 / 尺寸一律走 CSS 变量 | 域 css 前缀 = 域 id，禁跨域选择器 |

### 3.1 一个"插件"长什么样（加功能的完整步骤）

```ts
// src/features/relay/index.ts
import { defineFeature } from "../registry";
import { RelayCenterPage } from "./RelayCenterPage";

export default defineFeature({
  id: "relay",
  title: "中转站",
  pages: [{ id: "relay", title: "中转站", Component: RelayCenterPage }],
  settings: [{ id: "relay", title: "中转站账户", group: "accounts", order: 10 }],
  topbar: [{ id: "relay-balance", order: 30, Component: RelayBalanceBadge }],
  commands: [{ id: "relay.refresh", title: "刷新中转站余额", run: refresh }],
});
```

**要改的只有这一处**：`registry.ts` 里加一行 import 并放进数组。壳层从此不动。

---

## 4. 主进程扩展点

| # | 扩展点 | 目标文件 | 解决的问题 |
|---|---|---|---|
| 1 | **IPC 注册表** | `electron/ipc-registry.ts` | "这个 channel 在哪实现"**查表**，不再在 8,971 行里 grep |
| 2 | **域上下文 `ctx`（deps 契约）** | `electron/features/types.ts` | 313 个 handler 现在共享模块级闭包（server / codexHome / 各 store）→ 收成显式对象，可测可换 |
| 3 | ★★ **preload 与类型声明自动生成** | `scripts/gen-ipc-bridge.mjs` | 现在 IPC 是**手写三件套**（handler ↔ `preload.ts` ↔ `vite-env.d.ts`，313×3），漏一处**静默坏**；改为从注册表生成后两件 |
| 4 | **能力声明** | `electron/capability-registry.ts`（已存在） | 域声明自己需要的能力（视觉 / 浏览器 / 桌面），由注册表断言"想开先问能力" |
| 5 | **工具域总闸** | `electron/automation-policy.ts`（已存在） | MCP 工具级开关的唯一来源，UI 必须同源 |

> ⚠️ 第 3 条是**唯一能根治"加功能要改三处、漏一处不报错"**的扩展点，优先级最高；
> 但它依赖第 1、2 条先落地（注册表 + ctx），所以排在第 4 批的后半段。

---

## 5. 新功能落点决策树（照着走不会放错）

```
要加的东西是什么？
├─ 纯计算 / 解析 / 判定（无 React、无 IPC）
│   → src/lib/<名>.mjs + 同名 .d.mts（预检直接跑真断言）
├─ 跨域复用的 UI 件（按钮、卡片壳、头像…）
│   → src/components/<名>.tsx
├─ 一个完整功能（有自己的界面 + 状态 + 后端）
│   → src/features/<域>/  +  electron/features/<域>.ts  +  在 registry 加一行
├─ 只是给"已经存在的界面"加一块
│   → 用插槽（<Slot name="…" />），不改那个界面
└─ 只是给引擎加"知识/流程"（不涉 UI）
    → 内置技能或指令（electron/builtin-skills.ts / developer-instructions.ts）
```

---

## 6. 每个域必须遵守的契约（**可机器校验**，不靠自觉）

| 契约 | 校验方式 |
|---|---|
| `features/<域>/index.ts` 存在且只导出公开面 | 预检：每个域目录必须有 index |
| 跨域 import 只许走 `../<域>`（即 index） | 预检：跨域路径不许出现 `/内部文件`（除 index 外的深路径） |
| 域内状态独占（域外不许 `set`） | 第 3 批后由 hook 边界保证；预检扫"域外引用域内 setter" |
| 域 css 前缀 = 域 id，禁跨域选择器 | 预检扫 `features/<域>/*.css` 的选择器前缀 |
| 不直接 `window.codex.*` | 预检扫 `features/**` 里出现 `window.codex` |
| 两个壳行数只许降 | 预检阈值（`App.tsx` 22,216 / `main.ts` 8,971） |

---

## 7. 跨平台（macOS）约束 ★

**为什么单列一节**：拆文件会新增大量目录与路径拼接，而 mac 只有 CI（`macos-14` / `macos-15-intel`）在跑，
**本机永远踩不到**。以下每条都对应历史事故或已存在的守卫。

| 约束 | 说明 | 反例（曾发生） |
|---|---|---|
| 路径一律 `path.join` / `path.delimiter` | 不许手写 `/` 或 `\`，不许用 `;` 切 PATH | v0.0.22 审出「用 `;` 切 PATH」，mac 直接坏 |
| **新增 `electron/` 子目录必须改 `tsconfig.json` 的 `include`** | 现在是白名单 `["*.ts", "voice/**/*.ts"]` | 新建 `electron/features/**` 不在编译范围（只靠 import 跟随） |
| 目录/文件名**全小写**，import 大小写与磁盘一致 | CI runner 是 Linux（大小写敏感），Windows 会掩盖错误 | — |
| 随包资源新增要**同步两个平台脚本** | `prepare-windows-tools.cjs` + `prepare-mac-tools.cjs`（+ `build-mac.yml`） | 预检【29】按 `extraResources` 逐条比对 |
| 平台分支要**两条都在**（不是只判 win32） | 预检【74】一类守卫盯着 | 「只认 Windows 解压器」曾让 mac 修复安装必失败 |
| 每批收尾跑 **`mac-audit.mjs v0.0.26-b`** | 起点锚点 = 本次发版的 tag；扫"新增行"的平台敏感模式 | — |

```bash
# 每批收尾（Windows 上必须先补 PortableGit 到 PATH，否则 spawn git 报 ENOENT）
PATH="/c/Users/Administrator/.workbuddy/binaries/PortableGit/versions/1.2.0/cmd:$PATH" \
  node scripts/mac-audit.mjs v0.0.26-b
```

---

## 8. 扩展点的落地顺序（与改造批次对齐）

| 批 | 落地的扩展点 | 之后能做什么 |
|---|---|---|
| 1 | `features/` 目录约定 + `index.ts` 公开面 | 能搬页面，接口面开始成形 |
| 2 | `src/lib` 继续下沉纯函数 | 逻辑可被真断言测试 |
| 3 | **域 hook（状态收拢）** | 域内独占状态 → 改 A 不碰 B 真正成立 |
| 4 | `ipc-registry` + `ctx` + **自动生成 preload/类型** | 加 IPC 不再改三处 |
| 5 | CSS 按域拆 + `styles/index.css` | 观感不乱、样式不互相污染 |
| 6 | **域注册表**（`registry.ts`）+ 插槽 | 加功能 = 加目录 + 加一行 |
| 7 | 命令注册 / 事件总线 / 契约守卫断言 | 扩展方式固定、越界会被预检拦下 |

---

## 9. 这份架构**不解决**什么（别抱错期待）

- **不解决"同一文件两个人同时改"**：域化只是把冲突从 `App.tsx` 挪到各自域内；同一个域里并行改仍会撞。
- **不引入运行时插件热插拔**：域是**编译期**注册（Vite 静态 import），不做动态加载 —— 在这个应用里动态加载只会带来安全面与打包复杂度。
- **不替换现有引擎能力层**：nuphus / MCP / 技能市场照旧，本文只管"我们自己的代码怎么组织"。
- **不承诺一次到位**：扩展点是**逐批长出来**的，第 1 批结束时你只会看到 `features/relay/` 一个目录，这很正常。
