# 一切皆插件：Codex Harness Desktop 架构改造方案

> 立项：2026-10-03 · 基线 SHA `c8b19c0` · 参照物：DeepSeek Harness（`dsh`）
> 本文是**方案**（设计 + 路径 + 判据），不含已执行的代码改动。执行按 §6 分阶段推进，每阶段独立提交。

---

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 能不能落地？ | **能**，而且不是从零开始 —— 主进程已有 Cordis 语义内核（`electron/context.ts` + `ipc-host.ts` + 组合层），缺的是**覆盖面**与**接缝/组合/渲染层**三块。 |
| 能不能照抄 DeepSeek？ | **不能**。Electron 存在**宿主特权边界**（`app` 生命周期 / 窗口 / preload / CSP / 自定义协议），这些插件化等于让插件自选安全策略 —— 是安全回归，不是架构进步。内核必须保留"宿主绑定 + 安全强制"。 |
| 最大差距在哪？ | ① 79 个域前缀**只有 13 个**是插件形态，66 个仍是模块体裸 `ipcMain.handle`；② 无**能力接缝**（换实现要改代码）；③ 无**运行时装卸**（有 `dispose` 但没入口）；④ 无 **profile 分层组合**；⑤ 渲染层 `registry.ts` / `Slot.tsx` **确认未落地**。 |
| 前置条件 | **阶段 0 = 拆掉 10 处多前缀欠账**（56 个前缀）。一个插件必须只有一个身份 —— 多前缀板块在插件体系里无法登记，这是硬前置，不是可选项。 |
| 工作量 | 主进程侧可控（有生成器 + 棘轮守卫）；**渲染层 44,654 行**是最大项，建议只做"注册表 + 插槽"骨架 + 设置页试点，不做全量改造。 |

---

## 1. 参照物核实（不编，附来源）

我没凭印象写。搜索核实的公开来源：

- 官网 `deepseekharness.online`（中/英双版）/ `deepseekharness.io`：DeepSeek Harness，CLI 名 **`dsh`**，2026-08-13 发布 v0.1 Developer Preview，MIT 开源。定位 `Model + Harness = Agent`。
- 百度百科词条：底层 **Cordis** 框架（源自 Koishi 聊天机器人框架），具备**可逆副作用**特性 —— 能追踪并自动回收插件注册产生的副作用，实现真正的热插拔。

**三条支柱**（官方表述）：

1. **薄内核**：Cordis 元框架只负责插件的加载/卸载与依赖关系，本身不承载任何 Agent 具体能力。
2. **能力皆插件**：模型、工具、技能、会话、沙箱、存储、循环、调度、UI 全部是独立插件，插件间通过服务与事件协作。
3. **配置层自由组合**：`profile`（具名组装）→ `bundle`（组合包）→ `cordis.patch.yml`（补丁）→ `--patch`（覆盖层），按序叠加；`dsh --profile web --dump-config` 打印实际启动的配置树，打印出的任何条目都可被 patch 替换。

**两个配套概念**：

- **能力接缝（Capability Seam）**：一个可替换能力有三个角色 —— Service Definition（接口声明）/ Service Provider（实现）/ Consumer（使用方）。接缝是"换一个 provider 就换掉整个产品"的原因（例：filesystem 与 process 共享同一个执行世界，指向远端沙箱时 Bash/PTY/LSP 一起搬走）。
- **运行有迹可循**：append-only 会话日志 + 轨迹视图；运行时不变量强制"送到模型的一切都可从日志重建"。

---

## 2. 现状基线（2026-10-03 实测，`c8b19c0`）

所有数字由脚本重算，非引用旧文档。口径 `wc -l`（含空行）。

| 面 | 实测 |
|---|---:|
| 域前缀（`ipc-registry.ts` 登记） | **79** |
| ├ 已插件化（组合表启用，`defineFeature`） | **13** |
| └ 未插件化（模块体裸 `ipcMain.handle`） | **66** |
| `electron/features/` 文件 | 76（插件形态 13 · 仍裸 `ipcMain` 35） |
| `electron/` 基座层模块（根层 `.ts`，非 `features`） | **83 个 / 18,502 行** |
> **10-04 实测：`main.ts` 剩余构成（按段落行数，这是迁移依据）**
>
> ⛔ **别只看总行数** —— 1,165 行里 **430 行是注释、198 空行**，真实代码约 450 行。
> 而且托盘 / 语音 / 中转站 / 内置插件这几段的**实现早已在** `electron/tray.ts`、
> `features/voice-ipc/` 等处，`main.ts` 里剩的是 8–22 行的**接线注释 + 调用**。
> 真正还能搬的是下面几段：
>
> | 行数 | 段落 | 判断 |
> |---:|---|---|
> | 151 | 会话运行时配置（模型 / 思考档位 / 权限） | **可搬**：内部自成一域（读 config.toml + 写回 + 多窗口并发保护） |
> | 114 | Bot Channel 配对门卫 | 需判定：依赖 `showMainWindow` 与配对状态机 |
> | 113 | 会话备份导入 / 导出 | **可搬**：读引擎 rollout 原档 + 元信息打包 —— 独立功能域 |
> | 101 | 语音通话 IPC 面 | 已搬完（10-03 改组合表），剩下的是注释 |
> | 88 | 系统托盘 | 接线已只有 22 行，实现早就在 `electron/tray.ts` |
> | 77 | 重启闸门接线 | 需判定：依赖单实例锁与窗口显示的时序 |
> | 55 | 退出统一清理 | 需判定：依赖服务单例的构造顺序 |
>
> ⇒ **建议把目标从「到 600 行」改成「消除服务实例区」**：那些 `setServer` /
>   `setVoiceService` / `setRpaStore` 等注入点背后是**互相咬合**的对象（scheduler 依赖
>   server、channelBot 依赖 mainWindow、voice 依赖 toolsRoot + server），且
>   **组合表在 main.ts 第 96 行 import，而这些注入在 300–580 行** ⇒ **域挂载早于单例注入**。
>   硬搬的失败模式是「行数达标但启动崩」。按依赖链分批（先搬无依赖的）比追求行数更安全，
>   行数会自然跟着降。
>
> **已搬走的第一批**（10-04，`06822dc`）：崩溃取证 + GPU 诊断 + 图片占位兜底
> → `electron/runtime/host/diagnostics.ts`，main.ts 1199 → 1165。
| `electron/main.ts` | **1,165 行**（10-04 实测）：import 67 · **代码约 450** · 注释约 430 · 空行约 198 · 纯副作用域 import **0 行** · `ipcMain.handle/on` **5**（theme + window:popout×4，已证不可搬） |
| ├ 含 `features/` 的 import | 36 行 |
| └ 其中**纯副作用** import（`import "./features/x"`） | **14 行** ⚠️ 口径见下 |
| `src/features/`（渲染层） | **58 板块 / 44,654 行** |
| ├ `app-state` | 17,608 行 / 83 文件（拆骨成果，含自动生成 `bag-types.ts`） |
| ├ `app-view` | 9,173 行 / 35 文件 |
| └ `drama-canvas` | 4,593 行 / 14 文件（最大业务板块） |

> ⚠️ **口径说明（避免下次误判）**：`AGENTS.md` 记的"副作用域 import 26 → 15 行"指的是**纯副作用 import**（`import "./features/x"` 不带花括号），实测 14 行与之吻合；上表的 36 行是**所有含 `features/` 的 import**（含取符号的具名导入）。两个数字都对，是两把尺子。
>
> ⚠️ **扫描口径坑（本轮亲自踩到）**：第一版扫描脚本的 `walk()` 只收 `.ts` 漏了 `.tsx`，渲染层报 5,450 行（真值 44,654），差 8 倍且看着"合理"。**以后引用任何扫描输出前先确认它收了 `.tsx`。**

**未插件化的 66 个前缀**（按落点分组，`→` 后为该板块承担的前缀）：

| 落点 | 前缀数 | 前缀 |
|---|---:|---|
| `im-channels-ipc.ts` | 13 | bot / bots / bot-binding / bot-stream / channel-bot / weixin / telegram / feishu / dingtalk / qq / wecom-webhook / ponytail / channels |
| `settings-app-ipc.ts` | 8 | ssh / personalization / terminal / browser / pasted-text / appSettings / git / scratch |
| `builtin-skills-ipc/` | 7 | builtin / plugin / tools / skills / skill-discipline / plugins / hooks |
| `engine-ipc/` | 6 | thread-runtime / codex / engine / runtime / threads / bridge |
| `teams-agents-ipc.ts` | 6 | agents / teams / commands / subagents / team-threads / team-runs |
| `memory-rpa-ipc.ts` | 4 | memory / rpa / tasks / scheduler |
| `shell-misc-ipc.ts` | 4 | notify / awake / external / shell |
| `model-custom-ipc/` | 3 | openai / custom-model / model-specs |
| `connectors-mcp-ipc/` | 3 | connectors / mcp-servers / prompt |
| `user-ipc.ts` | 2 | user / capabilities |
| 单前缀（各 1） | 10 | app / dialog / fs / laya / relay / remote / video / voice / theme / window |

---

## 3. 差距分析（逐条对照三条支柱）

### 3.1 支柱一「薄内核」—— 内核语义已具备，但**太胖**

| Cordis 内核职责 | 本项目现状 | 判定 |
|---|---|---|
| 插件加载/卸载 + 依赖 | `Context.plugin()` 带 `inject` 门禁、**缺依赖在 apply 前抛错** | ✅ 已具备 |
| 可逆副作用 | `Fiber.dispose()`：先子后己、effect **逆序**、监听与本地服务清空 | ✅ 已具备 |
| 半注册回滚 | `apply` 抛错 ⇒ 子 ctx 摘除 + 副作用清理 | ✅ 已具备 |
| 作用域隔离 | 服务沿父链查找，子 ctx 同名覆盖父 | ✅ 已具备 |
| 事件协作 | `on`/`emit` 向父冒泡 | ✅ 已具备 |

⚠️ **但 `main.ts` 1,215 行同时持有**：app 生命周期、窗口/协议/CSP、34 个模块级单例、24 行启动链、5 个 handler、36 行域 import。
对照"只管装卸与依赖"，多出来的是：**启动链 + 单例 + 宿主绑定**。其中宿主绑定（含安全策略）**必须留**，启动链与单例**可以下沉**。

### 3.2 支柱二「能力皆插件」—— 覆盖面 16%，且**没有接缝**

- **覆盖面**：13/79 = **16%**。其余 66 个是"模块加载期裸注册"，没有 `inject`、没有 `dispose`、没有依赖声明。
- **接缝缺失**（更本质的差距）：目前 `ipc-host.ts` 是**直接 provide 一个具体实现**（`ipcMain` 的薄封装），没有"接口定义 / 实现 / 消费"三角色分离。换实现要靠改代码，不是换配置 —— 这正是 DeepSeek 说的"接缝是换个 provider 就换掉整个产品"的能力，本项目**目前只有 1 个接缝，且未分离**。
- **宿主能力无门禁**：`ARCHITECTURE-RULES.md` §8 明确 —— "域仍可从 `electron` 取 `app`/`dialog` 等宿主能力，只把**注册通道**收进容器；能力白名单是 **P3（未做）**"。35 个 features 文件仍裸 `ipcMain`，意味着插件能自己挂任意通道，**绕过全部声明与校验**。
- **无运行时装卸**：`dispose()` 存在但**没有用户入口**（无 UI、无命令、无插件市场）。

### 3.3 支柱三「配置层组合」—— 只有一张平表

现状：`composition.json` 单行结构 `{ id, enabled, file, export, config }`，一个 `enabled` 布尔开关。
缺：profile（场景化插件集）、bundle（可分发的组合包）、patch 层叠、`--dump-config`。
⇒ 现在做不到"最小模式只挂 shell 工具"、"换个 profile 就是另一个产品"。

### 3.4 渲染层 —— 骨架未落地（最大项）

实测确认：`src/features/registry.ts` ❌、`registry.tsx` ❌、`src/components/Slot.tsx` ❌、`src/features/Slot.tsx` ❌ —— **全部未落地**。
设置页/顶栏/侧栏仍是硬编码分支。已有的**半成品**是 `settingsPagesOf`（注册表式，命中 3 个文件）—— 这是可复用的现成样板。

---

## 4. 目标架构

### 4.1 内核边界：哪些**不**插件化（与 DeepSeek 的关键差异）

DeepSeek 运行在 CLI/Node，可以宣称"不存在需要打补丁的特权内核"。**Electron 不行**，理由如下 —— 这是本方案最重要的独立判断：

| 能力 | 判定 | 理由（本项目实证） |
|---|---|---|
| `app` 生命周期（`whenReady` / `window-all-closed`） | **内核，不可替换** | 逻辑先在：插件要挂载，宿主必须先存在。且 `app.setPath("userData")` 必须在任何派生路径求值**之前** —— 守卫【91】钉死，搬到非 `main.ts` 模块会被 import 时序坑到**路径静默漂移**。 |
| 窗口创建 + preload + contextBridge | **内核，不可替换** | 渲染层隔离边界。插件若能自带 preload，等于自选 `contextBridge` 暴露面。 |
| CSP（Content-Security-Policy） | **内核，强制** | 实证教训：CSP 里 `*` **不覆盖自定义协议**，必须显式加 `pet:`，否则图集被拦成空白（症状是浮窗全透明，computed style 却正常 —— 典型假绿）。 |
| 自定义协议白名单（`pet://` / `harness-image://`） | **内核，窄口径** | 实证教训：曾因"方便"想放宽 `harness-image` 可信根 → **判定为安全回归，回退**。协议注册必须内核强制窄口径。 |
| 路径可信校验（`isInsideOrEqualTrustedRoots`） | **内核，强制** | 渲染层传来的路径不可信，不校验等于系统级打开任意目录（09-19 审计中危）。 |

⇒ **本项目的内核 = 宿主绑定 + 安全强制 + 插件运行时**。
这不是"特权内核"，而是**宿主任期**——与 DeepSeek 的差异来自运行环境（有渲染进程的特权边界），不是设计偷懒。

### 4.2 四层

```
┌─ L3 组合层 ────────────────────────────────────────────┐
│  profiles/*.json → bundle → patch（按序叠加）            │
│  dump-config：打印实际启动的插件树                        │
├─ L2 领域插件 ──────────────────────────────────────────┤
│  electron/features/<域>/   79 个，一个插件 = 一个域前缀    │
│  形态：defineFeature({ id, inject, setup })             │
├─ L1 能力接缝 ──────────────────────────────────────────┤
│  seams/：ipc · fs · dialog · shell · protocol · window   │
│          · storage · subprocess                        │
│  三角色：Definition（接口）/ Provider（实现）/ Consumer   │
├─ L0 运行时内核 ────────────────────────────────────────┤
│  context · fiber · composition-loader · capability-guard│
│  host/：app-lifecycle · window · csp · protocols        │
│  ⛔ 不许 import features/；⛔ features/ 不许 import 组合层 │
└────────────────────────────────────────────────────────┘
```

### 4.3 目录/模块划分

| 现状 | 目标 | 动作 |
|---|---|---|
| `electron/context.ts`（根） | `electron/runtime/context.ts` | 移动 |
| `electron/ipc-host.ts`（根） | `electron/runtime/seams/ipc.ts` | 移动 + 接缝化 |
| — | `electron/runtime/host/{app-lifecycle,window,csp,protocols}.ts` | 新增（从 `main.ts` 下沉） |
| — | `electron/runtime/capability-guard.ts` | 新增（P3 白名单） |
| — | `electron/runtime/seams/{fs,dialog,shell,protocol,storage,subprocess}.ts` | 新增 |
| `electron/features/*` | `electron/features/<域>/`（一域一目录） | 逐步：先拆多前缀，再单文件转目录 |
| `electron/composition.json` | 保持（真相源）+ `electron/profiles/*.json` | 扩展 |
| `src/features/*` | 保持 + `src/runtime/{registry.ts,Slot.tsx}` | 新增骨架 |

> ⛔ **需用户拍板**：`ARCHITECTURE-RULES.md` §9 红线 4 —— "不新增域目录、不合并设置域（需用户点头）"。
> 本方案要新增 `electron/runtime/`、`electron/runtime/seams/`、`src/runtime/` 三个**顶层目录**，属红线范围。**方案批准 ≠ 目录批准**，阶段 1 开工前需你单独确认一次。

---

## 5. 插件职责边界

### 5.1 能力接缝表（L1）

| 接缝 | 接口（Definition） | 默认 Provider | 消费方 | 可否替换 |
|---|---|---|---|---|
| `ipc` | `IpcHost { handle, removeHandler }` | `ipcMain` 封装（**已有**） | 所有域插件 | ✅ |
| `fs` | `FsHost { read, write, stat, guardedPath }` | `node:fs/promises` + 可信根校验 | fs / memory / work-logs | ✅ |
| `dialog` | `DialogHost { open, save, message }` | `electron.dialog` | dialog / settings | ✅ |
| `shell` | `ShellHost { openExternal, reveal, trash }` | `electron.shell` + 可信根校验 | shell-misc | ✅ |
| `protocol` | `ProtocolHost { register(scope, handler) }` | **内核窄口径**（只放行白名单根） | pet / harness-image | ❌ 实现固定，仅内核可调 |
| `window` | `WindowHost { create, focus, list }` | `BrowserWindow` 工厂 | popout / pet-window | ✅ |
| `storage` | `StorageHost { get, set, del }` | userData JSON（可换 SQLite） | settings / memory | ✅ |
| `subprocess` | `SubprocessHost { spawn, kill }` | `node:child_process` + 白名单 | codex-server / dev-runtimes | ✅ |

**职责边界铁律**：
1. 域插件**只认接缝类型面**，不许 `from "electron"`（守卫【261】）。
2. `protocol` 与路径校验**不可被 Provider 替换** —— 安全强制面，内核独占。
3. 一个插件的 `inject` 声明即它的权限清单；未声明的服务拿不到（已有 `inject` 门禁）。

### 5.2 域插件清单（L2，79 个）

按**功能语义**分组（不是按当前落点 —— 当前落点正是要拆掉的欠账）：

| 组 | 插件（前缀） | 说明 |
|---|---|---|
| **引擎与会话** | codex · thread-runtime · threads · runtime · engine · bridge · relay · remote · laya | 引擎进程、会话、rollout、桥接 |
| **IM 通道（按平台拆）** | weixin · telegram · feishu · dingtalk · qq · wecom-webhook · ponytail · channels | 每平台一个插件，**共享 `im-gateway` 接缝** |
| **机器人** | bot · bots · bot-binding · bot-stream · channel-bot | ⚠️ 见下方"前缀归一化" |
| **团队与调度** | teams · agents · subagents · commands · team-threads · team-runs | 专家团 / 子智能体 / 调度 |
| **记忆** | memory · rpa · tasks · scheduler | 记忆金字塔 / 定时任务 |
| **技能与插件市场** | skills · skill-discipline · builtin · plugins · plugin · tools · hooks | 技能包 / 插件市场 / 内置能力 |
| **模型** | openai · custom-model · model-specs | 账号 / 自定义模型 / 规格 |
| **连接器** | connectors · mcp-servers · prompt | OAuth / MCP / 提示词增强 |
| **设置与个性化** | appSettings · personalization · terminal · browser · git · ssh · pasted-text · scratch | 每块一个插件 |
| **媒体** | voice · video · laya · screenshot · favorites | 语音 / 视频 / 生成 |
| **壳族** | app · dialog · fs · shell · notify · awake · external · window · theme · dataDir | 基础设施，**部分属内核不可替换** |
| **其它** | user · capabilities · history · work-logs · updates · clipboard · phone · queue-timer · pet · drama-canvas · expert-market · soul-market | 已有 13 个插件化的在此列 |
| **仍在 main.ts** | theme · window | 已证不可搬（壳），保持内核 |

> ⚠️ **前缀归一化问题（需要你决策，方案不擅自做）**：`bot` / `bots` / `bot-binding` / `bot-stream` / `channel-bot` 这 5 个前缀从语义看是**同一个"机器人"域的不同命名**（单复数 + 子面），不是 5 个独立功能。
> 按 `ARCHITECTURE-RULES.md` 规则 2「`<域>:<动作>` 一个域多动作不加新前缀」，正确形态应是 **`bot` 一个域**。
> 但归一化要**改通道名** = 动对外契约（manifest / preload / 渲染层调用点）。
> - **方案 A（保守）**：按现有 5 个前缀拆成 5 个插件 —— 满足机械判据，但制造 5 个语义碎片。
> - **方案 B（推荐）**：合并成 `bot` 一个域，通道名改 `bot:*`，同轮同步 manifest + preload + 渲染层。
> **我的判断：选 B**，但它是契约变更，需你点头后才动。

---

## 6. 分阶段迁移

原则：**一批一提交、每批 `npm run check` 绿、零行为变化**（沿用 `AGENTS.md` 拆分期纪律 1–5）。

### 阶段 0：清欠账 + 立防复发守卫（**硬前置**）

| 项 | 内容 |
|---|---|
| 做什么 | 把 10 处多前缀板块（56 前缀）拆成一板块一前缀；拆完从守卫【253】⑥ 名单删行（棘轮：只许缩不许长） |
| 为什么先做 | 一个插件必须只有一个身份。多前缀板块无法在组合表登记 |
| 验收 | 【253】⑥ 名单清空且 `multiPrefix` 为空；`npm run check` 绿；构建产物可加载 |
| 附带 | 新增**巨型文件棘轮守卫**：全仓 >1000 行文件只许缩不许长（当前 12 个，其中 7 个是守卫脚本，`07-turn-fold.mjs` 4,815 行最大） |
| 状态 | **进行中**（本方案前一轮已开始，拆分依据已实测：56 前缀 / 234 通道） |

### 阶段 1：内核瘦身

| 项 | 内容 |
|---|---|
| 做什么 | `main.ts` 1,215 → 目标 <500 行：启动链 + 34 个模块级单例下沉到 `runtime/host/*`；只留 app 生命周期 + 组合表挂载 + 安全策略 |
| ⛔ 不动 | `theme` / `window` 两个 handler（已证不可搬）；`app.setPath("userData")` 时序 |
| 验收 | 新增【260】内核纯洁性：`runtime/` 不许 import `features/`；`features/` 不许 import 组合层（防成环启动崩） |
| 回滚 | 单提交可 revert |

### 阶段 2：能力接缝化 + 门禁（P3）

| 项 | 内容 |
|---|---|
| 做什么 | `ipc` 接缝化（已有）→ 补 `fs` / `dialog` / `shell` / `window` / `storage` / `subprocess`；建 `capability-guard.ts` 白名单 |
| 硬判据 | 域插件内**零** `from "electron"`（守卫【261】）；每个 seam 有接口定义 + ≥1 实现（【262】） |
| ⛔ 不动 | `protocol` 与路径校验 —— 内核独占，不可替换 |
| 验收 | 守卫【261】【262】绿 + `npm run e2e`（一次性 profile，不碰用户数据） |

### 阶段 3：域全量插件化（66 个）

| 项 | 内容 |
|---|---|
| 做什么 | 66 个裸 `ipcMain.handle` 域 → `defineFeature` 形态，进组合表 |
| 效率要求 | P2 批次 1–8 迁 13 个用了 8 批；剩 66 个**不能按同样节奏**（≈40 批）。必须先写**形态转换脚本**（批量包装 + 逐批 check），否则不可行 |
| ⛔ 同轮必做 | 所有按 `ipcMain.handle` 字面量收集 handler 的守卫（`01-build-ipc-css` 死链 /【90】/【187】）**必须同轮加 `ipcHost.handle` 形态**，否则假红 —— `ARCHITECTURE-RULES.md` §8 已明列此边界 |
| 验收 | 每批 check 绿 + 构建 + 启动冒烟 |

### 阶段 4：组合层升级（profile / bundle / patch）

| 项 | 内容 |
|---|---|
| 做什么 | `composition.json` 之上加 `profiles/*.json`；实现分层叠加（profile → bundle → patch）；加 `dump-config` 输出实际插件树 |
| 首个 profile | `default`（全量）/ `minimal`（只挂 shell + 会话，对标 dsh minimal 模式） |
| 验收 | 【263】profile 可解析 + `dump-config` 输出与合成结果一致 |

### 阶段 5：渲染层插件运行时（**试点，不全量**）

| 项 | 内容 |
|---|---|
| 做什么 | 建 `src/runtime/registry.ts` + `Slot.tsx`；**只在设置页试点**（复用已落地的 `settingsPagesOf` 注册表） |
| 明确不做 | 不动 `app-state`（17,608 行，是拆骨成果不是欠账）；不动 `drama-canvas` 内部结构 |
| 验收 | 设置页经注册表渲染，行为与现版本逐项一致 |

### 阶段 6：运行时装卸 + 生态

| 项 | 内容 |
|---|---|
| 做什么 | 补 `dispose()` 的用户入口（设置 → 插件）；插件市场接入 |
| 硬判据 | 【264】插件可逆性：**真跑** `dist-electron/context.js` —— 挂载后 `dispose()` ⇒ 该插件注册的全部通道清零（不许残留） |
| 风险 | 运行时卸域可能让已开窗口的功能失效 ⇒ 首版只做"重启后生效"的开关，不做真热插拔 |

---

## 7. 验证方式

| 层 | 手段 | 现状 |
|---|---|---|
| 静态 | `npm run check`（**2,991** 条断言，`EXPECTED_CHECKS`） | 已有，全绿为闸门 |
| 内核 | 守卫【252】**真跑产物** `dist-electron/context.js` 验依赖门禁 / 作用域 / 释放语义 | 已有 |
| 契约 | 守卫【2】`manifest → preload / vite-env` 逐字节一致 | 已有 |
| 构建 | `npm run build` + 产物新鲜度校验 | 已有 |
| UI | `npm run e2e`（CDP，**一次性 profile**，不碰用户真实数据） | 已有 |
| 新增 | 【260】内核纯洁 ·【261】零宿主 import ·【262】接缝契约 ·【263】profile 一致 ·【264】插件可逆 ·【265】巨型文件棘轮 | 本方案新增 |

> ⛔ 跑 `npm run check` 前必须 `unset NODE_OPTIONS`（宿主经它注入 node 垫片 ⇒ `spawnSync` 被拒 ⇒ 假红约 19 条且 `&&` 链提前中断，曾导致 3 个真缺陷漏检并进发布包）。

---

## 8. 风险与明确不做的事

| 风险 | 实证依据 | 处置 |
|---|---|---|
| **`features` ↔ `main.ts` 双向依赖不可拆** | `ARCHITECTURE-RULES.md` §8：**搬迁方案已实测证否**。103 符号里 23 个是 `app.getPath("userData")` 路径常量，搬走被【91】拦（路径静默漂移）；惰性化代价 = **387 处调用点**（`codexHome` 一个 170 处 / 跨 36 文件） | **不做**。保留 `runtime-refs` 活绑定 + "只在 handler 体内取用"纪律 |
| **改形态会让旧守卫假红** | §8：所有按 `ipcMain.handle` 字面量收集 handler 的守卫必须同轮加 `ipcHost.handle` 形态 | 阶段 3 每批同轮处理 |
| **【90】通道数断言是下界** | §8 实测：抓不到"同前缀改名"（改名只被 preload 死链检测） | 保持现状；改名类变更额外跑死链守卫 |
| **66 域改造量** | 8 批迁 13 个 | 必须先写转换脚本，否则不可行 |
| **渲染层 44,654 行** | `registry` / `Slot` 未落地 | **只做骨架 + 设置页试点**，明确不全量改造 |
| **安全边界** | CSP / 协议白名单 / 路径校验的三次实证事故 | **一律不动**，内核独占 |

**明确不做**：
1. 不改行为语义 / 权限边界 / 可见交互（红线 §9-1，曾擅自收紧 `fs:write` 被回退）。
2. 不搬 `app` 生命周期 / 窗口 / preload / CSP / 协议（§4.1）。
3. 不为了"像 dsh"而引入 `isolate` / `intercept` / volatile schema —— `context.ts` 头部注释已论证：那是给"多 realm 服务复用 + 热配置"用的，本项目域没有这个需求，搬来只增加概念面与守卫成本。
4. 不新增顶层目录（需你单独点头，见 §4.3）。

---

## 9. 与现有纪律的兼容

| 现有纪律 | 本方案如何遵守 |
|---|---|
| **一个板块恒等于一个域前缀**（三前缀同源） | 阶段 0 直接就是这条的收口；插件 `id` == 域前缀 == 目录名 == CSS 前缀，与 `defineFeature.id` 逐字一致（【253】⑤ 已钉） |
| **IPC 桥安全边界**（manifest 单一真相源 → `gen:ipc`，禁手改生成物） | **不动**。插件化只改"谁注册通道"，不改"通道怎么暴露"；阶段 5 的渲染层改造不碰 preload 生成链路 |
| **不破坏现有功能** | 全程零行为变化：通道名 / 参数 / 返回值一字不动（阶段 5 若选方案 B 归一化前缀是唯一例外，需你点头） |
| **域绝不许 import 组合层** | 【260】固化为内核纯洁性断言（10-03 实测事故：反向 import = 成环 = 启动即崩） |
| **改了就要留判据** | 每个阶段配守卫编号（【260】–【265】），同轮同步 `AGENTS.md` 与本文的实测数字 |
| **一批一提交、每批 check 绿** | §6 每阶段独立提交 |

---

## 10. 需要你拍板的三件事

1. **顶层目录**：是否批准新增 `electron/runtime/`、`electron/runtime/seams/`、`src/runtime/`（红线 §9-4 要求你点头）。
2. **前缀归一化**：`bot` 系 5 前缀是拆成 5 个插件（保守）还是合并成 `bot` 一个域（推荐，但要改通道名契约）。
3. **阶段 5 范围**：渲染层插件化是只做骨架 + 设置页试点（推荐），还是全量推进（`app-state` 17,608 行 / `drama-canvas` 4,593 行一并改造）。
