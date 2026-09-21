# 架构改造清单（2026-09-21）

> 目标：把「两个巨石 + 一切都在一个文件里」变成**按域切分的模块树**，做到
> ① 改功能 A 不碰功能 B；② 新功能有明确的落点；③ 别人接手时能靠一张表找到接口。
>
> 本文是**清单 + 注意事项**，不是实现记录。每一批都必须独立通过 `npm run check`。

---

## 0. 先给结论（含代价，别只看好处）

**能做，而且这个项目的条件比一般项目好**：已经有 `src/lib/*.mjs`（75 个文件）、`electron/*.ts`（58 个）、`src/components/*.tsx`（36 个）三块现成的模块习惯，IPC 通道又天然带 `域:` 前缀 —— **域边界是现成的，只是没被用来切文件**。

**但有三个必须先接受的事实**：

1. **拆分不能"一次性重写"**。必须一批一批搬，每批 `check` 绿 + 单独提交。任何"重构分支"最后都会以冲突爆炸收场。
2. **有些成本是拆不掉、只能转移的**：预检里有 **61 处直接读取 `src/App.tsx`、39 处直接读取 `electron/main.ts`** 的断言，它们写的是"这段代码必须出现在这个文件里"。搬家时这些断言必须同轮改到新路径 —— 这是本轮最大的隐性工作量，**不迁断言 = 预检直接红**。
3. **拆完不会自动"更清爽"，只有按"变更耦合"切才会**。反例见 §7。

---

## 1. 事实基线（本次扫描实测，作为验收基准）

| 对象 | 体量 | 关键指标 |
|---|---|---|
| `src/App.tsx` | **22,216 行** | 顶层声明 209 个；`useState` ≈ **494–502**；**导入 79 个文件**；被导入仅 1 次 |
| `electron/main.ts` | **8,971 行** | **`ipcMain.handle` 313 个**；跨 **66 个前缀域**；导入 55 个文件 |
| `src/styles.css` | **25,454 行** | 已有 **44 个注释分节**（等于半份现成的拆分方案） |
| `scripts/check-preflight.mjs` | 7,674 行 | 直接读 `App.tsx` 61 次、`main.ts` 39 次、`styles.css` 24 次、`src/components` 23 次、`src/lib` 14 次 |
| `src/vite-env.d.ts` / `electron/preload.ts` | 711 / 457 行 | IPC 三件套的另外两件（方案 313 × 3 必须同步） |
| `scripts/accept.mjs` | 1,349 行 | e2e 验收项（依赖 DOM 选择器） |

**结构诊断**：`App.tsx` 的 fan-out = 79、fan-in = 1 —— 它是**只进不出的上帝模块**：所有东西都堆在它里面，它却不被任何人复用。`main.ts` 同理（fan-out 55）。而除它俩之外，**全仓最大 fan-in 只有 4** —— 说明叶子模块早就解耦干净了，**只有两个枢纽没拆**。这就是为什么"改一处怕误伤"的体感全部来自这两个文件。

---

## 2. 目标架构

```
src/
  main.tsx                 # 引导（挂载 + Provider）
  App.tsx                  # 只剩：路由 + 布局骨架 + 全局 Provider 组合（目标 < 800 行）
  features/                # ★ 每个功能域一个目录，自带组件 + 状态 + 样式 + 类型
    relay/                 #   index.ts 只导出公开面（组件 + hook），内部实现文件不 export
      RelayCenterPage.tsx
      useRelayAccounts.ts
      relay.css
    openai/  voice/  memory/  channels/  models/  threads/  automation/  connectors/ ...
  lib/                     # 已存在：纯函数（.mjs + .d.mts），无 React 依赖
  components/              # 已存在：跨域通用件（按钮/头像/折叠/弹窗壳）
  hooks/                   # 已存在：跨域通用 hook
electron/
  main.ts                  # 只剩：启动链 + 窗口 + 各域注册调用（目标 < 1200 行）
  ipc-registry.ts          # ★ 声明式清单：channel → handler → 所属模块（"接口在哪"查表）
  features/                # ★ 按 IPC 域拆：relay.ts / openai.ts / voice.ts / memory.ts ...
  *.ts                     # 已存在：引擎、桥、存储、策略等基础设施
```

### 三条铁律（配套预检守卫，靠机器保证而非自觉）

1. **一份状态只有一个 owner**：`features/x` 的状态由 `features/x` 自己持有；别人要改，只能调它的**公开动作**（hook 返回值），不许直接写。
2. **`features/*` 之间只许通过 `index.ts` 互相引用**：不许 import 别人的内部实现文件。→ 新增预检守卫：跨 feature 的 import 路径必须以 `/index` 结尾。
3. **两个巨石只许缩不许涨**：把当前行数写进预检，作为上限阈值。→ 不设这条，三个月后一定长回来。

---

## 3. 领域地图（IPC 域 → feature 目录，按实测通道数分组）

**P0（高频、体量大、优先拆）**

| 域 | IPC | 前端落点 | 说明 |
|---|---|---|---|
| `voice` | 38 | `features/voice/` | 最大域；已有 `VoiceSettingsSection/VoiceCallScreen/VoiceCallFloat/VoiceMascot/VoiceWaveform` 五个组件，先搬组件再搬 IPC |
| `memory` | 17 | `features/memory/` | 记忆分层（store/layers/history 三套） |
| `relay` | 14 | `features/relay/` | **建议第一个试水**：刚改过、props 最少、已有 `electron/relay-accounts.ts` 纯函数打底 |
| `openai` | 12 | `features/openai/` | 订阅账号 + 额度监控 |
| `model`（`custom-model` 12 + `model-specs`/`provider-*`） | 13 | `features/models/` | 供应商/模型目录/切换链路 |
| `ssh` | 12 | `features/ssh/` | 独立性强，低风险 |
| `remote` | 11 | `features/remote/` | 远控 |
| `agents`/`teams`/`subagents`/`team-runs`/`team-threads` | 24 | `features/agents/` | 专家/专家团/子智能体（三套本来就一套语义） |
| `skills`/`plugins`/`connectors`/`mcp-servers`/`builtin` | 28 | `features/extensions/` | 扩展面（技能市场 / 连接器 / MCP / 内置插件） |
| 渠道族（`weixin`/`feishu`/`qq`/`telegram`/`dingtalk`/`wecom-webhook`/`channel-bot`/`bot*`） | 30 | `features/channels/` | 5 个渠道 + 配对/审批/流式，天然一族 |
| `threads`/`thread-runtime`/`codex`/`engine`/`sessions-*` | 18 | `features/threads/` | 会话与回合（**最高风险域**：钉顶/滚动/锚点都在这，放后面） |
| `scheduler`/`tasks`/`rpa` | 12 | `features/automation/` | 定时/任务/RPA |
| 壳族（`app`/`window`/`dialog`/`clipboard`/`fs`/`theme`/`notify`/`external`/`shell`/`awake`/`updates`） | 31 | 留在 `electron/` 顶层 | 属基础设施，不进 features |

**P1/P2**：`appSettings`、`personalization`、`terminal`、`browser`、`runtime`、`pasted-text`、`commands`、`hooks`、`ponytail`、`skill-discipline`、`capabilities`、`tools`、`user`、`prompt`、`channels` 等单例域 —— 各自 1–6 个通道，**可以合并进相邻域**，不必一对一建目录（目录过多本身就是新的"找不到"）。

> 判据：**域目录数量控制在 12–16 个**。超过 20 个就是切太碎，跨目录跳转成本会吃掉收益。

---

## 4. 分批清单（每批独立可交付）

| 批 | 内容 | 产出判据 | 风险 | 回滚 |
|---|---|---|---|---|
| **0** | 写本文档 + 定域边界 + 落三条铁律的**守卫断言**（先只加"跨 feature 不许 import 内部实现"与"巨石行数上限"两条，此时上限=当前值） | `check` 绿；新增 2–3 条断言出现在输出里 | 零 | 删文件 |
| **1** | **搬子页面组件**：`RelayCenterPage`(693) → `OpenaiSubscriptionPage`(332) → `LoginScreen`(289) → `DispatchMenu`(212) → `BotBindCard`(346) → `HelpDialog`/`UsagePanel`/`PersonalizationPage` 等已在 components 的只需归位 | `App.tsx` 行数下降；**每个组件的 props 数量不变**（今日 RelayCenterPage 只加了 1 个 prop，说明它已自成一体的证据）；对应预检断言改路径 | 低 | `git revert` 单批提交 |
| **2** | **纯逻辑下沉 `src/lib/*.mjs`**：解析/判定/格式化（parse、判定函数、表单换算）。项目已有 75 个，继续按同样规矩：`.mjs` + 同名 `.d.mts`，预检**直接 import 跑真断言** | 新增 .mjs 都有 .d.mts（预检【87】已守）；断言从"读源码正则"升级成"跑函数" | 低 | 单批 revert |
| **3** | **前端状态收拢成域 hook**：把散在 App.tsx 的 state 按域抽成 `useXxx()`，state 数量不变、只是换了持有者；`App.tsx` 开始真正变薄 | 每个域的 state 只在域 hook 内被 `set`；App.tsx 里只剩跨域编排 | **中高**（改的是更新时机） | 每域一次提交，e2e 每域跑一次 |
| **4** | **`electron/main.ts` 按域拆 handler**：先建 `ipc-registry.ts`（channel→handler→模块），再把 handler 体搬进 `electron/features/<域>.ts`，导出 `register<Domain>Handlers(ipcMain, deps)` | `main.ts` 行数下降；`ipc-registry` 表长度 = 313；三件套（handler/preload/vite-env）仍一一对应 | 中（要先定 `deps` 契约） | 每域一次提交 |
| **5** | **CSS 按域拆**：`styles.css` 的 44 个注释分节 → `src/styles/<域>.css`，由一个入口 `@import` 汇总；**选择器一个字都不改** | 视觉零变化（对比截图）；CSS 孤儿类断言仍绿 | 中低 | 单批 revert |
| **6** | **收敛与守门**：把三条铁律的上限调低到新值；补 README/AGENTS 的架构章节；`docs/ARCHITECTURE.md` 从本计划转正 | `check` 绿；文档与守卫一致 | 低 | — |

**顺序不可换**：1→2 是"低风险热身 + 建立肌肉记忆"，3 必须在 1、2 之后（否则没有干净的域边界可依赖），4 与 3 相互独立（可并行推进），5、6 收尾。

---

## 5. 预检断言的迁移策略（本计划最关键的执行细节）

现状：预检 7,674 行、88 个断言块，其中 **61 处读 `App.tsx`、39 处读 `main.ts`**（另有 293 次变量引用、166 次变量引用）。

迁移分三类，**按优先级**：

1. **可变成"跑真函数"的**（纯逻辑类）→ 直接改造成加载 `dist-electron/*.js` / `src/lib/*.mjs` 跑断言（项目已有成熟做法）。**这类应该最多**，也是长期收益最高的。
2. **可变成"按目录/按公开面"断言的**（结构类）→ 例如"每个 feature 必须有 index.ts""跨 feature 只许 import index""域目录内的组件不许直接 import electron 的私有模块"。
3. **必须跟着代码走的**（文案/接线类）→ 搬家时把 `join(ROOT,"src","App.tsx")` 换成新路径；**一次搬一块、一次改一组**，不许批量替换文件路径（会把不该动的断言一起改掉）。

**新增的可量化守卫**（推荐加入）：

```
预检里点名 App.tsx 的直接读取次数：61 → 只许下降
预检里点名 main.ts 的直接读取次数：39 → 只许下降
src/App.tsx 行数上限：22,216 → 只许下降
electron/main.ts 行数上限：8,971 → 只许下降
```

这四条让"拆分"变成**可验证的进程**，而不是一句口号。

---

## 6. 注意事项（踩坑清单，按"最容易翻车"排序）

1. **⛔ 不要按"技术分层"切，要按"变更耦合"切**。把中转站切成 `relay-ui / relay-state / relay-ipc` 三个文件是**反模式**：每次改中转站要同时动三个文件，跨文件成本上去了，状态还是共享的，误伤照旧。
2. **⛔ 搬家不许顺手改行为**。项目纪律（AGENTS.md 第 8 条）：重构不算修复。**DOM 结构、class 名、可见交互一律不动** —— 否则 `accept.mjs` 的 CDP 选择器会成片失败，而且你分不清是搬家搬坏了还是行为改了。
3. **⛔ 一次只搬一块，搬完立刻 `check` + 提交**。两个巨石同时动 = 无法二分定位回归。
4. **⛔ props 数量是"块是否自成一体的"的判据**。搬一个组件时如果发现要新加 5 个以上 prop，说明它和 App 的状态耦合还太深 → **先回退，等第 3 批把状态抽成域 hook 再搬**。
5. **⛔ 状态搬家必须带 owner**。搬 state 时问一句：**这个 state 谁是唯一写入者？** 如果有人从别的地方 `set` 它，先把它变成"域内动作 + 对外只读"，否则就是把误伤换了个地方。
6. **IPC 三件套必须同轮同步**：`main.ts` handler ↔ `preload.ts` 桥接 ↔ `vite-env.d.ts` 声明。预检有 69 处相关守卫，漏一处就红。拆域时建议**三个文件在同一批提交里改**。
7. **CSS 只有 12 处孤儿类守卫，但很敏感**：拆 CSS 时选择器文本一个字都不改，只挪位置；禁止顺手删"看起来没用"的类。
8. **产物新鲜度（28 处提及）**：任何源码移动都必须重新 `npm run build` —— 预检读的是 `dist-electron/*.js` 与 `dist/`，不重建会报"产物已过期"或断言打在旧产物上（假绿）。
9. **别新建 `scripts/e2e/scenarios/`**：预检【7】硬守卫会拦（历史教训：那套东西一轮十几分钟）。
10. **不要开长命重构分支**：用户明确拒绝 fork/新分支绕开，且长命分支 = 冲突爆炸。**每一批都是 main 上的若干次小提交**。
11. **`src/lib/` 已有 75 个文件、`electron/` 58 个**：新增文件前先查有没有现成模块可扩展，**不要造重复**（重复模块是比大文件更糟的债）。
12. **不要在拆分过程中"顺手统一命名/格式化"**：会把 diff 淹没，review 与二分定位全部失效。
13. **域目录数控制在 12–16**（见 §3）。单例域合并进相邻域，别建 66 个目录。

---

## 7. 明确不做的事（反例清单）

- ❌ 把 `App.tsx` 按"行数均分"切成 `AppPart1/2/3.tsx` —— 只是把一个大文件变成三个互相引用的大文件。
- ❌ 引入 Redux/Zustand 之类的全局 store 来"解决"状态分散 —— 在这个项目里是**增加**耦合面（全仓任何文件都能写全局状态），与目标相反。
- ❌ 为了拆而拆 `src/components/`（36 个文件已经够小）。
- ❌ 一次性把 313 个 handler 全部搬走（无法 review、无法回滚）。
- ❌ 改 `docs/`、`README` 之外的行为语义（权限、默认值、可见交互）——属产品决策，先问。

---

## 8. 每批收尾的固定动作

1. `npm run check` 必须 **EXIT=0**（改到渲染层时再跑相关 `accept --only <id>`）；
2. 本文档对应批次打勾 + 记录实际行数变化；
3. code review 审**本批 diff**（项目纪律：每轮收尾固定一环）；
4. 一个批次一次提交，提交信息写清"搬了什么、断言迁移了哪几处"；
5. 更新 AGENTS.md 的架构章节指针（避免下一轮按旧结构找文件）。

---

## 9. 立刻可做的第一步

**第 0 批（本文档）+ 第 1 批的第一块**：把 `RelayCenterPage`（693 行，L4733 起）搬到 `src/features/relay/RelayCenterPage.tsx`，同步迁移预检里点名它的断言。

选它的理由：① 刚改过（上下文最新鲜）；② props 只有 6 个（`busy/activeProvider/onActivate/onNotice/onOpenModelSettings/openAppConfirm`）——**自成一体的证据**；③ 它的 IPC 面（14 个 `relay:*`）已经有一个纯函数模块 `electron/relay-accounts.ts` 打底，第 4 批时能直接复用。

完成标准：`App.tsx` 行数下降 ≥600；`check` 绿；`RelayCenterPage` 的 props 数量不变。
