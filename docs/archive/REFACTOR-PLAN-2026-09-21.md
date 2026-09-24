# 架构改造清单（2026-09-21）

> 目标：把「两个巨石 + 一切都在一个文件里」变成**按域切分的模块树**，做到
> ① 改功能 A 不碰功能 B；② 新功能有明确的落点；③ 别人接手时能靠一张表找到接口。
>
> 本文是**清单 + 注意事项**，不是实现记录。每一批都必须独立通过 `npm run check`。

---

## 0. 先给结论（含代价，别只看好处）

**能做，而且这个项目的条件比一般项目好**：已经有 `src/lib/`（75 个文件：27 个 `.mjs` 纯函数 + 27 个配套 `.d.mts` + 21 个 `.ts`）、`electron/`（57 个：55 `.ts` + 1 `.cjs` + 1 `.json`）、`src/components/`（36 个：34 `.tsx` + 1 `.ts` + 1 `.txt`）、`src/hooks/`（5 个）四块现成的模块习惯，IPC 通道又天然带 `域:` 前缀 —— **域边界是现成的，只是没被用来切文件**。

**但有三个必须先接受的事实**：

1. **拆分不能"一次性重写"**。必须一批一批搬，每批 `check` 绿 + 单独提交。任何"重构分支"最后都会以冲突爆炸收场。
2. **有些成本是拆不掉、只能转移的**：预检里有 **69 处直接读取 `src/App.tsx`、40 处直接读取 `electron/main.ts`** 的断言（实测，见 §1），它们写的是"这段代码必须出现在这个文件里"。搬家时这些断言必须同轮改到新路径 —— 这是本轮最大的隐性工作量，**不迁断言 = 预检直接红**。
3. **拆完不会自动"更清爽"，只有按"变更耦合"切才会**。反例见 §7。

---

## 1. 事实基线（本次扫描实测，作为验收基准）

| 对象 | 体量 | 关键指标 |
|---|---|---|
| `src/App.tsx` | **22,216 行** | 顶层声明 209 个；`useState` ≈ **494–502**；**导入 79 个文件**；被导入仅 1 次 |
| `electron/main.ts` | **8,971 行** | **`ipcMain.handle` 313 个**；跨 **66 个前缀域**；导入 55 个文件 |
| `src/styles.css` | **25,454 行** | 已有 **58 个注释分节**（等于半份现成的拆分方案） |
| `scripts/check-preflight.mjs` | 7,674 行 | 直接读 `App.tsx` **69 次**（53 个变量名）、`main.ts` **40 次**（30 个变量名）、`styles.css` 27 次、`src/components` 24 次、`src/lib` 20 次 —— 按 `join(ROOT,…)` 精确计数、容忍换行 |
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
| **2** | **纯逻辑下沉 `src/lib/*.mjs`**：解析/判定/格式化（parse、判定函数、表单换算）。项目已有 27 个 `.mjs`，继续按同样规矩：`.mjs` + 同名 `.d.mts`，预检**直接 import 跑真断言** | 新增 .mjs 都有 .d.mts（预检【87】已守）；断言从"读源码正则"升级成"跑函数" | 低 | 单批 revert |
| **3** | **前端状态收拢成域 hook**：把散在 App.tsx 的 state 按域抽成 `useXxx()`，state 数量不变、只是换了持有者；`App.tsx` 开始真正变薄 | 每个域的 state 只在域 hook 内被 `set`；App.tsx 里只剩跨域编排 | **中高**（改的是更新时机） | 每域一次提交，e2e 每域跑一次 |
| **4** | **`electron/main.ts` 按域拆 handler**：先建 `ipc-registry.ts`（channel→handler→模块），再把 handler 体搬进 `electron/features/<域>.ts`，导出 `register<Domain>Handlers(ipcMain, deps)` | `main.ts` 行数下降；`ipc-registry` 表长度 = 313；三件套（handler/preload/vite-env）仍一一对应 | 中（要先定 `deps` 契约） | 每域一次提交 |
| **5** | **CSS 按域拆**：`styles.css` 的 58 个注释分节 → `src/styles/<域>.css`，由一个入口 `@import` 汇总；**选择器一个字都不改** | 视觉零变化（对比截图）；CSS 孤儿类断言仍绿 | 中低 | 单批 revert |
| **6** | **收敛与守门**：把三条铁律的上限调低到新值；补 README/AGENTS 的架构章节；`docs/ARCHITECTURE.md` 从本计划转正 | `check` 绿；文档与守卫一致 | 低 | — |

**顺序不可换**：1→2 是"低风险热身 + 建立肌肉记忆"，3 必须在 1、2 之后（否则没有干净的域边界可依赖），4 与 3 相互独立（可并行推进），5、6 收尾。

---

## 5. 预检断言的迁移策略（本计划最关键的执行细节）

现状：预检 7,674 行、88 个断言块，其中 **69 处读 `App.tsx`、40 处读 `main.ts`**（另有 306 / 166 处变量引用）。

迁移分三类，**按优先级**：

1. **可变成"跑真函数"的**（纯逻辑类）→ 直接改造成加载 `dist-electron/*.js` / `src/lib/*.mjs` 跑断言（项目已有成熟做法）。**这类应该最多**，也是长期收益最高的。
2. **可变成"按目录/按公开面"断言的**（结构类）→ 例如"每个 feature 必须有 index.ts""跨 feature 只许 import index""域目录内的组件不许直接 import electron 的私有模块"。
3. **必须跟着代码走的**（文案/接线类）→ 搬家时把 `join(ROOT,"src","App.tsx")` 换成新路径；**一次搬一块、一次改一组**，不许批量替换文件路径（会把不该动的断言一起改掉）。

**新增的可量化守卫**（推荐加入）：

```
预检里点名 App.tsx 的直接读取次数：69 → 只许下降
预检里点名 main.ts 的直接读取次数：40 → 只许下降
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
11. **`src/lib/` 已有 75 个文件（其中 27 个 `.mjs`）、`electron/` 57 个**：新增文件前先查有没有现成模块可扩展，**不要造重复**（重复模块是比大文件更糟的债）。
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

---

## 10. 已完成批次记录（实测行数，口径 `git show <sha>:<file> | wc -l`）

> §1 那些数字是**改造前基线**；**当前值看本节**。§5 的「行数上限只许下降」在这里兑现。

| 对象 | 改造前 | 现在 | 备注 |
|---|---|---|---|
| `src/App.tsx` | 22,216 | **2,543** | 外层已无独立声明可搬：`App()` 体 = 193 行解构 + **1 条 1,841 行 JSX return** ⇒ 再切必须新造组件边界 + 传 751 个名字，且会碰 502 个 `useState`，**需用户确认** |
| `electron/main.ts` | 8,971 | **1,975** | 按域拆出的 handler 已落 `electron/features/*.ts`（09-22 再搬出 `dialog` 5 条 / `clipboard` 4 条 → `features/dialog-ipc.ts` + `features/clipboard-ipc.ts`）；主文件仅余 `shell` 域壳族（有意保留） |
| `src/features/app-state/useHarnessApp.tsx` | 11,191 | **373** | 组合根；逻辑切进 `parts/`（9 个 part，均已变成「组合根 + 子 hook 目录」两层结构）+ `types.ts` + 自动生成的 `bag-types.ts`（1,348 项） |
| `src/features/app-view/helpers.tsx` | 1,636 | **209** | 变 barrel（86 个符号原样 re-export）⇒ 12 个既有 import 点零改动；内容已切进 `helpers/` 9 个模块 |
| `src/styles.css` | 25,454 | **31** | 入口 31 行 + `src/styles/` 19 个分节文件 |
| `src/features/app-state/parts/part01–part09.tsx` | 共 9 个（改造前各 670–2,139 行） | **每个 16–24 行** | ✅ **已全部切成「组合根 + 子 hook 目录」两层结构**（2026-09-22 起逐批完成）：`parts/partNN.tsx` 仅 `import` 子 hook → 按序调用 → 展开 `return`；真正代码在 `parts/partNN/NN-*.tsx` 子 hook 里。子模块数：part01=6 / part02=4 / part03=4 / part04=3 / part05=2 / part06=3 / part07=3 / part08=3 / part09=2。跨段共享类型在 `parts/bag-types.ts`（自动生成，1,348 项）与手写 `parts/types.ts`。⛔ 顺序即契约（详见 §10.1）。 |

### 10.1 app-state 的两层结构（part01–part09 均已落为此结构）

```
useHarnessApp.tsx                 组合根：建 bag → 按序调用 9 个 part → 合并 return
  parts/bag-types.ts              自动生成的 Bag 接口（跨段引用的类型面，1,348 项）
  parts/partNN.tsx                part 组合根（16–24 行；与同名子目录并存）
  parts/partNN/<前缀>-<域>.tsx    子 hook：export function usePartNNx(bag: Bag)
```

**⛔ 三条硬约束（拆 part02 时实测得出，拆其余 part 同样适用）**：

1. **顺序即契约**：子 hook 内含 hook 调用。组合根必须按**文件名前缀顺序** import → 调用 → 展开；重排会让 React 的 state 归属错位，而 **tsc 完全看不出来**。守卫【92】钉死这条。
2. **切点必须落在「非镜像语句」上**：每个声明语句紧跟它的 `bag.X = X as typeof bag.X` 镜像语句，切在两者之间 ⇒ 镜像里读不到那个局部。
3. **切片用字符区间（`getFullStart..getEnd`），不用行号**：原文件里有 `}, [dep]);  useEffect(() => {` 这类**同一行两条语句**。逐条 `join("\n")` 会把它们拆成两行（内容不变、行结构变了）；**整段取一段连续切片**最稳。

### 10.2 第 6 轮的判据（可复用）

`part02.tsx` 2,139 行 / 体内 690 条语句 / 404 个声明 → 4 个子 hook，**不改任何标识符**：

- **先量后切（关键事实）**：`usePart02` 体内 **前向引用 = 0**，且**非镜像语句的跨语句裸引用 = 0** —— 因为上一次跨 part 拆分已把所有跨语句引用改写成 `bag.X`（实测 `mcpServerSearch` 只出现在「声明 / 镜像 / return」三处）。⇒ 每个语句**自足（modulo bag）**，**子 hook 之间不需要传任何入参**。
- ⇒ 本轮是**纯结构搬迁**：不引入新语义。连"bag 是稳定 ref、闭包读到最新值"这条也是**搬迁前就存在**的，本轮没有新增。
- **保真判据 17 项全绿**（`fidelity-part02.cjs`，基线一律取 `git HEAD` 的旧文件）：语句条数 + 逐字符文本守恒、声明名序列（404）逐项相同、`return` 键列表（404）**含顺序**逐项相同、**hook 调用序列（250 次）逐位一致**、旧文件非空行多重集无缺失。
- **新增守卫【92】**：part 组合根的子模块 `return` 面必须 ① 互不重叠 ② 名字都在本文件声明 ③ 每个 `bag.X =` 镜像都被 return ④ import / 调用 / 展开三者顺序 == 文件名顺序。四条破坏模式均**已实测能报红**（不是恒真的假守卫）。

### 10.3 下一轮候选（副本实测）

> ✅ **已完成**：`part01`–`part09` 全部切成「组合根 + 子 hook 目录」两层结构（见 §10 表 + §10.1）。该项从待办划除。

1. `electron/main.ts` **约 1,975 行**：按域拆出的 handler 已落 `electron/features/*.ts`，主文件仅余 `shell` 域壳族（有意保留）。再降需先定各域 `deps` 契约，风险中。
2. `src/App.tsx` **2,543 行**：剩组件体 + **大量 `useState`（约 500 个）** ⇒ 再切必须新造组件边界并传 ~750 个名字，**动它需要用户确认**（理由见 §10 表）。⛔ 未确认前不要动。
3. `src/features/app-view/helpers.tsx` 的存量死导入（209 行里绝大多数是导入区）：目标明确，但**必须先证明每条被删说明符的目标模块仍由 `App.tsx` 直接导入**（否则 bundle 会变）。
4. ⚠️ **`<userData>/images` 路径有两处独立推导（真相源重复）** —— `features/app-diagnostics.ts:164`（`path.join(ud, "images")`，给设置页“存储占用”页读数/清理用）与 `features/clipboard-ipc.ts:30`（`path.join(app.getPath("userData"), "images")`，写粘贴的截图）。今天两者算出同一个串，**但改一处就会静默分叉**：设置页量的/删的目录与剪贴板写的目录会变成两个。修法二选一：① 把路径收进 `electron/main.ts` 顶层（`pastedTextDir` 就是这么做的，属同一模式）+ 两个 feature 经活绑定取用；② 新建 `features/app-paths.ts` 放**惰性 getter**（`() => path.join(app.getPath("userData"), "images")`）两侧共用。⛔ 注意【91】：非 main.ts 模块**不得**在模块顶层求值 `app.getPath("userData")`，所以无论哪条路都不能写成模块顶层的常量。
5. `src/styles/*.css` **十几个 1,300–1,800 行分节文件**（如 `07-settings-mcp-connectors.css` 1,783 行）：纯 CSS、**低风险但收益也低**，优先级最低。
6. ⚠️ 文档对齐：`docs/ARCHITECTURE.md` 写的是**目标形态**（非现状），`docs/REFACTOR-COMPARE-2026-09-21.md` 仍写改造前基线；本仓库 `AGENTS.md` 与本文档已在本轮对齐到当前结构（2026-09-22）。

### 10.4 第 7 轮的判据（可复用）

`part01.tsx` 1,995 行 / 体内 630 条语句 / 371 个声明 → 6 个子 hook，**同样不改任何标识符**：

- **先量后切**：`usePart01` 体内 **前向引用 = 0**、**非镜像语句的跨语句裸引用 = 0**（371 个声明名全部有 `bag.X = X` 镜像，且镜像条数恰为 371 ⇒ 一一对应，无「写给别的 part」的外部镜像）⇒ 与 part02 同构，**纯结构搬迁**。
- **分段数怎么选**：按行数平衡试 `--parts 4/5/6`，取最均衡的一组（4 段出现 722/851/908/**107** 的失衡尾巴）。末段偏小是「切点只吸附到带域注释的语句」的必然结果，**不是缺陷**。
- **保真判据 21 项全绿**（`fidelity-part01.cjs`，基线一律 `git show HEAD:<file>`）：语句条数（629）+ 逐字符文本守恒、声明名序列（371）逐项相同、`return` 键列表（371）**含顺序**逐项相同、**hook 调用序列（220 次）逐位一致**、旧文件非空行多重集无缺失。
- **⛔ 跨 part 键冲突必须**在**切之前**查：守卫【92】的 `seenKey` 是**跨所有组合根共享**的账本 ⇒ 两个 part 返回同名键会被判「重复键」。本轮先跑 `precheck-part01-vs-part02.cjs`（part01 371 名 ∩ part02 404 键 = **0**）再动手；新拆一个 part 时同理，**别等到预检红才发现要改名**。
- **文件名要贴内容**：初版把 563 行的第 3 段命名为 `03-relay-accounts-rate-limit`，但该段实际含 relay 账户 + 连接器/技能状态 + 429 重试；review 时按语句清单核实后改名 `03-accounts-connectors-rate-limit`（只改文件名 + 组合根那一行 import，保真脚本重跑仍 21/21）。
- **重复的 side-effect import 不需要处理**：原文件顶部的 `import "@xterm/xterm/css/xterm.css"` 被 6 个子 hook 各带一份，`dist/assets/*.css` 里 `.xterm-viewport` 实测**只出现 1 次**（Vite 按模块 id 去重）⇒ 产物未变。**判据落在产物上，不靠"应该会去重"的推理**。
- **存量死导入是既有问题，不是本轮引入**：HEAD 的 part01.tsx 本身 143 个 import 绑定里**已有 102 个是死的**（该导入区是 09-21 从 `useHarnessApp.tsx` 整块复制来的）。切分后各子 hook 合计 205 个死绑定 —— 差额来自「同一条 import 语句被多段保留、死绑定被重复计数」，**模块集合只增不减**，故本轮按 part02 同例原样保留（要清理须先证明 bundle 的模块集合不变，见 §10.3 第 3 条）。

### 10.5 第 8/9 轮（part03–part09 切分 + dialog/clipboard 域 + 守卫【92】加固）

本轮把 `par01–part09` 里剩下的 **7 个 part 一次切完**（part03 1,914 → 20 / part04 1,778 → 17 / part05 1,690 → 15 / part06 1,791 → 17 / part07 1,290 → 17 / part08 1,696 → 17 / part09 670 → 15，均为组合根行数），并把 `electron/main.ts` 的 `dialog`(5) 与 `clipboard`(4) 两个域搬进 `features/dialog-ipc.ts` / `features/clipboard-ipc.ts`（2,070 → **1,975**）。

**⛔ 本轮换掉的保真判据（比逐索引比较强一个量级）**：原先每个 part 一个 `fidelity-partNN.cjs`，用「同索引逐条比较」——**任何一条插入都会让其后全部错位**，只能报「首个差异 @NNN」，说不出到底改了几处、改了什么。本轮改用 **LCS 编辑脚本**（`analyze-parts-final.cjs`，基线按 part 分别取 `git show <切分前提交>:<file>`）：

- 输出 `语句 +N/-M`、`名 +N/-M`，并把每条插入/删除**原文打印出来**；
- 实测：**part01/02/04/05/06/07/08/09 = 编辑脚本为空**（语句、声明名、`return` 键、hook 序列四者全部一一对应）；**仅 part03 有 1 条插入、0 条删除**。

**⛔ part03 的唯一破例（全仓唯一，已写进组合根与子 hook 头注释）**：`03-restart-file-model-editor.tsx` 签名是 `(bag: Bag, ibB: ReturnType<typeof usePart03b>)`，段首多一条 `const { providerModels } = ibB;`。原因：`providerModels` 在旧文件里声明在 c 段语句区**之前**、被 c 段的 `useMemo` 读到；拆开后 b 段的局部变量对 c 段不可见。取值来自**同一次渲染**内 b 段刚算出的 state ⇒ 与旧写法等价、行为不变。**「段间零入参」因此只对 8 个 part 成立**，别再当成全仓通例。

**⛔ 本轮修的守卫【92】两处（改的是判据本身，必须能证明非恒真）**：

1. `declaredNames` 原来只认 `const NAME =`、且对象解构取的是 **propertyName** ⇒ ① `const foo: SomeType = …`（带类型注解）**一个都取不到**，② `const { prop: local }` 取 `prop` 而不是 `local`。两者都会让「return 的名字没在本文件声明」**假红**。现改为 `[^=;{]*=` 跳到赋值号 + 按**局部绑定名**取。
2. `lastReturnKeys` 原来用 `/^  return \{([^}]*)\};$/gm`，`[^}]*` 遇到 return 值里的嵌套 `{}` 就截断。现改为**括号配平扫描**。

**非恒真证明（注入法，`guard92-nonvacuous.cjs`）**：对源文件注入 5 类破坏，每次都确认出现指定红行、随后**逐字节还原并核对 sha256**：

| 注入 | 期望红 | 实测 |
|---|---|---|
| 外来名（return 了本文件没声明的名字） | `外来名 onComposerKeyDownZZ` | ✅ 出现 |
| 镜像未 return（`bag.X =` 没进 return 面） | `镜像未 return zzMirrorOnly` | ✅ 出现 |
| 键重复（同一名字 return 两次） | `同时 return` | ✅ 出现 |
| 顺序重排（组合根 import 顺序 ≠ 文件名顺序） | `三者顺序一致` | ✅ 出现 |
| return 值里带嵌套 `{}` | 仍正确报 `return 29 名` | ✅ 出现 |

还原后三个文件 sha256 与注入前完全一致。**同一脚本还顺手把「为什么必须改守卫」变成可复核事实**：新老 `declaredNames` 在 5 个样本上差异 3 处（`const typed: SomeType = fn()` 旧取不到；`{ prop: localAlias }` 旧取 `prop`）——**不是把守卫放宽了，是把判据修对了**。

**⛔ 本轮新增的收尾判据：组合根头注释里的数字必须与实测一致。** 上一轮批量生成 part03–part09 时，头注释照抄了模板（7 个 part 全写「原 2,139 行 / 690 条体内语句 / 4 个子 hook」，实测是 1,914/410/4、1,778/169/3、1,690/59/2 …）。**这类注释骗的是下一个读它的人**，已全部按实测改正（数字口径 = `wc -l`，别用 `split("\n").length`，后者恒多 1）。

**判据口径（本轮实测）**：tsc app 0 错（`--listFiles` 复核真检查了新文件）· `npm run check` **1670 ✓ / 0 ✗ / 3 条既有告警**（改前改后逐项一致）· LCS 编辑脚本 8/9 为空 · 守卫注入 5/5 报红 · 未跑 `accept`（只动主进程模块划分与组件边界，CDP 测不到）。


