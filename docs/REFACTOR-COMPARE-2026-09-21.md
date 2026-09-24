# 架构对比清单：现状 vs 改造后（2026-09-21）

> **配套**：`docs/archive/REFACTOR-PLAN-2026-09-21.md`（怎么改：6 批清单 + 注意事项）。
> **本文回答**：现在长什么样 → 改完长什么样 → **值不值**（利弊）。
> **所有数字都是本机实测**（扫的都是 `HEAD` 工作区真实文件，非估算）。

---

## 0. 一页结论

| 维度 | 现状 | 改造后目标 |
|---|---|---|
| 代码怎么读 | 两个巨石（`App.tsx` 22,216 行 / `main.ts` 8,971 行），**改一个功能要在两万行里跳** | 12–16 个域目录，**改一个功能 diff 落在一个目录里** |
| 接口在哪 | 靠 grep；同名符号几十处，只能读上下文猜 | `ipc-registry.ts` 一张 channel→模块表；`features/<域>/index.ts` 就是公开面 |
| 改 A 会不会伤 B | 靠自觉：**502 个 state 全挂在同一个组件上**，任何一处 `set` 都可能破坏另一处的前提 | 靠机器：域内独占状态 + 跨域只许走 index（预检守卫） |
| 新功能往哪放 | 加进 `App.tsx` / `main.ts`（只会更肿） | 新建 `features/<域>/`，自带组件+状态+样式 |
| 怎么防止退回原样 | 无机制 | 巨石行数上限 + 预检读取次数上限（**只许降**） |
| 文件数 | `App.tsx` 1 个装 204 个块；`main.ts` 1 个装 313 个 handler | 域目录若干；两个巨石只剩壳 |

**一句话**：现状不是"乱"，而是**两个枢纽从没被切开**——除它俩之外，全仓最大 fan-in 只有 4，叶子模块早就解耦干净了。

---

## 1. 六个可量化维度（实测 → 目标 → 判据）

| # | 指标 | 现状实测 | 目标 | 机器判据 |
|---|---|---|---|---|
| 1 | `src/App.tsx` 行数 | **22,216** | < 800 | 预检阈值，**只许降** |
| 2 | ↳ 其中 App 组件本体 | **14,167 行（64%）**（L8050–L22216） | < 600 | 同名 |
| 3 | ↳ 模块级具名块 | **204 个**（最大的 `RelayCenterPage` 693 行） | 搬空 | 行数下降 |
| 4 | `useState` / `useEffect` | **502 / 201**（其中 **357 / 136 在 App 体内**） | 收进域 hook，App 只剩跨域编排 | 域外 `set` 数 = 0 |
| 5 | `electron/main.ts` | **8,971 行 / 313 个 handler / 66 个域** | < 1,200 / handler 0 | 同名 |
| 6 | 预检对两巨石的直接读取 | **69 处读 `App.tsx`、40 处读 `main.ts`**（53 / 30 个变量名） | 0 | 计数只许降 |
| 7 | `src/styles.css` | **25,454 行 / 58 个注释分节** | `src/styles/<域>.css`，入口 `@import` | 选择器文本零改动 |

> 第 7 行的"58 分节"是本次用宽松规则重数的（`/* ──`）；立项文档里写的 44 是更窄的模式数出的，**以 58 为准**。

---

## 2. 域级一一对应表（现状坐标 → 目标落点）

`IPC` = 该域在 `main.ts` 里的 `ipcMain.handle` 数量。
**"跨度"= 该域首个 handler 行 → 末个 handler 行**，超过自身行数就说明**该域被别的域插花打断**。

| 域 | IPC | 现在在 `main.ts` 的哪一段 | 跨度 | 前端现状块 | 目标落点 | 批 |
|---|---|---|---|---|---|---|
| 中转站 `relay` | 14 | L4766 – L5335 | 570 | `RelayCenterPage`(693) `RelayBalanceBadge`(66) +1 | `src/features/relay/` + `electron/features/relay.ts` | **1** |
| 订阅 `openai` | 12 | L4997 – L5325 | 329 | `OpenaiSubscriptionPage`(332) `OpenaiOfficialCard`(84) `OpenaiBalanceBadge`(56) | `features/openai/` | 1 |
| 语音 `voice` | 39 | L1028 – L1434 | 407 | `VoiceMascot`/`VoiceCallScreen`…（已在 `components/`）+ 桥接块 | `features/voice/` | 1 |
| 记忆 `memory` | 17 | L8867 – L8913 | 47 | `MemoryFunnel`(97) `MemoryLayersEditor`(73) `MemoryConfigModal`(35) | `features/memory/` | 1 |
| 调度 `dispatch` | 会话级 | — | — | `DispatchMenu`(157) `DispatchBadge`(8) | `features/dispatch/` | 1 |
| 渠道 `weixin`/`feishu`/`qq`/`bot` | 5+5+5+7 | L3643–L3670、L3923–L3955、L3927–L3942、L5505–L5525 | 交叉 | `BotBindCard`(346) | `features/channels/` | 1 |
| `ssh` / `remote` | 12 / 11 | L7152–L7217 / L5487–L5513 | 66 / 27 | `SshTerminalModal`(107) `SshExecModal`(47) | `features/ssh/`、`features/remote/` | 1 |
| 专家/团/子智能体 `agents`/`teams`/`subagents` | 9+9+4 | **L583 – L8296** | **7,714** | `ExpertTeamEditorModal`(84) 等 9 块 / 354 行 | `features/agents/` | 4 |
| 模型 `custom-model` + `model-specs` | 12+ | L8540 – L8838 | 299 | 设置页内 | `features/models/` | 4 |
| 扩展 `skills`/`plugins`/`connectors`/`mcp-servers`/`builtin` | 8+4+6+4+5 | L6310–L7073（**五个域互相插花**） | 交叉 | 技能市场页 | `features/extensions/` | 4 |
| 自动化 `scheduler`/`tasks`/`rpa` | 12 | — | — | RPA 设置页（CSS L21766） | `features/automation/` | 4 |
| 会话/回合 `threads`/`thread-runtime`/`codex`/`engine` | 5+6+… | L535–L571、L7234–L7313 | 交叉 | **13 块 / 1,294 行**（`TurnView`/`ItemView`/`MessageRuler`…） | `features/threads/` | **最晚**（钉顶/滚动/锚点，风险最高） |
| 壳族 `app`/`window`/`dialog`/`clipboard`/`fs`/`theme`/`notify`/`updates` | 8+4+5+4+… | 散落 L4116–L8517 | 交叉 | — | **留在 `electron/` 顶层**（属基础设施） | — |

**关键读法**：
- `agents` 域的首个 handler 在 **L583**、末个在 **L8296** → **7,714 行**的范围内都有它的代码。想改专家调度，你没法"打开专家那一段"——它根本没有"一段"。
- `relay`(L4766–L5335) 与 `openai`(L4997–L5325) **两段几乎完全重叠**：改中转站会在途中反复穿过订阅的代码。
- 扩展族五个域在 L6310–L7073 里**互相插花**，`dialog`(L6264–L7354) 又横跨整段。

---

## 3. 「改一个域，现在要碰多少处」——最有说服力的对比

实测扫描（按域关键词统计散落点）：

| 域 | 现在碰几个文件 | 现在碰几处 | `App.tsx` 里首→末 | 改完后 |
|---|---|---|---|---|
| **中转站** | **7** | **255** | **L312 → L20948** | `features/relay/`（1 目录）+ `preload.ts`/`vite-env.d.ts` 各 1 行 |
| 订阅 | 4 | 197 | L315 → L20733 | `features/openai/` |
| 语音 | 5 | 256 | L507 → L22211 | `features/voice/` |

> `App.tsx` 首末跨度 2 万行 = **改中转站这件事，要在同一个文件里从第 312 行跳到第 20948 行**。这就是你说的"找不到接口 / 怕误伤"的物理形态。

**改造后仍会存在的耦合（不装门面）**：IPC 三件套（`handler` ↔ `preload.ts` ↔ `vite-env.d.ts`）必须同轮改，这部分**拆不掉**，只能收敛：handler 搬进 `features/relay.ts` 后，`main.ts` 里只剩一行注册调用。→ 从"7 个文件 255 处"降到"**1 个目录 + 2 行声明**"。

---

## 4. 文件树：Before / After

### Before（现在）

```
src/
  App.tsx             22,216 行  ← 204 个块 + 502 useState + 2 个贴在行首的内部函数
  styles.css          25,454 行  ← 58 个注释分节混在一起
  lib/                75 个文件  ✅ 已模块化（27 个 .mjs 纯函数 + 27 个配套 .d.mts + 21 个 .ts）
  components/         36 个文件  ✅ 已模块化（34 .tsx 通用件 + 1 .ts + 1 .txt）
  hooks/              5 个       ✅ 已模块化（跨域通用 hook）
electron/
  main.ts             8,971 行   ← 313 handler / 66 域 / 互相插花
  （其余）            57 个文件  ✅ 已模块化（55 .ts 引擎/桥/存储/策略 + 1 .cjs + 1 .json）
scripts/check-preflight.mjs  7,674 行（69 处读 App.tsx、40 处读 main.ts）
```

### After（目标）

```
src/
  main.tsx                 引导（挂载 + Provider）
  App.tsx                  < 800 行：路由 + 布局骨架 + Provider 组合
  features/                ★ 每个域自带 组件 + 状态 + 样式 + 类型
    relay/    index.ts  RelayCenterPage.tsx  useRelayAccounts.ts  relay.css
    openai/   voice/  memory/  dispatch/  channels/  agents/  models/
    extensions/  ssh/  remote/  automation/  threads/
  lib/                      ✅ 保持（纯函数，无 React 依赖）
  components/               ✅ 保持（跨域通用件）
  hooks/                    ✅ 保持
  styles/                   ★ index.css @import 各域 css
electron/
  main.ts                  < 1,200 行：启动链 + 窗口 + 各域注册调用
  ipc-registry.ts          ★ channel → handler → 模块（"接口在哪"查表）
  features/                ★ 按域拆：relay.ts / openai.ts / voice.ts / memory.ts …
  *.ts                     ✅ 保持（基础设施）
```

---

## 5. 利弊清单 ★

### 5.1 利（每一条都能验收，不是感觉）

| 收益 | 判据 | 对应你的痛点 |
|---|---|---|
| 改一个域的 diff **落在一个目录** | `git diff --stat` 只有一个 `features/<域>/` 路径 | 怕误伤 |
| 接口**可查可跳转** | IDE"查找引用"跨文件才可靠；同文件重名只给噪声 | 找不到接口 |
| 新功能**有明确落点** | 新建 `features/<新域>/`，不问任何人 | 好拓展 |
| 巨石**只许缩不许涨** | 预检阈值（行数 + 读取次数上限） | 防止退回 |
| 预检从"读源码正则"升级为"跑真函数" | 断言质量提升（搬家时被迫整理的副产品） | 长期可信 |
| 域边界**已经是现成的** | IPC 通道天然带 `域:` 前缀 ⇒ 不用设计，直接照抄 | 成本低 |
| 已有一半基础 | `src/lib/` 75 个文件、`electron/` 57 个、`src/components/` 36 个、`src/hooks/` 5 个已模块化，习惯现成 | 风险低 |

### 5.2 弊 / 代价（必须先认，认可了才值得做）

| 代价 | 量化 | 怎么缓解 |
|---|---|---|
| **预检断言要跟着搬** | **69 + 40 = 109 处**直接读两个巨石的断言，搬一块就要改一组（本轮审查发现初稿误记为 61/39，已按实测更正） | 一次只搬一块、一次只改一组；**禁止批量替换路径** |
| **单个改动可能跨 2–3 个文件** | 以前一个文件从头改到尾，现在要开多个 | 域目录内聚（组件+状态+样式同目录）抵掉大部分 |
| **IPC 三件套拆不掉** | `handler`/`preload`/`vite-env` 313×3 必须同轮同步（预检 69 处守卫） | `ipc-registry` 收敛成一行注册；三件套同批提交 |
| **过程中会出现"双重结构"** | 拆到一半时新旧并存（既有 `App.tsx` 里的，也有 `features/` 里的） | 每批完成即 `check` 绿 + 提交，最多半成品一天 |
| **第 3 批（状态收拢）会碰用户可见行为** | 502 个 state 换持有者，更新时机可能变 | 排在护栏之后；**每域一次提交 + 每域跑 e2e** |
| **有返工风险** | 搬完才发现某块 props 要加 5 个以上 ⇒ 白搬 | 判据前置：**props 新增 > 5 个就回退**，等状态抽完再搬 |
| **学习成本转给协作者** | 别人要先读架构文档才知道去哪找 | 第 0 批就产出 `docs/ARCHITECTURE.md` + `ipc-registry` 表 |
| **工时** | 1–2 批低风险、可增量；3–4 批是真正的大活 | 不设"重构分支"、不设工期承诺，按批交付价值 |

### 5.3 不做的代价（这是决定要不要做的另一半）

| 不做会怎样 | 现在已经在发生的证据 |
|---|---|
| 每次改功能都要在两万行里定位 | 改中转站要跨 L312→L20948 |
| 新功能继续往两个巨石里塞 | `App.tsx` 22,216 行 / 502 个 state；`main.ts` 313 handler |
| 多任务/多人并行必然撞车 | 任何两个前端改动都撞在同一个 `App.tsx` 上 |
| 回归定位只能二分整个文件 | 一次改动可能碰 502 个 state 中的任意几个 |
| 大文件继续长 | 无任何阈值守卫 ⇒ 三个月后回到原点 |

---

## 6. 什么情况下**不值得**做

诚实说出边界，免得为重构而重构：

1. **如果只剩你一个人维护、且不打算长期演进** → 收益主要落在"多人/多任务不撞车"和"新人上手"，收益会打折；但"找接口/怕误伤"这两条你自己也会一直付。
2. **如果近期要赶发版** → 第 1 批可以做（低风险、纯搬家），**第 3、4 批必须等发版后**。
3. **如果只是想要"看着清爽"** → 只做第 1 批 + 第 5 批（CSS 拆节）就能观感大改，成本极低。真正的痛点（防误伤、找接口）价值在第 3、4 批。

---

## 7. 需要你拍板的三个决策点

| # | 决策 | 选项 | 我的建议 |
|---|---|---|---|
| 1 | 是否启动第 1 批（搬 `RelayCenterPage` 到 `features/relay/`） | 现在做 / 等发版后 | **现在做**：零行为改动、props 只有 6 个、刚被我改过上下文最新 |
| 2 | 第 3 批（状态收拢，唯一会碰可见行为的一步）是否授权 | 授权 / 暂不 | **先看第 1 批效果再定**，不要现在承诺 |
| 3 | 是否装代码图谱（GitNexus MCP） | 装 / 不装 | 不装也能做（本轮所有数据均为脚本实测）；要装我先走安全审计 |

---

## 8. 验收口径（每批共用）

1. `npm run check` **EXIT=0**（改渲染层时补跑相关 `accept --only <id>`）；
2. 目标指标**单向变化**：`App.tsx`/`main.ts` 行数下降、预检读取次数下降；
3. 被搬组件的 **props 数量不增**（> 5 个新增 = 回退）；
4. `git diff --stat` 只落在预期路径；
5. code review 审**本批 diff**；一批一次提交，提交信息写清"搬了什么 + 断言迁移哪几处"。
