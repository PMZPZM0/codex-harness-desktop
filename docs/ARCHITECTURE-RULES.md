# 功能板块划分与接口规则（现行有效）

> **效力**：本文是**规范性**规则（做什么、不许做什么、怎么校验）。`docs/ARCHITECTURE.md` 是 09-21 写的**目标形态草案**，
> 其中 `features/registry.ts` / `defineFeature` / `Slot.tsx` / `lib/bus.mjs` / `lib/ipc.ts`
> **尚未落地**（截至 2026-09-22）；两者冲突时**以本文为准**（本文用实测现状描述）。
> （`gen-ipc-bridge.mjs` 已于 09-23 落地，不再是草案项 —— 见 §0 与 §6 第 5 步。）
> 基线：改造副本 `17755a4`（本文写完时实测 **预检 1713 ✓ / 0 ✗ / 3 条告警**），含【90】–【97】结构守卫，口径 `wc -l`。
>
> **09-22 17:45 同步**（记忆板块三批改动 `d47f238` / `b188b56` / `09097de` 收尾）：新增守卫【98】（工具调用幂等，10 条）
> 与【99】（记忆捕获链兜底 + 出口留痕，5 条）；实测 **1707 ✓ / 0 ✗ / 3 条告警**
> （口径 = 预检输出中以 `✓` 开头的行数；与上面 1713 的差属口径/同期改动差异，**以本行为准**）。
>
> **09-23 20:50 同步**（IPC 桥生成器 `678c865` + 生成物内联回退 `395a8f2` + 委派会话记忆 `2f00c69` 收尾）：新增守卫【2】6 条（manifest 单一真相源 / 两个生成物逐字节一致 / manifest 频道全部在账本登记 / preload 无运行时相对 import / 废弃的 `preload.generated.ts` 不许回来）与【125】（委派会话记忆，10 条）；实测 **2102 ✓ / 0 ✗ / 2 条告警**（口径同上）。

---

## 0. 现状数字（每轮收尾必须同步，滞后即视为违规）

⛔ **口径与漂移**：数字是**某次提交的快照**（本次 = `395a8f2`，本次校准，§10 有并发写入纪律）；并发期数字会漂移，**以最新一次提交为准**，由最后收尾的那一路同步。
（校准依据：`docs/AUDIT-ARCH-2026-09-23.html` 的实测口径 —— 入口行数用 `wc -l`、IPC 面直接 require `dist-electron/ipc-registry.js`、业务文件分档排除 `scripts/` 与生成物。）

| 位置 | 实测 | 说明 |
|---|---:|---|
| `src/App.tsx` | **12 行** | 只剩 `useHarnessApp()` + earlyView 短路 + `<AppView/>`，**不再吸收任何逻辑**（底部 60 行死 re-export 面 09-22 已删） |
| `src/features/app-view/AppView.tsx` | 472 行 | 视图装配壳：编号段 `01-sidebar-shell` … `09-file-preview-editor` + 子目录 |
| `src/features/` | **51 个域目录**（09-24 实测） | 其中 `settings-*` **26 个**（设置页**按页同构**拆分，粒度稳定） |
| `src/features/app-state/useHarnessApp.tsx` | 39 行 | 组合根：建 `bag` → 按序调 9 个 part → 合并 return |
| `src/features/app-state/parts/` | 9 组合根 + 30 子 hook + `types.ts` + `bag-types.ts` | `bag-types.ts` **自动生成，禁手改**（守卫【93】） |
| `electron/main.ts` | **1219 行**（09-24 实测；⛔ 行数随 P2-9 下沉变动，改动后请重测本节） | 余 5 handler（`theme:apply` + `window:popout-*`×4，已证搬不动）+ 系统托盘（`electron/tray.ts` 接线）+ 启动链 + 模块级单例 |
| `electron/features/` | **35 个 `.ts` 模块 + 5 个子目录**（40 个条目） | IPC handler 实现 |
| `electron/ipc-registry.ts` | 账本 | `prefix / count / status(in-main\|in-features\|shell) / file / channels` |
| `electron/ipc-channels.manifest.json` | **315 个通道**（IPC 桥单一真相源） | `preload.ts` gen 段 + `vite-env.d.ts` gen 段由它生成：`npm run gen:ipc`（**自动**同步 `count` 并**体检账本登记**，缺了直接打印可粘贴条目）；**生成物禁手改**（守卫【2】22 条）。09-24 起所有 invoke 走 `__ipc`：参数个数校验 + 错误归一化（`[ERR_*]` 消息前缀）+ 通道级超时表 |
| `src/styles/` | 19 分节（`styles.css` 31 行 barrel） | 界面区域样式 |
| 跨域活绑定 | **22 个** `electron/features/*` 从 `../main` 取值 | 架构层真残留，纪律 +【91】守着（见 §8） |
| `electron/builtin-skills/` | **12 个内置技能**（含元技能 `skill-authoring` / `memory-distill` / `self-review` / `memory-hygiene` / `memory-classify` / `skill-audit`） | 启动时 `ensureBuiltinSkills` 落盘到 `$CODEX_HOME/skills`（守卫【103】） |
| 记忆金字塔 | **L0–L7 八层，90% 蒸馏线** | 层表/阈值单一真相源 = `electron/memory-layers.ts`（守卫【104】） |
| 记忆目录布局 | `<workspace>/.codex-harness/memory/` 下 `project/` `lessons/` `logs/` `rollups/` `archive/` | v2 分类分文件夹；v1 散文件由 `migrateLayout()` 搬（守卫【106】） |
| 记忆分类 | `lessons/` 内一个分类一个文件（**用户纠错单独一类**，永不淘汰） | 分类名与判定 = `electron/memory-lessons.ts`（守卫【105】） |
| 记忆整洁与清理 | 三个动作：`prune-pool` / `tidy-lessons` / `purge-archive`（白名单 + 二次确认） | 规则表与判定 = `electron/memory-hygiene.ts`（守卫【107】） |
| 技能落点 | 全局 `$CODEX_HOME/skills` + 项目级 `<cwd>/.codex/skills` | 引擎原生发现（`scope:"user"` / `scope:"repo"`），见 §11.2 |

---

## 1. 三层结构：一个东西该放哪一层

| 层 | 目录 | 允许 | 禁止 |
|---|---|---|---|
| **壳层** | `src/App.tsx`、`AppView.tsx`、`electron/main.ts` | 装配、路由、布局骨架、启动链、遍历注册面 | 写具体业务逻辑、持有域状态、再长出新分支堆 |
| **域层** | `src/features/<域>/`、`electron/features/<域>.ts` | 域内自由实现（组件/状态/样式/IPC） | 深链引别的域的内部文件（只许走对方的公开面） |
| **基座层** | `src/lib/*.mjs`(+`.d.mts`)、`src/components/`、`src/hooks/`、`electron/*.ts`（引擎/桥/存储/策略） | 纯函数、通用件、通用 hook、基础设施 | 反向 import 域层（基座不知道域的存在） |

**依赖方向恒为**：壳 → 域 → 基座。域 ↔ 域**只经 `app` 对象 / 显式 props / 对方 barrel**。

### 1.1 主进程新增文件放哪（`electron/features/` 还是 `electron/` 根）★ 判据

09-22 实测缺口：并发写入者把 `electron/memory-prune.ts`、`electron/memory-capture-debug.ts` 放进 `electron/` 根后，**无法判断这算不算"新增域"**。判据如下（按顺序问）：

| 问 | 是 → 放哪 | 否 → 放哪 |
|---|---|---|
| ① 它**暴露 `ipcMain.handle` 通道**吗（要在 `ipc-registry.ts` 记一笔）？ | `electron/features/<域>.ts`（**域层**） | 继续问 ② |
| ② 它是**引擎/桥/存储/策略/抓取/审计**这类基础设施，被别人调用而已？ | `electron/<名>.ts`（**基座层**） | 继续问 ③ |
| ③ 只是启动链的一段编排（`boot.ts` / `harness-services.ts` 这类）？ | 就地加进既有壳/编排文件，或 `electron/<名>.ts` | — |

**不必新增 `features/` 目录的情形**：纯工具/纯函数模块（`tool-call-dedupe.mjs` 属 `src/lib`、`memory-prune.ts`/`memory-capture-debug.ts` 属 `electron/` 根）。
⇒ 判据一句话：**有 IPC 面才进 `features/`，其余一律基座**；基座新增文件**不改变** §0 的「域目录数 / features 模块数」口径（这也是那两个文件不违反 §0 数字的原因）。

---

## 2. 板块怎么划分（判据，不是感觉）

一个板块 = 一个目录，须同时满足 4 条：

1. **用户可感知**：能说清"用户看到的哪块界面 / 哪条功能链"（`relay`=中转站、`memory`=记忆中心）。
2. **有独立契约面**：要么有独立 IPC 域（`electron/ipc-registry.ts` 里一行），要么有独立状态（bag 里一组），二者至少其一。
3. **边界内聚**：跨域边数量少且稳定；若某个域要 import 三个以上别的域的内部件 ⇒ 划错了。
4. **命名统一**：全小写 kebab（`settings-mcp`）；设置页域固定 `settings-<页 id>`；**目录名 = IPC 域前缀 = CSS 类前缀**（三者同源）。

**规模口径**（阈值是自定的，报数时必须说明口径）：
- 单文件：>400 行**评估**、>1000 行**必须拆**（不含自动生成物 `bag-types.ts`）。
- CSS：`styles/` 单分节 >1800 行属合理粒度上限，再切收益低。
- **新增域目录需用户点头**（09-22 起）：不因"更干净"而新增；同构的设置页沿用现有 23 个的范式。

**现存的域分类**（新功能对号入座）：
| 类别 | 例子 |
|---|---|
| 状态层 | `app-state/`（part 组合根 + bag） |
| 视图装配 | `app-view/`（AppView + 编号段） |
| 设置页 | `settings-*`（23 个，每页一个，同构） |
| 功能域 | `relay` `openai` `ssh` `memory` `dispatch` `session-queue` `session-cards` `session-turn` `composer` `experts-teams` `terminal` `markdown` `connectors` `storage-settings` `auth` |
| 共享 | `shared/`（跨域复用的域级件）、`src/components/`（跨域通用件） |

---

## 3. 新功能落点决策树（照着走不会放错）

```
要加的东西是什么？
├─ 纯计算/解析/判定（无 React、无 IPC）
│   → src/lib/<名>.mjs + 同名 .d.mts（预检直接跑真实现）
├─ 跨域通用 UI 件（按钮/卡片壳/头像…）        → src/components/<名>.tsx
├─ 跨域通用 hook                              → src/hooks/
├─ 一个完整功能（界面 + 状态 + 后端）
│   → src/features/<域>/  ＋  electron/features/<域>.ts  ＋  ipc-registry 记一行  ＋  preload/vite-env 同轮
├─ 只是设置页里的一个新页面
│   → src/features/settings-<页 id>/（复制现有设置页范式，勿另发明结构）
├─ 只是给"已存在的界面"加一块
│   → 优先加在拥有该界面的域内；改别人域 = 先问用户（见 §4.2 依赖规则）
└─ 只是给引擎加"知识/流程"（不涉 UI）
    → electron/builtin-skills / developer-instructions.ts
```

---

## 4. 接口怎么留（四条接口面，逐个给契约）

### 4.1 主进程 IPC 接口（新增/改动 channel 的完整动作）

| 规矩 | 内容 |
|---|---|
| 命名 | `<域前缀>:<动作>`，域前缀 = `ipc-registry.ts` 的 `prefix`；动作小写 kebab（`relay:accounts-save`）。**同域多动作不加新前缀** |
| 账本 | 新增域 ⇒ `ipc-registry.ts` 加 `{ prefix, count, status, file, channels }`；搬走域 ⇒ 同轮改 `status=in-features` + 填全 `channels`（守卫【90】校验"搬干净没有"） |
| IPC 桥（生成） | `electron/features/<域>.ts` handler ↔ `preload.ts` 桥接 ↔ `vite-env.d.ts` 声明。**加接口三步**：① manifest 加一条 ② `npm run gen:ipc`（自动同步 count、生成两个 gen 段、**打印未登记的账本条目**）③ 按提示补 `ipc-registry.ts` 记账。**禁手改生成段**；三面一致性 + 强化层由守卫【2】22 条钉住（改了 manifest 忘跑生成 = 红）。实测：漏了第 ③ 步不会静默 —— 生成时就提示、预检再拦一次 |
| 返回值/错误（09-24 强化） | 全量 invoke 走 preload 的 `__ipc`：**缺参在渲染层前置失败**（`ERR_MISSING_ARGS`）；错误归一化为 `[ERR_XXX] <channel>: …`；超时只在 `IPC_TIMEOUT_MS` 登记过的通道生效（默认不超时）。⛔ **渲染层别读 `e.code`**（contextBridge 跨进程会丢自定义属性，实测恒 undefined）—— 用 `src/lib/ipc-error.mjs` 的 `ipcErrorCodeOf / ipcErrorChannelOf / ipcErrorHintOf` |
| 事件通道（main→renderer） | 命名 `<域>:<事件>`；preload 暴露 `onXxx(cb)` 且**返回取消函数**；注册/清理成对（组件卸载必退订） |
| 返回值/错误 | 不 throw 裸 Error 给渲染层：统一 `{ ok, data?, error? }` 或既有约定；**错误文案必须是可展示的中文**，不把英文原文丢给用户 |
| 跨域取用 | 不同域的 handler 需要对方状态 ⇒ 走 `main.ts` 导出的**活绑定**，且**只在 handler 体内取用**（模块顶层取用 = 加载时序坑，守卫【91】加载级冒烟盯） |
| 启动链 | 副作用一律 `try/catch` 降级（一处裸 await 抛出会掐断整条启动链 ⇒"窗口能开、功能全哑"） |

### 4.2 渲染层组件接口

| 规矩 | 内容 |
|---|---|
| **`app`-prop 契约** | 需要共享状态的组件收一个 `app`（类型 = `HarnessAppApi` = `useHarnessApp` 的返回类型），**按需解构**。禁止把几百个绑定摊成 props（类型快照会僵化、每加一个状态要动一串文件） |
| props 上限判据 | 纯展示件 props ≤5；需要 >5 个且都是状态 ⇒ 改收 `app`。若解构清单 ≥ 子文件七成 ⇒ 停止拆分（结构性下限） |
| 跨域引用 | 只许 `from "../../<域>"`（barrel）；禁止 `from "../../<域>/内部文件"`。域自己的内部件也不得对外 export |
| 页面组件契约 | 设置页/独立页面组件：**命名导出**（供 `lazy(() => import(...).then(m => ({default: m.X})))`），入参只有 `app` 或少量 app 派生值 —— 09-22 起设置页按页懒加载（26 个分节），新页面默认沿用 |
| lazy 边界 | 只在"进该页才需要"的整页组件上懒加载；**Suspense fallback 只许用静态常量高度**（`settings-boot` 骨架范式），不得脱流/影响钉顶几何 |
| 依赖方向 | 域 A 不许 import 域 B 的内部；确实需要 ⇒ ① 下沉到 `src/components`/`src/lib`，或 ② 由 `app`/props 传入，或 ③ 先问用户 |
| **整页注册（09-22 落地范式）** | 设置页 = `00-settings-registry.tsx` 里**一行一页**（`id: { back?, render: () => <XSection .../> }`），由 `02-settings-content` 一次派发；**新页 = 注册表加一行 + `catalogs.ts` 的 settingsNav 加一项**（两边一致性由守卫【101】卡死）。导航不 import 注册表 —— 避免 helpers→registry→sections→helpers 循环依赖 |
| 二级页返回条 | 不收进写死的三元表达式，走注册表 `back: { to, label }` 元数据；验收项 `settings-registry` 会真点一遍 |

### 4.3 状态接口（bag 模式）

- 新状态**只能**：挂进既有 part，或新建 part 并**同轮**进 `bag-types.ts`（自动生成：`createProgram + TypeChecker`，**禁手改**，守卫【93】防漂移）。
- 跨 part 共享的本段局部绑定 = 0 是当前设计红线（拆 part 时会踩前向引用）。
- **真相源唯一**：同一事实（如 `<userData>/images`）只许一处推导（守卫【95】）；读取/补数路径不许改"谁生效"。
- 状态重置挂在**动作**上（`openThread` 这类入口），不许挂在"某条渲染分支"里（分支被挡掉 ⇒ 重置被跳过）。

### 4.4 样式接口

- 新增样式落 `src/styles/<分节>.css` 并在 `styles.css` barrel 里 import；**不许**在域目录里散落 css（现状 19 分节统一管理）。
- 域 CSS 前缀 = 域 id，**禁跨域选择器**。
- **类名是接口**：`accept.mjs` 的 CDP 选择器依赖 DOM 类名 ⇒ 可见交互 / class 名一律不动（需要改先问用户）。
  残留零消费类名已清理（09-22 清 33 个）；新增类名必须同时有 CSS 规则或明确的 JS 锚点用途。

### 4.5 类型与纯函数接口

- 纯函数一律 `src/lib/<名>.mjs` + 同名 `.d.mts`（预检能直接 import 真实现跑断言）。
- **主进程侧纯函数**（要被 `electron/**` import、且不能引 `../src/lib` —— tsconfig `rootDir = electron/` 会破坏产物结构）
  放 `electron/<名>.ts`，预检从 `dist-electron/<名>.js` 跑真断言（先例：`electron/voice/wake-match.ts`、【97】的 `electron/memory-prune.ts`）。
- 跨产物路径：`require("字面量")` 是 **tsc 盲区**（不解析模块），路径必须由守卫【96】可解析校验兜住。

---

## 5. 每个板块的验收契约（可机器校验，不靠自觉）

| 契约 | 校验 |
|---|---|
| 声明的域已搬干净（main.ts 该域通道归零） | 守卫【90】 |
| 跨域活绑定只在 handler 体内取用 | 守卫【91】加载级冒烟 |
| `bag-types.ts` 与源码一致 | 守卫【93】 |
| 无整条死导入 | 守卫【94】 |
| `<userData>` 派生路径唯一真相源 | 守卫【95】 |
| 编译产物相对 `require` 全部可解析 | 守卫【96】 |
| 同一个 tool call 只执行一次（按 `event.id` 去重，重复到达复用结果） | 守卫【98】 |
| 记忆捕获链：buffer 按 `threadId` 兜底 + `localCapture` 每个出口留痕 | 守卫【99】 |
| 预检聚合器必须**递归**（`readMainSource` / `readAppUi` / `main-source.cjs` / `config-scan.mjs`） | 漏新目录 ⇒ 断言假红；`config-scan` 只读单文件会让守卫**静默恒真**（最危险） |
| 渲染层改动要看截图 | 一次性 profile 冒烟（`CODEX_HARNESS_USER_DATA=<tmp>` + `NO_MIGRATE=1`），不与用户实例共用数据 |

**每轮收尾（缺一不可）**：改代码 → 构建 → `npm run check`（必须绿）→ 渲染层改动加冒烟截图 → code review 本轮 diff（问题当轮修）→ 清理临时产物 → 同步本文 §0 数字与 `AGENTS.md` 落点 → 提交 → 推送 → 写记忆。

---

## 6. 新增板块 checklist（照做，顺序别换）

1. 定层：域 / 基座 / 壳（§3 决策树）。
2. 定名：kebab、目录名 = IPC 前缀 = CSS 前缀。
3. 建目录：`src/features/<域>/`（+ 需要在 `electron/features/` 建对应模块）。
4. 状态：挂 bag（同轮更新 `bag-types.ts` 生成物）。
5. IPC：`electron/ipc-channels.manifest.json` 加一条 → `npm run gen:ipc`（自动同步 count、重生成两个 gen 段、**打印未登记的账本条目**）→ 按提示补 `ipc-registry` 记账。**勿手改生成段**。
   ⛔ 撤回/切换分支后若【2】报"生成段与 manifest 不一致"，先看是不是**行尾差异**（`git checkout` 恢复成 CRLF、生成器写 LF）—— 重跑一次 `npm run gen:ipc` 即可，不是真错。
6. 视图：页面组件收 `app`，命名导出（可 lazy）。
7. 样式：`styles/` 加分节 + barrel import，前缀 = 域 id。
8. 守卫/断言：把「这个域该有的不变量」补进 `scripts/guards/` 下对应域文件（⛔ 断言总数以 `_ctx.mjs` 的 `EXPECTED_CHECKS` 为准 —— 别在这里写死第二份数字，它必然滞后；当前最大编号 **【142】**，缺守卫的域属未完成）。
9. 文档：本文 §0/§2 表 + `AGENTS.md` 同步；`npm run check` 绿；提交（一批一提交）。

---

## 7. 规划节奏

- **先状态后视图**：状态没抽成域 hook 之前不搬视图（props 会爆炸）。
- **先基座后域**：纯函数下沉 `lib` 后可被真断言覆盖，是后续所有搬动的地基。
- **一批一提交**，每批 `check` 绿；禁止长命重构分支（用户明确拒绝 fork/分支绕开）。
- **接口先定后写**：新增域先写 registry 行 / 三件套签名，再填实现 —— 让"接口在哪"始终可查表。
- **搬运期铁律**：纯搬迁、零行为改动；断言跟着搬（预检读 `App.tsx` / `main.ts` 的断言要同步改路径，禁批量替换）。

---

## 8. 已知未落地项与风险（诚实清单，别当已完成）

| 项 | 现状 | 风险 |
|---|---|---|
| `src/features/registry.ts` + `defineFeature` + 插槽 `Slot.tsx` | **未落地**（ARCHITECTURE.md 的目标） | 设置页/顶栏/侧栏仍是硬编码分支（设置页已抽成 26 个 lazy 分节，属半程） |
| preload/vite-env **自动生成** | ✅ **已落地（09-23）**：`ipc-channels.manifest.json` 单一真相源 + `npm run gen:ipc`，两个生成物与 manifest 逐字节一致由守卫【2】钉住 | 残留：**manifest → 账本是单向校验** —— 加了 handler 忘进 manifest ⇒ 渲染层静默调不到（反向需"是否暴露"标记位，未做） |
| `electron/features` ↔ `main.ts` **双向依赖**（22 文件取 103 符号） | ⛔ **搬迁方案已实测证否（09-22）** | 现状靠"只在 handler 体内取用"纪律 +【91】兜着。**别再试「把定义搬到 ctx 模块」**：103 符号里 23 个是顶层 `app.getPath("userData")` 路径常量（+ 依赖它们的单例），搬到任何非 main.ts 模块都会被【91】拦（import 早于 `app.setPath` ⇒ 路径静默漂移到 `%APPDATA%\codex-harness-desktop`）；而"先惰性化再搬"的代价实测 = **387 处调用点**（`codexHome` 一个 170 处 / 跨 36 文件）⇒ 成本远超收益。完整踩坑记录见 `.codex-harness/memory/lessons/pitfalls.md` |
| `lib/bus.mjs` 跨域事件总线 / `lib/ipc.ts` 服务访问层 | 未落地 | 域间偶发直连与 `window.codex.*` 直调 |
| 主进程 `ctx`（deps 契约） | 未落地 | handler 仍共享模块级闭包，可测性差 |

---

## 9. 红线汇总（违反即回退）

1. 不搬"同一条语句内部"之外的顺手动；**行为语义 / 权限边界 / 可见交互未经确认不动**（曾擅自收紧 `fs:write` 被回退）。
2. 不改 DOM 结构 / class 名 / 可见交互（CDP 选择器依赖）。
3. 不把逻辑写回 `App.tsx` / `main.ts`（只许往下减）。
4. 不新增域目录、不合并设置域（需用户点头）。
5. 不在模块顶层求值 `app.getPath("userData")` 一类派生路径（import 先于 `setPath`，路径静默漂移）。
6. 不用 `git add .`；临时产物只落 `.workbuddy/tmp/`（禁落仓库根与 `D:\` 盘根）。
7. 主仓库（`D:\Codex Harness Desktop`，发版源）源码**一行不动**——动它必须用户拍板。
8. 不给 `vite.config.ts` 的 `build` 加回 `emptyOutDir: true`（vite 默认值）：每次 build 清空 dist ⇒ **正在运行、加载 dist 的实例**点开 lazy 页面就 `Failed to fetch dynamically imported module`（09-23 反复崩溃的根因）。旧 chunk 必须留着，并配 `src/main.tsx` 的 `vite:preloadError` 自愈。

---

## 10. 并发写入纪律（**这个副本同时有多路写入者**，09-22 实测）

**事实**：`D:\Codex Harness Desktop-refactor` 上同时存在两路写入者 —— WorkBuddy 会话（shell 跑 git）与**应用内置的 Codex 引擎会话**（cwd 同为该副本）。
两边**共用同一 git 身份**（`Codex Harness Dev`）、**都直推 `main`**，所以 `git log` 看不出是两路。09-22 实测交错：

```
17:16 d47f238(路 B) → 17:19 b188b56(路 B) → 17:23 17755a4(路 A)
→ 17:39 4b81a16(路 A) → 17:41 09097de(路 B)
```

⇒ **直接后果**：后立的规则文档对先做的改动只能是「事后对照」；任一路都**看不到对方在途的工作**。

| 纪律 | 内容 |
|---|---|
| **开工先重读 HEAD** | `git log -1` + `git status`：HEAD 已经不是自己上次的提交、或工作区出现自己没动过的文件 ⇒ **对方正在干活**，先定性（`git log -S` / mtime），**不要当残留清掉或回滚** |
| **只 add 自己本轮明确列出的文件** | ⛔ 禁 `git add -u` / `git add .` / `-A`（会把对方的半成品一并提交）。逐文件写路径 |
| **提交前再重读一次 HEAD** | 提交信息里若引用了别人刚改的状态，先核对；自己的改动被对方带上去了要记下来 |
| **文件范围互斥**（需用户指定归属） | 双方都动的热点：`scripts/check-preflight.mjs`（断言总集）、`scripts/accept.mjs`、`AGENTS.md`、`docs/FEATURE-INVENTORY.md`、**`docs/ARCHITECTURE-RULES.md`（本文件）**、`src/styles/*`。**同一时刻只允许一路改同一个热点文件**，否则必然互相覆盖 |
| **禁止破坏性同步** | 不用 `push --force` / `reset --hard` / `checkout -- .`（会把对方成果抹掉）；需要时先问用户 |
| **§0 数字口径** | 数字是**某 SHA 的快照**；并发期允许漂移，以**最新一次提交**为准，由最后收尾的那一路负责同步，并在提交信息里写明同步到哪个 SHA |

## 11. 记忆与技能（经验包）：目录化的记忆金字塔 + 技能沉淀

这套东西是给**引擎自己**用的记忆与经验（不是应用的功能页）—— 规则在这里，实现只有一个真相源。

### 11.1 记忆金字塔（L0–L7，每层满 90% 往下蒸一层）

**全部落在一个目录** `<workspace>/.codex-harness/memory/`，**按层 / 分类分子文件夹**（v2，09-22 起：文件夹保存不会乱）：

| 层 | 落点（相对 `memory/`） | 是什么 | 预算 | 谁写 | 满了沉到 |
|---|---|---|---:|---|---|
| **L0** | `USER.md`（userData 下，跨项目） | 用户档案：偏好 / 禁忌 | 4000 | 用户手写 | 人工精简（**不自动删**） |
| **L1** | `project/MEMORY.md` | 项目宪法：约定 / 选型与理由 | 12000 | 蒸馏 | 同层压缩：并同主题、删过时 |
| **L2** | `lessons/corrections.md`（**用户纠错**）· `lessons/pitfalls.md`（任务经验）· `lessons/sop.md`（工作流/SOP）· `lessons/preferences.md`（用户偏好） | 纪律与记忆：**一个分类一个文件** | 8000 | 捕获链 + 引擎 | **先升级为技能**再压缩 |
| **L3** | `project/BACKGROUND.md` | 项目背景（快速入门） | 6000 | 用户 / 引擎 | 稳定下来的升格进 L1 |
| **L4** | `logs/YYYY-MM-DD.md` | 每日日志 | 40000（8000/天 × 回灌 5 天） | 捕获链自动 | 沉 L5（原文进 L6） |
| **L5** | `rollups/YYYY-MM.md` | 月度卷宗 | 12000 | 蒸馏 | 沉 L1 |
| **L6** | `archive/*.md` | 冷存档（原文，可回溯） | — | 蒸馏（移动） | 终态，**不进注入** |
| **L7** | `memory.json` | 碎片池 | — | 捕获链自动 | 按 TTL 淘汰 → `pruned.jsonl` |

**分类（`lessons/` 内，用户点名要有）**：`corrections.md` = **用户纠错（单独一类）**，注入排最前、**永不参与自动淘汰**（丢掉就等着再犯同一个错）；其余三类按 偏好 / SOP / 坑 分文件。行前缀：`⚠️ 纠错：` / `偏好：` / `约定：` / `⚠️ 坑：`。

**v1 → v2 迁移**（`migrateLayout()`，幂等）：旧布局把 `MEMORY.md`/`BACKGROUND.md`/`LESSONS.md`/日志**摊在根**。迁移**只移动不复制**；旧 `LESSONS.md` 按分类拆进 `lessons/` 后原件归档到 `archive/legacy-LESSONS.md`；**新位置已有内容时一律不覆盖、不合并**（旧内容以归档为准）。守卫【106】用真实 v1 现场验全部四条。

> 预算口径 = **重度开发者**（2026-09-22 用户定：一天几十轮、多会话并行、大项目；旧值六七轮即触 90% 线，太紧）。
>
（`MEMORY_DISTILL_THRESHOLD = 0.9`）/ 目录常量只在 `electron/memory-layers.ts`；
   分类名与分节解析只在 `electron/memory-lessons.ts`（渲染层 `MEMORY_CATEGORIES` 复用同一套名字）。守卫【104】【105】【106】盯同源。

### 11.1.1 自动蒸馏（超出即蒸，两条路都自动）

| 路径 | 触发 | 谁执行 |
|---|---|---|
| **应用侧（本地兜底）** | 日志满 **30 天** **或** 该层到 **90% 水位** ⇒ `autoDistill` 在会话结束时跑一次（6 小时节流，状态在 `.distill-state.json`） | 主进程（一次性 codex 会话当 summarize） |
| **引擎侧（在回合内）** | `context()` 在任一层 ≥90% 时把提示行塞进常驻记忆块：`[Harness 记忆水位 · ⚠️ 已达 90% 蒸馏线…]`（平时为空） | 引擎自己：先读技能 `memory-distill`，按它蒸完再继续任务 |

**一次落三层**：模型输出两段（`## 核心` / `## 纪要`）⇒ 核心进 L1、纪要进 L5、原文**移动**进 L6；标题缺失退回单段（整段进 L1）——**任何情况下不丢内容**。

### 11.2 技能（可复用流程）：两个落点

| 范围 | 落点 | 引擎可见性 |
|---|---|---|
| 全局 | `$CODEX_HOME/skills/<名>/SKILL.md` | `skills/list` → `scope:"user"` |
| **项目级（默认）** | `<cwd>/.codex/skills/<名>/SKILL.md` | `skills/list` → `scope:"repo"`，随项目走（09-22 探针实证） |

⛔ 项目级**必须**落 `<cwd>/.codex/skills`（与既有 `<cwd>/.codex/commands` 同族约定）：
   · `.codex-harness/skills` 引擎**不认**（实测 `skills/list` 里不出现）；
   · 引擎原生发现 ⇒ **不要在 AGENTS.md 索引里重复枚举项目技能**（同一技能列两遍 = 看起来像假的）；
   · 项目信任策略只挡 config / hooks / exec 策略，**技能照样加载**。

**记忆 vs 技能分工**：记忆记「是什么」（事实 / 约束 / 纠错与坑），技能记「怎么做」（流程 / 命令 / 判据）。
`lessons/` 里同一现象出现**第二次** ⇒ 升级成技能（已写进引擎指令第 8 条与元技能 `skill-authoring`）。

### 11.3 新增一层 / 新增分类 / 新增技能的 checklist

1. **加一层**：改 `MEMORY_PYRAMID`（id / 预算 / 去向 / 谁写 / 落点）→ 同步本文件 11.1 表 + `08-skill-memory-distill` 技能正文的表 → 【104】断言层 id，【106】断言落点；
2. **加一个记忆分类**：在 `memory-lessons.ts` 加分类常量与判据 → 在 `memory-layers.ts` 的 `LESSON_FILES` 加「分类 → 文件名」→ 渲染层 `MEMORY_CATEGORIES` 同步同一名字 → 【105】断言分类清单与指令；
3. **加技能**：写 `<名>/SKILL.md`（`description` 决定何时加载，缺了等于没写）→ 落点按 11.2 → 【103】的解析 / 扫描断言覆盖；
4. **加内置技能**：常量必须是**字面量**（【86】按源文件文本扫安全面，运行时拼装 = 扫描器看不见 = 假绿）→ 注册进 `ensureBuiltinSkills` 的 `entries`（不注册 = 永不落盘）；
   ⛔ 内置技能常量是**模板字符串**：正文里每个反引号都要写成转义形式，裸反引号会提前结束字符串（09-22 实测被 build 抓到）。

### 11.4 记忆管理与清理规则（怎么整洁、谁能清、清了留什么痕）

**三条原则**（写进规则表，UI 与引擎都读同一份；规则单一真相源 = `electron/memory-hygiene.ts`）：

1. **能归档就不删** —— 被压缩掉的内容先移进 L6 冷存档（可回溯）；只有"冷存档本身"允许被用户清空。
2. **保护项永不自动清** —— L0 用户手写、L2 的「用户纠错」、L7 的 `pinned`：自动流程一律不碰。
3. **清理要留痕** —— 淘汰写 `pruned.jsonl`，蒸馏把原文移进 `archive/`；谁被清、何时清，事后查得到。

| 层 | 何时整理 | 动作 | 保护项 | 留痕 |
|---|---|---|---|---|
| **L0** 用户档案 | 只有用户主动改 | 禁止任何自动压缩/删除 | 整层（全手写） | 编辑记录 |
| **L1** 项目宪法 | 水位 ≥90% / 用户点蒸馏 | 合并同主题、删过时（**先移进 L6**） | 用户手写段落 | `archive/` + `.distill-state.json` |
| **L2** 纪律与记忆 | 水位 ≥90% / 同现象重复写入 | 同现象只留一条；超 120 行提示整理；升级为技能后标注 | **「用户纠错」整类** | 行内标注 + 蒸馏记录 |
| **L3** 项目背景 | 水位 ≥90% | 合并同主题；稳定约束**升格**进 L1 | 用户手写段落 | L1 的蒸馏记录 |
| **L4** 每日日志 | 满 30 天 **或** 水位 ≥90%（自动） | 纪要→L5、仍成立的事实→L1；原文**移动**进 L6 | 无（只移动不删） | `archive/YYYY-MM-DD.md` |
| **L5** 月度卷宗 | 水位 ≥90% | 压缩进 L1；月卷保留 | 无（保留不删） | L1 的蒸馏记录 |
| **L6** 冷存档 | **只在用户手动清空** | 默认永久保留、不参与注入；清空需二次确认 | 无（用户显式决定） | `pruned.jsonl` |
| **L7** 碎片池 | 每 6h 自动 / 用户点清理 | 过期（临时上下文 >14 天）与超容量（500）按价值淘汰 | `pinned` 与「用户纠错」 | `pruned.jsonl` |

**管理面（三个动作，都走白名单 + 二次确认）**

| 动作 | 做什么 | 危险点 |
|---|---|---|
| `prune-pool` | 清 L7 过期碎片（跳过 6h 节流，强制留痕） | 按规则淘汰；`pinned`/纠错豁免 |
| `tidy-lessons` | 整理 L2 格式：行尾空白、连续空行折叠、补末尾换行 | **无损** —— 只动空白，不改写内容 |
| `purge-archive` | 清空 L6 冷存档，释放空间 | **真删** —— 清空后不可回溯 |

⛔ **护栏（三条，缺一不可）**：
1. IPC 分两个通道：`memory:hygiene:plan`（**只读**，返回规则表 + 待办 + 水位）与 `memory:hygiene:apply`（**动作**）；
2. `apply` **必须** `confirm === true`，否则直接抛错（渲染层误点/脚本调用都删不掉冷存档）；
3. 动作走**白名单**（`HYGIENE_ACTIONS`），未知动作一律拒；UI 侧先展开确认条（显示后果文案），再点「确认执行」才发请求。

**界面**：设置 → 记忆 → 「分层」页底部「记忆整洁」区块：八层水位条（≥90% 高亮）、分类计数（「用户纠错」加框）、待办清单、三个动作按钮、可展开的清理规则表。

**整洁检查（只报告、不自动改）**：`lintLessonLines()` 抓「缺日期 / 缺分类标记 / 超 320 字 / 超 120 行」；`planHygiene()` 汇总「哪层满了 + 格式问题 + 归档过大 + 过期碎片」并由 `suggestedActions()` 映射成可点动作。守卫【107】用真实临时工作区验规则表、纯函数与三个动作。

**加一层 / 加一个动作的 checklist**：改 `CLEANUP_RULES`（层）或 `HYGIENE_ACTIONS` + `HYGIENE_ACTION_LABEL`（动作）→ 执行逻辑落 `memory-layers`/`MemoryStore` → IPC 白名单分支 → UI 按钮（复用二次确认条）→ 同步本表 → 【107】断言。
