# AGENTS.md — Codex Harness Desktop 项目环境速览

本文件供 Codex 引擎读取：进到本项目（Codex Harness Desktop 桌面应用的源码 / 或本机运行环境）时，先读这里就知道「环境里有什么、缺什么怎么装、怎么调用」。保持简洁，详细手册见 `docs/TOOLCHAIN.md`（若存在）。

## 📐 架构改造计划（2026-09-21 立项，**已基本完成**：计划与盘点存档见 `docs/archive/`）

目标：把 `src/App.tsx`（22,216 行 / useState ~500 / 导入 79 个文件）与 `electron/main.ts`（8,971 行 / 313 个 `ipcMain.handle` / 66 个前缀域）按**域**拆成模块树（`src/features/*` + `electron/features/*` + `electron/ipc-registry.ts`）。

**拆分期纪律（每批都适用，违反会直接红或埋雷）**：
1. **一批一提交**、每批 `npm run check` 必须绿，禁止长命重构分支（用户明确拒绝 fork/新分支绕开）。
2. **零行为变化**：DOM 结构 / class 名 / 可见交互一律不动（`accept.mjs` 的 CDP 选择器依赖它们）。
3. **IPC 桥走生成器**：`electron/features/<域>.ts` handler ↔ `ipc-channels.manifest.json`（单一真相源）→ `npm run gen:ipc` 生成 `preload.ts` / `vite-env.d.ts` 的 gen 段（**禁手改生成物**）；守卫【2】6 条逐字节盯一致性。
4. **断言跟着搬**：预检断言读的是**递归聚合面** —— `readAppUi()` = `App.tsx` + `src/features/**` + `src/lib/*.ts`；`readMainSource()` = `main.ts` + `electron/features/**`。所以搬运时必须同轮把对应断言改到新路径（一次搬一块、一次改一组，禁批量替换）；⛔ 聚合器**必须递归**，漏新目录 ⇒ 断言假红，只读单文件 ⇒ 守卫**静默恒真**（最危险）。
5. **判据**：搬组件时若需要新加 >5 个 props，说明它和 App 状态耦合仍太深 → 回退，等状态抽成域 hook 再搬。
6. 域目录按功能域拆（09-25 实测 52 个，其中 `settings-*` 26 个为设置页**按页同构拆分**，粒度稳定；09-25 新增 `team-office`（专家团办公室预览，用户立项；原「公司模式」独立菜单已按其要求收成专家团专属预览））；**不再无谓新增**：新增或合并域目录需用户点头；不引入全局 store（会**增加**耦合面）。

## 📐 功能板块划分与接口规则（现行有效，2026-09-22 立）

> **写/改代码前先读 `docs/ARCHITECTURE-RULES.md`**（以实测现状为基准的规范条文：板块划分判据、四条接口面契约、新增板块 checklist、红线汇总）。
> ⚠️ `docs/ARCHITECTURE.md` 是 09-21 的**目标形态草案**（`registry.ts` / `defineFeature` / `Slot.tsx` / `lib/bus.mjs` 未落地；`gen-ipc-bridge.mjs` 已于 09-23 落地，见 ARCHITECTURE-RULES.md §0/§6），**冲突时以 ARCHITECTURE-RULES.md 为准**。

最硬的六条（细则见文档）：
1. **分层依赖恒为** 壳（`App.tsx`/`AppView.tsx`/`main.ts`）→ 域（`features/<域>/`、`electron/features/<域>.ts`）→ 基座（`src/lib/*.mjs`、`src/components/`、`src/hooks/`、`electron/*.ts`）；基座不反向 import 域；域↔域只经 `app` / props / 对方 barrel，**禁深链内部文件**。
2. **三前缀同源**：目录名 = IPC 域前缀（`ipc-registry.ts` 的 `prefix`）= CSS 类前缀，全小写 kebab；`<域>:<动作>` 一个域多动作不加新前缀。
3. **新增功能：IPC 桥走 manifest**：`electron/features/<域>.ts` handler ↔ `electron/ipc-channels.manifest.json`（单一真相源）→ `npm run gen:ipc` 自动重生成 `preload.ts` / `vite-env.d.ts` 的 gen 段（**禁手改生成物**，漏一处由守卫【2】打红）；同时 `ipc-registry.ts` 记一行。
4. **渲染层收 `app`**（类型 = `HarnessAppApi`）按需解构，不当"几百个 props 的搬运工"；纯展示件 props ≤5；需要共享状态的页面组件**命名导出**（默认可 `lazy`），懒加载只在整页级、Suspense fallback 必须静态常量高度。
5. **状态只挂 bag**（新状态进既有 part 或新建 part，且同轮更新自动生成的 `bag-types.ts`，**禁手改**，守卫【93】）；真相源唯一（守卫【95】）；重置挂"动作"不挂渲染分支。
6. **改了就要留判据**：每新增一个域/接口，把该有的不变量补进 `scripts/guards/` 下对应域文件（可机器校验），并同轮同步本文与 `AGENTS.md` 的实测数字 —— **文档滞后 = 主动误导下一轮**（09-22 自检教训）。

**当前落点（实测值见 `docs/archive/REFACTOR-INVENTORY-2026-09-22.md` §10；行数口径一律 `wc -l`，别用 `split("\n").length`——后者多算 1 行；⛔ 09-22 自检教训：文档数字滞后会主动误导下一轮，每轮收尾必须同步本节）**：
- `src/App.tsx` **12 行**：仅剩 hook 调用 + earlyView 短路 + `<AppView/>`（组件体已全部落 `app-view/`）。
- `electron/main.ts` **1,288 行**：剩 5 个 handler（theme + popout×4，已证不可搬）+ 启动链 + 模块级单例。
- `src/features/app-state/useHarnessApp.tsx` **39 行（组合根）**：建 `bag` → 按序调用 9 个 part → 合并 return。
  - 逻辑在 `parts/part01.tsx` … `parts/part09.tsx`，**9 个 part 现在每个都是「组合根 + 子 hook 目录」两层结构**：
    - 第一层 `parts/partNN.tsx`（16–24 行）：只 `import` 子 hook → 按序调用 → 展开合并 return；
    - 第二层 `parts/partNN/NN-*.tsx` 子 hook（`export function usePartNNx(bag: Bag)`）：真正代码在这里。
  - `parts/bag-types.ts`：自动生成的跨段共享类型（`<Bag>`，1,378 项）；`parts/types.ts`：手写类型面。
  - ⛔ **顺序即契约**：子 hook 内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 组合根**只能按文件名前缀顺序** import / 调用 / 展开。重排会让 React 的 state 归属错位，而 **tsc 完全看不出来**。预检【92】钉死这条。
  - ⛔ 搬迁切片用字符区间（`getFullStart..getEnd`），不用行号——同一行常有多条语句。
  - ⛔⚠️ **全仓唯一的段间入参例外**：`parts/part03/03-restart-file-model-editor.tsx` 的签名是 `(bag: Bag, ibB: ReturnType<typeof usePart03b>)`，多收 b 段 return 只为取 `providerModels`（该名字在旧文件里声明在 c 段语句区之前）。等价性已核（同一次渲染内 b 段刚算出的 state）；这也是它相对旧文件**唯一多出的一条语句**。改它要连 `part03.tsx` 调用点一起改。
  - ⛔ **组合根头注释里的「原 N 行 / M 条语句 / K 个子 hook」必须与实测一致**：09-22 抓到 7 处照抄模板的错数字（part03–part09 全写成 2,139/690/4）。数字对不上 = 注释在骗下一个读它的人。
- `src/features/app-view/helpers.tsx` **36 行（barrel，09-24 实测）**：86 个符号原样 re-export；内容已切进 `src/features/app-view/helpers/` 下 9 个模块（runtime / stream / catalogs / skills / text / thread-list / paths / view-dom / components）。
- 侧栏会话视图（09-25）：「项目（cwd）/ 分类（会话来源）」两个 view tab（⛔ 原「分组（时间）」已按用户
  要求删除，守卫【156】有负向断言不许加回；旧偏好值统一回落到 projects）。
  口径收在纯模块 `src/lib/thread-source.mjs`：分类（主代理 / 专家团主理人 / 团队成员子任务 /
  专家调度 / 子智能体调度 / 专家团调度）+ 调度归属（`buildDispatchChildren`：**分类与项目两个视图共用
  同一份渲染**，被调度会话缩进挂在发起调度的会话下面）+ **项目归属**
  （`resolveGroupCwd`：被调度的专家/专家团/子智能体/团队成员会话跟随**发起调度那个会话的 cwd**，
  不再各自新开项目地址）。守卫【156】**真跑**该模块断言分类判定与五条归属边界。
- 新增/改动 part 结构后，预检【92】会守住「子模块 return 面自洽 + 三者顺序一致」；跳过它的红 = 静默丢值。

## 🎨 视觉规范（2026-09-26 立，守卫【170】）

> **改 UI 前先读根目录 `DESIGN.md`**（色板 / 字体 / 组件约定 / 主题机制，全部实测自 `src/styles/`）。
> 三个真相源的分工：`AGENTS.md` 管「怎么建」· `docs/ARCHITECTURE-RULES.md` 管「架构怎么划」· `DESIGN.md` 管「长什么样」。
> ⛔ 改了 CSS 变量必须同步 `DESIGN.md` 的变量表 —— 守卫【170】做的是**真值对账**（文档里的色值 ≠ CSS 真值会打红），不是检查"文件存在"。

## ⛔ 临时产物放哪（硬性，2026-09-21 立）

**任何中间产物 —— 命令回显、探针 dump、扫描输出、截图、临时脚本 —— 一律写进 `.workbuddy/tmp/`。**
不许落仓库根目录，**更不许落 `D:\` 盘根**（那条规则是用户 09-21 亲自提的：清理时发现盘根躺着 **664 个**这类文件 / 17.3 MB，把盘搞得很乱）。

```bash
node scripts/xxx.mjs > .workbuddy/tmp/check-1.txt     # ✓ 正确
node xxx.mjs > /d/check-1.txt                          # ✗ 落 D:\ 盘根
node xxx.mjs > ./arch-scan.txt                         # ✗ 落仓库根
```

- `.workbuddy/` 已 gitignore，**不会污染仓库**；临时脚本本身（`tmp-*.cjs` / `tmp-*.mjs`）也放这里，跑完即删。
- 仓库根只允许出现**源码 / 文档 / 配置**；别处冒出来的中间文件一律视为待清理。
- 收尾自查：`git status` 干净 + `D:\` 盘根没有你新产生的文件。

## 📓 项目日志库 `logs/`（09-25 立，守卫【158】）

**结论档案**（不是流水账）：一个结论一个文件 + 结构化头 + `index.jsonl` 索引 + sha256 校验。
配套：规范 `logs/README.md`、工具 `scripts/logs.mjs`、技能 `.codex/skills/log-archive/SKILL.md`。

```bash
node scripts/logs.mjs new --kind decision --area memory --title "…" --tags a,b --files p1   # 建条目
node scripts/logs.mjs search <关键词...> [--area a] [--since d]     # 检索（本地打分，按相关度）
node scripts/logs.mjs show <唯一前缀即可>                            # 看内容
node scripts/logs.mjs dedupe / verify                              # 查重 / 完整性校验
node scripts/logs.mjs archive <id...>                              # 清理（默认用它）
node scripts/logs.mjs delete <id...> --confirm <id...|all> --reason "…"   # 硬删（留永久墓碑）
```

⛔ **该写**：定了方案（`decision`）/ 修了非显而易见的 bug（`incident`）/ 发版（`milestone`）/ 改了用户可感知行为（`change`）/ 推翻了旧结论（`decision` + `supersedes`）。
⛔ **不该写**：纯格式、重命名、依赖升级 —— 留在每日流水即可。

⛔⛔ **不许重复写**（用户 09-25：「确保没有重复写日志哈」）：同一段正文**只允许存在一份**。
- **日报**（`<ws>/.workbuddy/memory/YYYY-MM-DD.md`）记时间线与零散判断；涉及结论时**只留一行 `→ logs/<id>`**，⛔ 不复述正文
- **`logs/`** 记结论/依据/影响面/回滚；⛔ 不抄日报流水，也不抄进 `lessons/`
- 两道机制拦阻（不靠自觉）：`new` 写入时就拦相似标题（≥0.75）与相同正文；`dedupe` 随时全库查重

⛔ **不丢失的五道保障**（按强度）：① `logs/` **进 git**（⛔ 别被 gitignore 吃掉，条目必须 `.md` —— `.gitignore` 有 `*.log`）
② 一条一目追加写、不覆盖（改结论用 `supersedes`）③ `verify` 用 sha256 抓篡改/截断 ④ 索引可 `reindex` 重建（磁盘才是真相源）
⑤ 删除**先写墓碑再删**（`audit-deletions.jsonl` 永久留 id/path/sha256/reason ⇒ 内容可删，"存在过"不可删）

## ⛔ 验收铁律（硬性要求，2026-09-11 起生效，先读这条）

**本项目任何源码改动，一律以「自动验收通过」为完成标准。禁止「我改完了，你自己点一下试试」。**

改动完成 = 下面这条命令**退出码为 0**：

```bash
npm run verify     # 等价于 npm run check && npm run e2e
```

| 层级 | 命令 | 覆盖什么 | 失败意味什么 |
|---|---|---|---|
| ① 离线预检 | `npm run check` | 构建 + **产物新鲜度** + IPC 三件套一致性（main.ts handler ↔ preload 桥接 ↔ vite-env.d.ts 方法面）+ CSS 类覆盖告警 + **纯函数行为断言**（`src/lib/*.mjs`，node 直接 import 跑真实现）+ 结构守卫（零阻塞宿主 / 验收入口唯一化） | 改了没重建 / 桥接漏了类型 / 有死链 / 判定逻辑跑偏 / 架构约束被破 |
| ② 验收（**只有一条脚本**） | `npm run accept` | `scripts/accept.mjs`：拉起**已构建**应用，在**跨轮次复用的持久 profile**（`.e2e-profile/main`，首次把真实会话历史搬进来）上跑本轮验收项，失败自动截图到 `.e2e-artifacts/shots/` | 界面/行为真破了（看截图与逐项输出即知） |

纪律清单：

1. **⛔ 验收范围由流程保证：默认只跑「最新一轮」（2026-09-13 用户严令后**改写流程**，不再是"靠自觉加 --only"）**。
   用户原话：「能不能不要再跑旧的测试了，不要浪费我token啊…只能测试最新改动，给你说了几百遍」→
   「验收流程是死的嘛，你不会重新写嘛」。所以 `scripts/accept.mjs` 现在**按轮次分区**：
   - 每个验收项在文件顶部的 `ROUND_OF` 里登记轮次，`LATEST_ROUND` 指向当前轮；
   - **默认（不带参数）= 只跑 `LATEST_ROUND` 那一轮**；`--only <id>` 只跑指定项；`--all` 才是全量；
   - `--list` 会打印每项所属轮次；新增验收项**必须**登记轮次，否则默认跑不到且会打印警告。
   历史项不删（仍是回归证据），但**永远不会在默认路径上被执行** —— 单跑一次默认验收只有 4~5 项。
   **全量 `--all` 只在三种情况**：发版/里程碑前、跨模块改动无法界定范围、用户明确要求，且跑之前先说明理由。
   判断"本轮该跑什么"的原则：改渲染层交互/滚动 → 那几项渲染项；**改主进程/引擎/打包 → 不跑 accept**
   （CDP 断言测不到），改跑 `check` 并把可静态验证的部分补进预检守卫；纯文档/注释 → 只跑 `check`。
   判据：**这条断言会不会因为这次改动而变红** —— 不会就是纯浪费用户的时间和 token。
2. **改了哪个模块，就改 `scripts/accept.mjs` 里对应的验收项**（每一项是 `{ id, name, run(h) }`，可 `--only <id>` 单独跑）。旧的「一堆历史场景 + 增量哈希 runner」**已按用户要求删干净**（`scripts/e2e/run.mjs`、`scripts/e2e/scenarios/` 都没了，preflight【7】硬守卫不许它们回来）：那套东西改一处主进程源码就带出十几个历史场景、一轮十几分钟，人卡在等它跑完。**不要再新建场景目录**；本轮不再对应的旧验收项**直接删掉**，别攒着。
3. **断言必须带前置条件**（先断言「有这个前提」再做判断），否则上一步的残留状态会导致假通过。
4. **不做反证**（用户 2026-09-19 明令：「把你的反证流程删了，以后不需要再反证了」）：断言写完直接跑正式那轮。历史上"把修复改回去确认会红"的步骤**全部取消** —— 省下的时间用来覆盖更多真实场景，而不是反复往返。
   ⛔ **反证删除、审查保留**（用户同日明确：「code review 审查还是要保留的哈，这个太重要了」）：
   **代码审查（下条第 4 项）是收尾固定一环，与反证无关，不许一起删**。
5. **能用静态守卫的别用 CDP 跑**：要「重启应用 / 断网 / 换网段 / 并发多会话」才能复现的，钉进 `scripts/check-preflight.mjs`（如【10】【11】），改坏了 build 阶段就红，零运行成本。
6. **⛔ 每个功能/任务收尾都要跑一遍代码审查（用户 2026-09-17 明令：「每次做完一个功能或者完成一个任务，都用 code review 检查一遍」）**。
   用 `open-code-review` 技能（行级审查：精确选文件 → 分规则 → 逐文件审 + 覆盖账本 → 行号校验 → 按严重级出报告）。
   **审查对象是本轮 diff**（含未提交改动），**不是全仓库** —— 与验收同一条纪律，不做与本次改动无关的扫描。
   **发现的问题当轮修掉再提交**，不留成待办；**结论要能说出依据**（读了哪些文件、按什么判的），
   不能只说"看起来没问题"。改动极小时可走轻量路径（自检清单 + 四条硬约束）并说明为何轻量，
   但**不许因"改动小"跳过** —— 09-17 抓到的真 bug（`/icon.png` 在 file:// 下加载失败、
   「取消增强」取消完内容仍被覆盖、守卫被注释顶成假绿）全都出在"看起来只是小改"的地方。
   ⛔⛔ **09-25 两次被用户追问「怎么没审」**（我先连跳 6 轮，补审当轮抓到 6 个真缺陷）⇒ 这条不是可选项。
   补审抓到的 6 个缺陷**全部是「tsc 绿 + 预检绿也发现不了」的类型**，照抄这个判据自查：
   · 改「运行态开关/模式/后端」时，**搜全仓库找它的每个引用点**逐个确认是否跟着分岔（同族缺陷常散在未改文件里）；
   · **只验「剔除」不验「落地」**：把一批项从顶层摘走改到别处渲染时，必须反向自问「每一项都还在某处渲染吗」
     （实测：成员自己调度出的会话一处都不渲染 = 整条会话从 UI 消失，纯模块取证才看见）；
   · **断言必须打到「代码形态」**：`indexOf("xxx")` / `includes("yyy")` 会命中**注释**（讲解文字里有同一批词），
     代码改回去断言照样绿 ⇒ 用数组字面量 / 三元表达式 / 转义反引号 payload / `delete→set` 语句序列。
   · **新加/改过的断言必须做变异测试**（备份 → 改坏 → 跑检查 → **必须报 ✗** → 还原）：这是验证「断言非恒真」的
     唯一可靠手段（09-25 实测：自问"能不能被违反"漏掉 4 条恒真断言，变异测试全抓出来）。
     ⛔ 环境坑：**agent 自己跑的 node 里 `spawnSync` 被沙箱拒（EBUSY）** ⇒ 变异脚本写成 **bash 逐项跑**；
     检查工具的输出可能走 **stderr** ⇒ 只在 bash 里 `2>&1` 合并。
   · **负向结构断言必须过 `codeOnly()` 剥注释**（`guards/_ctx.mjs` 提供；这条纪律 09-18 就写下了，
     但 09-25 实测 **121/144 条没遵守**，口径见下文自检）。在注释里引用代码片段是本项目讲清"旧写法"的常态，
     于是 `!/xxx/.test(src)` 型断言随时被注释顶成假红，或被误判成"注释误伤"放宽成假绿
     （09-25 两次实测：注释里写「按时间分组」顶红【156】、`indexOf` 命中文档注释让镜像顺序断言恒真）。
     ⇒ 预检末尾有**守卫自检告警**报告当前欠账数（只报告不失败，改到哪条顺手过 codeOnly，逐步收敛）；
     它按**赋值来源**判定（表达式含 `codeOnly(` 或含剥块注释特征 `[\s\S]*?\*\/`），⛔ 不靠变量名猜
     —— 09-25 审查发现 `hardCode` 是「hard-coded」缩写、不是 codeOnly 产物，靠名字猜会误判。
     ⛔ 另记一处债：`01-build-ipc-css.mjs:224` 的 `hardCode` 是**手写**版剥注释（等价但非统一入口，
     `codeOnly` 升级它不会跟进）；换统一入口会改变剥除范围 ⇒ 需逐条验证，别顺手改。


### 排查方法论（09-13 一整天弯路换来的，下一轮动手前先读）

1. **看到症状先别调阈值、别加条件**。先问一句：「**现在有几个东西在写同一份状态 / 同一根滚动条？**」这一天 6 次修复的真根因全部是两类 —— ①**多个 owner 抢同一个东西**（钉顶与跟随每 60px 互拉、`switchJumpRef` 被两处消费）；②**状态被提前/错位消费**（裸布尔被下一次任意渲染吃掉）。**阈值从来不是根因**，调阈值只是把互拉挪到另一个区间。
2. **先打点，再推理**。`window.__adbg` 一次 dump 出的时间线胜过半小时的代码推演：这一天每次"我觉得是这个原因"都猜错，每次打点都一击命中（`pin-fix{err:-65}` ↔ `follow-grow{+65}` 互拉、`clear-anchor{at:"switch-jump"}` 出现在**发送**时刻、`pad:622` 残留、`follow-grow` 全程不触发）。**加打点是第一动作，不是最后手段**；打点要带数字（top/gap/pad/err），不要只写"到这里了"。
3. **测试必须跑到事件真正结束**（用户原话：「每次测试消息都不看完，你能发现什么bug，总是运行中就杀应用」）。长回合的毛病只在后段暴露；采样截断 + 收尾杀应用 = 把最关键的证据扔掉，还会把"没跑完"误报成失败。
4. **判据不能用会随渲染状态变化的量**：折叠组收起时 `innerText` 是空串、`textContent` 才与折叠无关；侧栏按最近活动重排，**会话要用标题点、不能用行索引**（用索引测出来的"钉顶没了"有一半是点开了别的会话 → 假红）。判据要落在**语义主体**上（"正在跑的那个回合"），不要用整页总量。
5. **状态重置要挂在「动作」上，不能挂在「某条渲染分支」上**。曾经把锚定状态清零写在"切会话瞬时定位"分支里，那段一旦被任何条件挡掉，清零就跟着被跳过 → 留白残留一整屏、锚点指向别的会话。现在清零挂在 `openThread` 里，结构上不可能被跳过。
6. **文档与代码同轮更新**。过时文档会主动误导下一轮（旧版 AGENTS.md 详细描述了已被删除的 `anchorHeightBaselineRef` 增长量模型与 `byUs` 判据，这一天的弯路有一部分就是照着它走的）。**删掉实现就把对应文档段落标记作废或改写**，别让后来者读到一段"看起来很像现状"的历史。
7. **⛔ 不跑与本次改动无关的断言（用户 09-13 严令，第二次强调）**。原话：「能不能不要再跑旧的测试了，不要浪费我token啊…只能测试最新改动，给你说了几百遍」。
   - 每轮改完只跑 **`--only <与改动相关的 id>`**；判据是「**这条断言会不会因为这次改动而变红**」，不会就别跑。
   - 全量 `accept.mjs` 只用于**发版前 / 跨模块改动 / 用户明确要求**，且跑之前先说明为什么必须全量。
   - 改主进程/引擎/打包这类 CDP 测不到的模块 → **不要跑 accept**，改跑 `check`，并把可静态验证的部分补进预检守卫（【10】【11】就是为此存在的）。
   - 曾经一整天每轮都全量跑 57 项，其中绝大多数与本轮改动无关 —— 纯浪费用户时间和 token，**这是行为准则层面的硬约束，不是建议**。
8. **⛔ 改动范围纪律：只做「架构层设计缺陷」和「渲染层真 bug」，不许顺手改行为（用户 09-13 明令）**。
   原话：「设计缺陷是只架构层，渲染层的bug，你别给我乱改」。
   - **两类可动**：① **架构层设计缺陷** —— IPC 契约与错误传播、真相源数量、事件通道与背压、持久化原子性与迁移、模块边界与守卫、生命周期状态机；② **渲染层真 bug** —— 有可复现路径、能说清"用户看到什么错"的。
   - **不许动**：行为语义、权限边界、可见交互（不经用户确认就"收紧/放开"）。**教训**：我自作主张把 `fs:write` 限定到工作区，用户不得不叫停并回退（`7f0de22`）—— 安全收紧也是**产品决策**，先问再做。
   - **重构不算修复**：除非要动的那段代码本身就是缺陷（例如"两个 owner 抢同一份状态"），否则不要为了"更干净"去改它。
   - 动之前先回答两句：**这是架构缺陷还是渲染 bug？**、**这个改动会不会改变用户看得见的行为？** 第二问为"是"就先问用户。
9. **⛔ 功能完整性铁律（09-15 用户明令：「加功能必须考虑得比我多，不能只做表面」）。**
   一个对象被创建/接力/归档/删除时，它的**全部衍生状态**必须有明确去向——成员会话、
   渲染缓存、映射表（threadProviderRef / team-threads / thread-runtime）、复用键、备份分支、
   侧栏列表。做法：把这次动作当**状态机迁移**，穷举它触碰的每一份持久化状态并逐一回答
   「它去哪」；只实现用户说的那一步 = 半成品。09-14~15 三起事故全是这一类：接力后旧会话
   还在、删主会话后成员成孤儿、统一 id 后 config 出现重复段。修 bug 时同样要问：
   **同类场景还有哪些没覆盖？旧的引用还在不在？清理动作要不要级联？**

10. **⛔ 探针方法论（09-16 发版当天踩出来的三条，省下的是错误结论而不只是时间）**：
   - **Node 的 `https.request` 不读 `HTTP(S)_PROXY` 环境变量**（只有 `curl` 之类会读）。所以「清掉代理变量
     再直连」对 Node 探针**等于没清**，而直连 GitHub 在国内时通时不通 ⇒ 同一脚本这次 533KB、下次 0 字节，
     判据随机。**凡是测网络行为的断言，要么用本地 mock，要么走 curl。**
   - **外网不可当判据**：`downloadUpdate` 那类「跟随重定向」的行为，用真 GitHub 验证会被 ECONNRESET /
     0 字节干扰（还容易被误读成代码有问题）。**正解 = 本地 HTTPS mock**：openssl 自签证书（`-subj /CN=127.0.0.1`
     且 `-addext subjectAltName=IP:127.0.0.1`，否则 Node 不认）× `https.createServer` 一个
     `/redirect → 302 → /payload → 200`，进程内 `NODE_TLS_REJECT_UNAUTHORIZED=0` 放行自签。
     确定性判据 = **下载字节数 + 载荷 sha256 与源一致**；反证 = 摘掉重定向分支 → 必然报 `HTTP 302`。
   - **`(cond ? ok : fail)("消息")` 不能写成 `cond ? ok : fail("消息")`**：后者在 `cond` 为真时**根本不调用 `ok`**，
     于是该断言**一行都不打印、静默漏检**（我这两条新守卫第一版就是这样，预检 526 条"全绿"却查不到它们）。
     写完新守卫先确认**它在输出里出现了**。：临时 profile 每轮都是白纸 —— 侧栏零会话，「切会话重播 / 首轮不出字 / 会话一多互相拖慢」这类问题**只在有历史时才现形**，空目录里测等于没测（用户原话：「为啥你每次拉起来的应用都没有历史记录，那测试有什么意义呢」）。现在首次建 profile 时会把**真实 profile 的会话历史**（`codex-home/sessions/**`）搬进来，之后一轮轮叠加；断言「本轮数据」时用 `h._rolloutFiles({ since: h.launchedAt })`，别让历史文件把断言顶成假绿。profile 在 `.e2e-profile/<name>/`（已 gitignore，含真实对话内容与 Key 密文，**绝不入库**）；想重来就删目录，想重灌真实配置/历史用 `CODEX_HARNESS_RESEED=1`。

GUI 起不来时，最低限度跑 `check`（离线可用），并在提交信息里写明 `accept` 未跑的原因。手册见 `docs/TESTING.md`。

### 引擎自己怎么跑验收（已实测）

引擎跑在应用体内，而 `accept` 会**再拉起一个隔离实例**——不会和自己撞车。实测依据：单实例锁按 `userData` 隔离，验收用 `.e2e-profile/main`，两实例完全独立并存。

```bash
resources/tools/node/node.exe scripts/accept.mjs              # 跑本轮全部验收项（约 20s）
resources/tools/node/node.exe scripts/accept.mjs --list        # 列出验收项
resources/tools/node/node.exe scripts/accept.mjs --only greet  # 只跑 id 含 greet 的项
resources/tools/node/node.exe scripts/accept.mjs --keep        # 跑完不关应用，留着手动看
```

`npm run accept` / `npm run e2e`（同一条）亦可，前提是 PATH 里有 node。**验收跑的是 `dist/` + `dist-electron/` 产物，必须先构建**——`check` 已含构建。

## 这是什么

一个 Electron 桌面应用，把 OpenAI Codex 引擎（`@openai/codex` app-server，stdio JSON-RPC）封装成可用的桌面工作台：多会话、插件/技能、自动化工具、连接器（MCP）、记忆分层。

## 内置能力（引擎可直接用，无需额外安装）

| 能力 | 入口 | 说明 |
|---|---|---|
| 引擎本体 | `app-server --listen stdio://` | 会话、工具、插件、钩子、技能全部走它 |
| 基础运行时 | `resources/tools/{node,python,git,pwsh,vscode-cli,rg,uv,cmake,ninja,sevenzip,jq}` | 开发机本地保留；**打包后仅 node/vscode-cli 内置**，其余开发工具页按需下载（缺 Git 启动自动补装） |
| 桌面自动化 MCP | `tools/npm-global` 里的 `nuphus`（MCP 服务器名） | 需先装「自动化工具包」，工具前缀 `desktop_*` / `browser_*` |
| 浏览器自动化 CLI | `tools/npm-global/playwright-cli` | 需先装「自动化工具包」，首次 open 会提示装内核 |
| 指纹浏览器 | `require("cloakbrowser")` / `tools/npm-global/cloakbrowser` | 需先装「自动化工具包」+「Cloak 内核」 |
| 内置技能 | `codex-home/skills/` 的 `desktop-automation`、`browser-skill` | 随应用写入，引导引擎调自动化工具；旧 `browser-automation` 已退役（升级时按指纹自动清理，用户改过的目录不碰） |

## 会话动态工具（thread/start 已注册，可直接调用）

| 工具 | 用途 |
|---|---|
| memory_recall / memory_save | 查询/保存分层记忆（用户偏好/项目背景/工作流/任务经验）；发送前应用会自动注入相关记忆 |
| generate_image / describe_image | 生图与视觉识图（需在 设置→插件→内置插件 配置，未配置时调用会返回指引） |
| rpa_save / rpa_run | 保存自动化流程为 RPA 配方 / 列出并执行已存配方（逐步复现） |
| task_add / task_update | 维护用户任务清单（新增/改状态/列出/删除） |
| agent_ask | 向用户展示选项卡等待选择（第一项为推荐），用于关键决策确认 |

## 工具链清单

**随包内置（离线可用，勿重复下载）**：Node（安装器引导）、VS Code CLI、**Nuphus 桌面自动化 + Playwright 浏览器自动化 CLI**（`tools/npm-global` 预解压，≈48MB 原始；09-16 起 **CloakBrowser 已从包里剥离**，extraResources `filter` / `pack-automation.cjs` / mac `copy-mac-tools.cjs` 三处同源排除。⛔ **必须两条 extraResources 映射**：`from=resources/tools/npm-global`（根级 shim）+ `from=resources/tools/npm-global/node_modules`（包体本身）——electron-builder 会**无条件丢弃 `from` 根级的 `node_modules`**，只写一条映射的话包里只剩 shim、包体全无）、**ponytail 插件源**（`tools/ponytail-plugin` 1.6MB）。其余（Python/Git/PowerShell/rg/uv/CMake/Ninja/7-Zip/jq）09-16 起不随包，走「开发工具」页按需下载；**首次启动检测到缺 Git 会自动后台补装**（`autoInstallGitIfNeeded`：仅 Windows、与手动安装互斥、装完 `restartServerWhenIdle` 刷新引擎、失败广播 done 事件不悬挂安装态，下次启动仍缺会再试）。**ponytail 首启自动种**（见【26】）：`config.toml` 里**没有** `ponytail@ponytail` 段时才动手，卸载过（段在、enabled=false）永不重装。

**按需安装（应用内「开发工具」页 或 手动）**：

| 工具 | 大小 | 安装方式 | 装完效果 |
|---|---|---|---|
| Nuphus 桌面自动化 | 随包 30MB | **随包直出**，卡片显示「内置」；目录损坏时点「修复安装」（重新解压 zip 到 `tools/npm-global/` + 激活联动开关 + 引擎重启） | nuphus MCP 注册 35+ 桌面工具（经 nuphus-call 按需调用） |
| Playwright 浏览器自动化（CLI） | 随包 18MB | 同上（随包直出 / 可修复安装） | playwright-cli 可用（**默认浏览器通道**） |
| CloakBrowser 指纹浏览器（npm 包） | ~4MB | 开发工具页「下载」（`runNpmInstall`：内置 node 自带 npm + registry.npmmirror.com，失败回落官方源；用户自设 registry 时不覆盖） | `CLOAKBROWSER_ENTRY` 生效，可过 Cloudflare/reCAPTCHA；**不装不影响日常浏览**（默认走内置浏览器视图 + playwright-cli） |
| Playwright 浏览器内核 | ~170MB | 开发工具页「下载」（需先有 Playwright CLI） | playwright-cli 首次 open 不再提示缺内核 |
| Cloak 指纹浏览器内核 | ~200MB | 开发工具页「下载」（需先装 CloakBrowser npm 包） | cloakbrowser 可开反检测窗口 |
| ponytail 写代码模式插件 | 随包 2MB | **首启自动种入**（cache + 注册段 + 钩子信任），无需点安装；按钮分支仅作修复用 | 会话钩子 + 6 个 ponytail-* 技能 |
| FFmpeg / yt-dlp / Miniconda / MinGW | 各 20~300MB | 开发工具页「下载」（联网） | 对应命令可用 |
| Docker Desktop / OpenSSL | — | 系统级安装（开发工具页打开官网） | 系统命令 |
| 语音模型（sherpa-onnx 三件套，识别+端点检测+合成） | 总 ~270MB | 开发工具页「下载模型」或「本地导入」（开发版专用：识别 4 种常见目录布局，SHA256 校验后落盘到 `<userData>/voice-models/`） | **生产构建不打包**——`package.json` 的 `asarUnpack` 只解 `sherpa-onnx-*/**`（原生 addon），模型数据走 userData 按需下载 |

## 安装操作（引擎缺工具时怎么自助装）

1. **优先看 `tools/` 目录**：`resources/tools/npm-global` 存在 = 自动化工具已装；`tools/{node,python,git,...}` 存在 = 基础运行时已装。
2. **缺 Nuphus / Playwright CLI（随包内置能力缺失）**：调用应用内 `runtime:install`（id=`nuphus` / `playwright-cli`，从随包 zip 修复解压），或手动：
   - 解压随包 `tools/automation-tools.zip` 到 `tools/`（内置 python：`python -c "import zipfile; zipfile.ZipFile('automation-tools.zip').extractall('tools')"`），结果得到 `tools/npm-global/`。
   - 重启引擎（或重选一次供应商触发 `applyCustomModel`）→ nuphus MCP 段写入 config.toml。
3. **缺 CloakBrowser npm 包**：`runtime:install`（id=`cloakbrowser`，走 npmmirror npm 源）。
4. **缺 Playwright / Cloak 内核**：`runtime:install`（id=`playwright-browsers` / `cloak-browsers`），会分别调 `playwright install chromium` 与 `cloakbrowser install`（后者需先装 CloakBrowser 包）。
5. **缺 ponytail 插件**：正常情况**不用管**（首启自动种）；真要重种：`runtime:install`（id=`ponytail`），随包安装源 `tools/ponytail-plugin` 种到 `codex-home/plugins/cache` + 写 `[marketplaces.ponytail]` / `[plugins."ponytail@ponytail"]` / 钩子信任。
6. **装完统一**：重启引擎生效；插件/技能/钩子状态从 `plugin/list`、`skills/list`、`hooks/list` 读。
7. ⛔ **写 config.toml 的键值走 `config/value/write` 时必带 `mergeStrategy: "replace"`**（引擎必填；缺了整条请求被拒 `Invalid request: missing field mergeStrategy`，而这些调用普遍 `.catch(() => undefined)` 静默吞掉 → 表现成「开关点了没生效」）。预检【26】有结构守卫：每处调用 600 字符内必须出现该字段。09-16 实测：ponytail 卸载/装回的 enabled 写入漏了它，长期没生效。

## 人工预览（给用户看 / 自己看）

- `npm run preview:fresh`：拉起一个**全新临时实例**（隔离数据目录 ⇒ 未登录 + 未配模型 + 无历史，不碰真实配置与历史），用来人工确认首启引导、空态与布局观感。**前台运行**，关窗即结束。
  ⛔ 必须在用户自己的终端前台跑：agent 沙箱里命令结束会回收整棵进程树（detached spawn / 系统级启动 / 常驻后台任务三种写法全部实测失败），**窗口活不过命令**。
  ⛔ 临时实例的宿主环境变量必须摘：`ELECTRON_RUN_AS_NODE`（不摘 = 启动即崩）、`NODE_OPTIONS`（不摘 = 窗口能开但功能全哑）、`CODEBUDDY_SAFE_DELETE*`。
- 改了 UI 要「让用户亲眼看」时：先 `npm run build`，再让用户跑这条命令；或自己用 e2e harness 起实例截图给对方（截图前记得关掉挡屏的引导弹窗与展开的下拉菜单）。

## 验证基建实现细节（配合开头的「验收铁律」看）

- **E2E 靠主进程自带开关实现**：`CODEX_HARNESS_USER_DATA`（重定向 userData，完全隔离）+ `CODEX_HARNESS_DEBUG_PORT`（开 CDP 端口，端口随机取空闲）——⛔ **别写行号**（这两个开关已经搬过一次，原写的 `main.ts:60/:65` 当场失效）：用符号 grep `CODEX_HARNESS_USER_DATA` 定位。框架 `scripts/e2e/lib/harness.mjs` 零新依赖（复用 `ws`），**不要引入 Playwright/Puppeteer**。
- **测试实例的工作区 = 项目根目录**（09-11 用户定：以后拉 CDP 就用这个项目地址测）：应用从 `localStorage.workspace` 读工作区（⛔ 同样别写行号 —— 原写的 `App.tsx:5972` 已失效；用符号 grep `localStorage.getItem("workspace")` 定位，当前在 `src/features/app-state/parts/part01/01-session-drafts-voice.tsx`），而隔离 profile 是白纸 → 界面停在「尚未选择工作区」，部分路径下发送会被拦。harness 现在默认用 `Page.addScriptToEvaluateOnNewDocument` 把 `workspace` 注入成 `this.root`（项目根）**并重载一次**让注入先于页面脚本执行；需要「未选择工作区」空态的场景可传 `new ElectronHarness({ workspace: null })` 关掉。
- **离线预检**：`npm run check` = `build` + `scripts/check-preflight.mjs`。其中 IPC「方法面」解析用自写的括号深度扫描器（纯正则会被「同一行写多个方法 `a: …,  b: …`」和「类型里的 `name(...)` 括号被吃掉后参数名被误当方法名」骗到）。
- **现存验收项**：`scripts/accept.mjs` 里 26 项，按 `ROUND_OF` 登记轮次、`LATEST_ROUND` 指向当前轮（默认只跑那一轮）。⛔ **此处不再逐一列举** —— 早期版本在这里描述 `smoke` / `model-scope` 两个"场景"，而那两个脚本**早已删除**（连同 `scripts/e2e/scenarios/`，守卫【7】不许它们回来），留在文档里只会误导。要看待跑清单就 `node scripts/accept.mjs --list`，要看某一项做什么就直接读它的 `name` 与 `run(h)`。
- **引导页可能被跳过**：真实 Key 灌进去后 `customModel.hasKey=true`，兼容 effect 会自动进入主界面（写 `login-skipped`），所以任何"等引导页"的断言都要写成「引导页**或**主界面二选一」，不能硬等跳过按钮。⛔ 别再引用 `App.tsx:7754` 这类行号（`App.tsx` 现在只有 12 行）；用符号 grep `login-skipped` 定位。
- **环境坑（踩过）**：①环境里的 `HTTP_PROXY` 会把回环请求也代理走 → harness 已自动注入 `NO_PROXY=127.0.0.1,localhost`；②`ws` 库的 `on("message", (data) => …)` 首参是**原始数据**不是 `MessageEvent`；③`clickByText` 必须取**最内层**元素（按 innerText 长度升序），否则点到 wrapper 上；④`contenteditable` 用 CDP `Input.insertText` 输入，`[contenteditable="true"]` 匹配不到 `plaintext-only`；⑤**宿主带着 `ELECTRON_RUN_AS_NODE` 时 Electron 会被降级成纯 node 跑主进程**（启动即崩 `Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`，栈尾打 `Node.js vXX`）→ harness 在 spawn 前 `delete` 掉这个变量；⑥**引擎的 rollout 是首回合才落盘的**：只 `thread/start` 的会话 `thread/resume` 报 `no rollout found`、`thread/list` 里也不出现 → 想造「能 resume 的会话」必须补一发 `turn/start`（模型调用失败无妨，rollout 已落盘）；⑦宿主还会注入 `NODE_OPTIONS=--require …node-language-shim.cjs`（拦截子进程 fs 写入）——继承下去会让主进程写 userData 时 `EPERM`、启动链断掉（**窗口能开、引擎不 spawn、发消息零回复**）→ harness 也一并 `delete` 掉 `NODE_OPTIONS`（与 ⑤ 同源：都是宿主环境泄漏）；⑧**无 GPU 的机器 / CI 上 Chromium 的 GPU 子进程会反复起不来并最终 FATAL 自杀**（`GPU process isn't usable. Goodbye.`），表现为 e2e「CDP Runtime.enable 超时 / Target crashed」——实测连零项目代码的最小 Electron 应用也一样崩，**与本项目代码无关**；harness 已带 `CODEX_HARNESS_IN_PROCESS_GPU`（主进程据此 `appendSwitch("in-process-gpu")`，另附 `no-sandbox` 等，**仅测试实例生效**）绕开。
- **历史遗留**：`verify:turnfold`/`verify:userrefs`/`verify:memory-layers` 等一批 npm script 指向的文件早已删除（跑必 ENOENT），**09-11 已从 package.json 清理**；现存真脚本只有 `verify:reasoning` / `verify:image-plugin` / `verify:packaged-tools`。新增验证请走 e2e 场景或 preflight 检查项，**别再散落一次性 `.mjs`**。
- 手册见 `docs/TESTING.md`。

## 引擎初始化原则（2026-09 定）

- **初始化回归原生**：不预写 marketplace 段、不首启自动种插件/技能。
- **一切可下载的拓展都按需安装**（自动化包、浏览器内核、ponytail、ffmpeg 等），`runtime:install` 统一入口。
- 官方精选市场（`openai-api-curated`）需 ChatGPT 账号登录才能装，API Key 方式装不了——插件页已隐藏，不要尝试 `plugin/install` 该市场。

## 引擎怎么知道「宿主有哪些能力、能拓展什么」（09-25 立，守卫【153】【159】）

用户报障：「接口和拓展清单，Codex 好像不知道，扫半天都没扫到，不知道能拓展什么」。实测根因**不是清单没做**，
而是**可达性**：

- 清单本体 = 内置技能 **`harness-api`**，由 `scripts/gen-capability-skill.mjs` 从
  `ipc-channels.manifest.json` + `ipc-registry.ts` **生成**（70 域 / 337 通道）⇒ 永远与代码同步。
  **加/改通道后必须重跑生成器**（`npm run gen:ipc` 已挂钩顺带重生成）；守卫【153】比对过期即红。
- ⛔ 引擎的技能目录只给 `name + description`（渐进披露）⇒ 模型**不知道要读**；而用户问「能拓展什么」时，
  模型的第一反应是 **grep 源码**，打包版根本没有宿主源码 ⇒ 整轮白跑。所以 `developer-instructions.ts`
  里有一条**常驻**指针（第 11 条，块名 `CAPABILITY_INSTRUCTIONS`）：点名技能、说明「一次读全、
  别用 cmd 的 `type "路径"`（引号会被通道剥掉）」、给出**拓展点分类**、并写明打包版边界。
- 清单正文自带两张表：**「可拓展点」**（想加什么 → 改哪里）与**「怎么读这份清单」**。改生成器时别删。

## 两个「改了就影响所有会话」的默认值：跨进程同源（09-25，守卫【159】）

`electron/` 与 `src/` 是**独立打包产物、互不 import** ⇒ 这两个默认值各有一份字面量，必须同源：

| 默认值 | 主进程真相源 | 渲染层同源副本 |
|---|---|---|
| 自动压缩比例 **0.6** | `electron/app-settings.ts` 的 `DEFAULT_AUTO_COMPACT_RATIO`（经 `normalizeAutoCompactRatio` 归一） | `part01/04-optimistic-turn-approval-e2e.tsx` 的 `AUTO_COMPACT_RATIO_DEFAULT` |
| 供应商最大并发 **10** | `electron/features/custom-model-types.ts` 的 `DEFAULT_MAX_CONCURRENCY` | `src/lib/concurrency.mjs` 的 `DEFAULT_MAX_CONCURRENCY` |

⛔ 只验「常量存在」不够 —— 变异测试证明过：**把接线那行删掉、常量还留着，断言照样绿**。断言一律锚
**接线/取值本身**（`text += CAPABILITY_INSTRUCTIONS;`、两侧字面量逐字比对）。改默认值先看用户档案：
`app-settings.json` 里存着的值**会覆盖默认**（只改默认 = 老用户看不到变化）。

## 应用 UI 速览（引擎了解宿主能力用）

- **内置浏览器在右侧面板**（不在中央主区，聊天不受影响）：右栏「浏览器」标签 = Electron `<webview>`（宿主窗口 `webPreferences.webviewTag: true`），guest 与宿主隔离、无 node API。组件 `src/components/BrowserPane.tsx`（`variant="panel"` 适配右栏宽度）。右栏四个标签（变更/终端/浏览器/项目树）常驻直达，无「打开标签页」选择器。标题栏行高 44px 与 titleBarOverlay 原生窗口钮对齐。
- **指纹内核（cloak-browsers）仅用于自动化场景**（模型经 `cloakbrowser` CLI 调用）；浏览器视图的「隐身浏览」按钮为预留位，尚未接入 CDP 嵌入。


## 近期功能性变更（索引）

> 09-21 起的功能变更轮次记录已整体迁往 **docs/CHANGELOG-ROUNDS.md**（2026-09-24 拆骨，
> 修复评估报告 P0-2：AGENTS.md 502KB 被截断到 13%）。下面只留条目名，细节查那边。

- 近期功能性变更（宿主行为，引擎交互相关）
- 09-21 深色模式下「独立会话窗口」的系统钮看不见但能点（已修）
- 09-21 内置第三方写作技能 + 文档转换（markitdown）
- 09-21 「工具输出裁剪」的真相：不是文本工具，是生图内联 base64（已修）
- 09-21 「当前能力链路」：同一件事多个后端时，"现在走哪条"终于有唯一来源
- 09-21 配置面安全扫描：把 agent 自己的配置当攻击面（预检【86】+ `npm run scan:config`）
- 09-21 计划可编辑构件 + 新鲜上下文的 reviewer
- 09-23 「排队消息自动启动后，聊天区里看不到那条消息」（已修）
- 09-23 两条正文之间的过程归成一个「带概要统计」的折叠块
- 09-23 运行中显示增强按钮 + 消息区底部留白归零
- 09-23 折叠/展开后自动把内容底部贴回视口底
- 09-23 四个元技能内置 + 技能安装门禁（提交 `961827b` / `b520164`）
- 09-23 「用户手动停止 ⇒ 排队消息不得被自动发送」（守卫【115】）
- 09-23 WorkBuddy 日志对照后的 P0 四项（构建指纹 / Ctrl+Enter / 听写不吞字 / 每轮当前时间）
- 09-23 「正文之间的过程折叠」——需求冲突，口径以「整段运行过程折叠」为准
- 09-23 晚：钉顶回归（我下午的折叠提交触发的竞态）+ 运行态过程自动折叠
- ⚙️ 2026-09-24 IPC 强化 + 主题注册表（守卫【2】组新增 8 条）
- 手写 invoke 全量收敛（09-24 上午，守卫【2】再扩 5 条）
- 🧭 设置页「拓展接口」（09-24，守卫【128】）
- 🪟 任务栏图标 = AUMID 配对问题（09-24，守卫【2】新增 4 条）

## ⛔ 停止链路与 runtime-refs 下沉（09-24 下午，守卫【131】【132】）

- **委派场景「无法停止 + 反复弹窗」（老版本用户截图：expected active turn id <X> but found <Y> 反复弹）**：
  宿主记录的回合已结束、引擎活跃回合已切到 <Y> ⇒ interrupt 被拒。修法（part08/03-seg.tsx）：
  ① 从报错捕获 `but found <Y>` → **按真实回合重试中断**（那回合还在烧 token，必须真停）；
  ② 重试也失败/其它失败 → **一律复位运行态**（setSending(false) 等），绝不挂着「运行中」让用户反复点。
  ⛔【131】钉死两条；voice 侧同款 catch 只打日志（语音不涉及运行态 UI，无需改）。
- **P2-9 收敛**：electron/features/** 的 `from "../main"` 163 处引用清到白名单 9 符号：
  B 类（经 main 转发的）机械直连源模块（75+9 符号）；C 类 41 符号下沉 **electron/runtime-refs.ts**
  （路径组走 initRuntimePaths()——⛔ main.ts 必须在 app.setPath("userData") 之后立即调；
  类单例构造仍在 main.ts 启动链、setXxx 注入；复杂闭包 mutableState/bridgeDial/enrichScanCountSnapshot/
  filePreviewAllowed/remote/scheduler/voiceService/channelBot/botPairing 留 main = 白名单【132】）。
- ⛔ 行号制手术（行内替换 + 降序删除）：通用括号扫描器在 `(paths: …) => {` 箭头参上会误判块结束
  ——别再用「depth 归零即块尾」，要「归零且当前字符是 ; 或 }」。

## ⛔ 审计报告遗漏项补修（09-24 下午，守卫【143】【144】【145】）

- **§2.2 断环**：`main → runtime-refs → main/01-model-catalog → main` 已断。做法是拆出两个**叶子模块**：
  · `electron/runtime-paths.ts`：9 个 userData 路径常量 + `initRuntimePaths()`（⛔ main.ts 必须在
    `app.setPath("userData")` 之后立刻调，自带 once）。它是叶子（只 import electron / node）⇒ 谁都能安全依赖。
  · `electron/upstream-protocols.ts`：协议表 + `syncUpstreamProtocols` + `normalizeUpstreamProtocol`。
  · ⛔ 关键教训：**别把路径放进 runtime-refs** —— runtime-refs 反过来要 import 01-model-catalog
    （upsertCustomModel 用 readCustomModels）⇒ 会生成新环。叶子模块是唯一安全形态。
  · `runtime-refs.ts` 路径组改为 `export { … } from "./runtime-paths"`（CJS 产物是
    `Object.defineProperty(get)` ⇒ **活绑定，不是快照**，已在 dist-electron 上验证）。
  · 守卫【143】：01-model-catalog 必断 + main/** 历史引用冻结上限 10（不增长）。
- **§3.5 更新检查**：`updates.ts` 加 `parseVersion` / `compareVersions`，取代「字符串不等即更新」
  （旧写法：任何不同 tag 含更旧的都报 hasUpdate）；stable 通道尊重 `prerelease`
  （**本地是预发布版时除外**，否则 beta 用户永远收不到更新）。守卫【144】含 7 组行为用例。
- **§2.8 守卫缺口**：`accelerator.ts` 与收藏夹从「只看文本」升级为**行为断言**（跑 dist-electron 产物）：
  sanitizeAccelerator 7 组（无修饰键回落 / 修饰键归一排序）、acceleratorLabel 2 组、
  收藏夹 4 组（addFavorite 真落盘、**空 id 列表不删**、只删指定 id、clear 独立计数）——
  收藏夹用 `mkdtempSync` 临时目录，**不碰用户真实数据**。守卫【145】。
- **§6 清理**：`docs/posters`（9.1 MB，无引用）移入 `archive/posters`（不删，可逆）；
  `build/icon-b-*`、`icon-c-*` 两套竞争图标删除（18 文件，`icon-preview.html` 同步去掉 B/C 卡片）；
  `.playwright-cli/page-*.yml` 出库（`git rm --cached`）；`installer.nsh` 文案更正
  （cloakbrowser 与浏览器内核是自 09-16 起**按需下载**，不再声称随包）。
- **自检阈值修正**：原「精确区间」在宿主封锁子进程时会把 19 条环境失败误报成「断言消失」；
  现在检测到环境类失败时只告警并提示复核，环境正常才硬卡（基准 2276，改守卫必须同步）。
- ⚠️ **报告 §6 的一条结论已过时**：`.codex/skills/preflight-guard-authoring/SKILL.md:32` 实际已经改成
  「不做反证，此前要求的『故意改坏一次』已作废」——不必再改。真冲突的是
  `.codex-harness/memory/lessons/pitfalls.md:4`（记着"搬路径常量别再试第二次"，与已落地的
  runtime-paths 冲突），已改写为「结论作废 + 已落地做法」（该文件 gitignore，评审看不到，故同步于此）。

## 搜索改为「当前会话内」+ 修用户消息搜不到（09-24 下午，副本待提交）

- **用户两次纠正**：①「回车提示这个啊，没有跳转到那个消息」（截图 = `Session … is archived. Run codex unarchive`
  —— 跨会话面板点到了**已归档**会话，引擎直接拒）；②「这个搜索只展示当前会话的历史记录，不要展示其他的」。
- **定案**：顶栏 🔍 改为**当前会话搜索**（不再跨会话），点击结果**跳到那条消息**。
  复用项目里已存在但**没有 UI** 的会话内搜索能力（`bag.chatSearchQuery` / `chatSearchResults` /
  `chatSearchGo` / `locateMatchEl` / part04 的高亮 useLayoutEffect）。
  ⛔ 开关必须复用 `bag.chatSearchOpen` **单一真相源**：Ctrl+Shift+F 也走它，另立局部 state 会导致
  「快捷键把结果算出来、高亮打上，却不显示面板」（实测设计缺陷）。
  ⛔ 跨会话实现（history:search IPC + 墓碑过滤）**保留但不接 UI**（用户明确不要看到其他会话）。
- **顺手修掉一个真 bug（用户消息搜不到）**：`collectMessageTexts` 只看 `item.text`，而
  **userMessage 的正文在 `content[]` 里**（item.text 为空）⇒ 用户自己发的消息一律搜不到。
  实测证据：DOM 上明明显示「请严格按顺序做三件事…」，搜它 **0 命中**；而搜助手消息里的「的」
  能命中 5 处 —— 一半内容搜不到。改用 `itemText(item)`（按 type 取正确字段）后：该词 **2 处命中**、
  「的」10 处。守卫【146】新增一条钉死。
- **测试姿势的两次教训（都是我自己取样错，不是产品 bug）**：
  ① 关键词从整个 `.timeline` 取 ⇒ 取到「加载更早的消息」「请严格\n按顺序」这类 UI 文案/跨行文本
     （原文里不连续 ⇒ 必然 0 命中）。正解：只从 `.message-body` 取，且用 `[\u4e00-\u9fa5]{6,}`
     **不跨换行**地取。
  ② 诊断脚本传 `workspace: null` ⇒ 应用停在「尚未选择工作区」、消息根本发不出去 ⇒ 会话为空、
     搜什么都是 0 命中。**验收项必须先断言「当前会话有正文」**（没有就点侧栏会话直到有内容，
     始终没有则明确报环境不满足）——已加为该验收项的前置条件。
- accept 的 history-search 项重写为：顶栏 🔍 存在 → 面板 portal → 不存在的词明确「当前会话里没有匹配」
  → 取当前会话真实关键词 → 有命中 → **点击后该消息拿到 .msg-search-highlight 高亮**（真的跳过去了）。
- 验证：tsc 0 / check 非环境失败 0 / accept **10/10**。

## ⛔ 断环收尾：electron/main/** 零反向依赖（09-24 晚，守卫【143】【147】）

- **从「冻结上限 10」到「硬性 0」**：此前 `electron/main/**` 有 10 个文件反向 `import ... from "../main"`
  （01 之外），与已修好的环并列为「已知尾巴」。本轮全部断干净，守卫上限**删除**，改为必须 0：
  - 5 个 userData 路径 → **electron/runtime-paths.ts**（`memoryModeFile`/`mcpOverridesFile`/`connectorsFile`/
    `builtinPluginsFile`/`subAgentsFile`，均在 `initRuntimePaths()` 里赋值 —— 时序与原 main.ts 顶层一致，
    因为原声明也在 `app.setPath("userData")` 之后）；
  - `internalThreads`（Set 容器）→ **electron/runtime-refs.ts**；
  - `responsesBridge` 单例 + `bridgeDial` → 新叶子 **electron/bridge-dial.ts**（依赖只有 responses-bridge
    与 upstream-protocols，都是叶子）；main.ts 按名 import 后原样 re-export，feature 侧引用名不变；
  - `gitBinCache` → 归其**唯一**使用模块 `main/02-git-bin.ts`（改模块局部 `let`，main.ts 退出）；
  - 04-connector-config 的 `McpOverrides`/`ConnectorConfig`/`decryptSecret`/`safeConnectorId`/`escapeToml`/
    `readStoredChannelBot` → **同目录直连** `./06-mcp-overrides` / `./07-connectors-io` / `./08-channel-bot-io`。
- ⛔⛔ **顺手抓到一个真环（本轮最大发现）**：`runtime-refs → main/01-model-catalog → features/window-factory
  → runtime-refs`。最后一条边是 `01-model-catalog` 里的**死导入**（`createWindow`/`createPopoutWindow`
  只在该文件的**注释**里出现）。**这类环 tsc 不报、既有守卫全绿**，只在运行时让模块拿到部分初始化的
  exports（行为取决于求值时机 —— 今天恰好安全，改一行就未必）。删死导入即断环。
  ⇒ 新增守卫 **【147】**：源码级剥注释建 import 图，Tarjan 求 size&gt;1 的 SCC，
  `runtime-refs` + 三个叶子**不得出现在任何环里**（【143】只管叶子自身的直接依赖，管不到这个）。
- ⛔ **环检测器必须剥注释**：注释里写 `from "…"` 会被裸正则当成真 import —— 我自己写的「此处原先 import …」
  注释就让断掉的老环在检测器里「复活」了一次（本项目已记录的最危险假象：以代码为准，注释只是线索）。
- ⛔ **同一类「假红」再现**：守卫【143】首版用裸正则扫 `main/**`，被 `01-model-catalog` 注释里的
  `from "../main"` 命中 ⇒ 用 `codeOnly`（剥注释）后才是真判据。
- **顺带修好上一轮漏下的【93】bag-types 漂移**：「会话内搜索」改造删了 10 个 `historySearch*` 字段、
  新增了 `closeHistoryPanel`/`jumpToHit`，但上一轮最后一次完整 `npm run check` 跑在收尾改动**之前**
  ⇒ 【93】红了却没被拦（正是项目记录的「check 是一条链，别漏跑 check-bag-types」）。已补齐
  1370 项对齐。**纪律重申：提交前的 check 必须在当轮最后一次改动之后跑。**
- **验证**：tsc 双 tsconfig 0 诊断；eslint 0 errors；`npm run check` 非环境硬失败 0（含【93】/【143】/【147】）；
  accept 真机 **10/10**（启动链被改，必须验）；源码级环图：三个叶子 **0 环**、`runtime-refs` 亦退出大 SCC。

## ⛔ 正文 Markdown 渲染：列表尾部的「结语行」（09-24，守卫【149】）

- **现象**（用户截图：「最后一个总是歪的，前面空那么多」）：列表最后一项后面紧跟一行**顶格**结语
  （模型常忘加空行），CommonMark 判定它是该项的 lazy 续行 ⇒ 渲染成
  `<li>四通八达<br/>1–10 全是「数字开头」</li>` ⇒ 结语从 marker 之后起排、左侧空出 marker 宽度
  （`.markdown ol/ul { padding-left: 21px }`）。
  证据 = **离线等价渲染**（同 react-markdown@10 + remark-gfm + remark-breaks + 同 components.p）：
  源 `…\n30. 四通八达\n1–10 全是…` ⇒ `<li>四通八达<br/>1–10 全是…</li>`；
  中间加一个空行 ⇒ 变成 `</ol><p>1–10 全是…</p>`（正常左对齐）。
- **修法**：分块函数从 `Markdown.tsx` 搬到 **`src/lib/markdown-blocks.mjs`**（纯函数 ⇒ 守卫能直接跑真值表），
  新增 `softenListTailLazyContinuation`：只在「**块尾 + 顶格 + 非列表项/非块级开头**」三条同时成立时，
  在那行前**补一个空行**（不是拆块 —— 块数不变 ⇒ 流式期间 `<MdBlock>` 的 key 稳定、组件不会重挂载）。
- ⛔ **围栏感知是必须的**：代码块（含流式**未闭合**的 ```）内部绝不能注入空行 —— 那等于改代码内容。
  实现逐行记录「该行开始前是否已在围栏内」，围栏内的行直接停手（守卫有"已闭合/未闭合"两条反向用例）。
- ⛔ 判据刻意窄：**缩进的续行**（作者本意就是列表项内换行）、纯段落、块级开头（引用/标题/分隔线）
  一律不动；"中间夹着结语再继续列表"的也不动（只治尾部）。
  守卫【149】= 静态（分块只允许一份实现，`Markdown.tsx` 不许再出现本地 `splitMarkdown`）
  + 跑真代码的真值表（正向必拆 / 反向必不拆）。
- ⛔ **用户消息不走 Markdown 渲染**（`UserMessageView` 用的是 `<p className="user-message-text">`）⇒
  这条修复**不能靠"发一条用户消息"在 accept 里端到端验**，只能靠离线等价渲染 + 真机回归（不崩、验收项全绿）。

### 追加：同一症状的第二种成因 —— 正文行首/行尾的**全角空格**（09-24 二次反馈，守卫【149】）

- 用户第二次反馈时给了完整上下文截图：**列表 → 明显空档 → 仍然缩进的两行**。
  ⛔ 这个形态**排除**了「列表 lazy 续行」（那种是紧贴、无空档），也排除了「普通独立段落」（那种必须顶格）
  ⇒ 剩下的解释只有一个：**缩进来自文本本身** —— 行首的全角空格 U+3000。
- ⛔ 关键机制：**HTML 只折叠 ASCII 空白（U+0020 / U+0009）与换行；U+3000 与 U+00A0 不参与折叠**
  ⇒ 行首一个全角空格 = 渲染出一格宽（≈ font-size）的可见空白；行尾那种还会把长行挤折、多出一行。
  （半角空格不用管：行首/行尾的 ASCII 空白浏览器自己会折叠掉，没有视觉影响。）
- 修法：`trimInvisibleSpace` —— 只对**非围栏行**去掉行首/行尾的 U+3000 / U+00A0；
  **行中间的不动**（排版间隔是合理的），**ASCII 前导空格不动**（那是 markdown 缩进语义）。
- ⛔ 排查这类「缩进 / 空白」问题的顺序（本轮踩实）：
  ① 先看**间距**：与大间距并存 ⇒ 是独立块（缩进必来自内容）；紧贴上一行 ⇒ 才可能是列表 lazy 续行。
  ② 再用**离线等价渲染**（`react-dom/server` + 同版本 react-markdown + 同插件 + 同 `components.p`）
     枚举候选源（顶格 / 缩进 / 全角空格 / 有空行 / 无空行），看哪种 HTML 结构吻合 —— 五分钟出结论。
  ③ ⛔ **别指望拿用户实例的 rollout 取证**：本轮试过 `AppData\Roaming\Codex Harness Desktop\codex-home`、
     `~/.codex/sessions`、D 盘 maxdepth 5 的 `codex-home` 三处全部扑空（用户跑的实例 userData 不在
     这些位置，且它的快捷方式里没有 `CODEX_HARNESS_USER_DATA`）；也别用 `wmic`（宿主黑名单已封）。

## 🧠 记忆后端二选一（09-25 立，守卫【150】）

用户要求：「启用 MCP 记忆就优先用 MCP，不要 MCP 写了记忆又用金字塔记忆，这样重复了」。

**两个后端互斥，同一时刻只用一个**：

| 后端 | 设置值 | 写入去哪 | 配套技能 |
|---|---|---|---|
| 内置记忆金字塔（**默认**） | `memoryBackend: "builtin"` | 工作区 `lessons/*.md` + `MEMORY.md`（`MemoryLayers.appendLesson`） | `memory-classify` |
| MCP 记忆服务 | `memoryBackend: "mcp"` | MCP 工具（`@vheins/local-memory-mcp`） | `memory-mcp-backend` |

- 设置项在 `app-settings.json` 的 `memoryBackend`（类型见 `electron/app-settings.ts`；新开关一律加那里）。
- **互斥的实现点**（改了会红）：
  1. `electron/memory-backend.ts` = 后端判定的**叶子模块**。⛔ 不许把它放进 `runtime-refs.ts`
     —— 后者已 import `memory-layers`，反向引用会成 require 环（守卫【147】同族）。
  2. `MemoryLayers.appendLesson()` 开头让位：`memoryBackend() === "mcp"` 时直接 `return false`
     ⇒ 内置金字塔**停止捕获**，不会与 MCP 各存一份。
  3. `ensureBuiltinSkills()` 末尾按后端**改名切换** `SKILL.md ⇄ SKILL.md.disabled`：
     mcp → 只启用 `memory-mcp-backend`；builtin → 只启用 `memory-classify`。
     （改名而非删除，切回来立刻恢复。）

**MCP 记忆服务是可选安装，不内置**（不进 package.json 依赖、不随包发布）：

```bash
node scripts/install-memory-mcp.cjs              # 装到 <userData>/memory-mcp（独立 package.json）
node scripts/install-memory-mcp.cjs --check      # 0=已装 / 2=未装
node scripts/install-memory-mcp.cjs --uninstall  # 删目录即可
node scripts/install-memory-mcp.cjs --ignore-scripts  # 受限环境逃生口（会缺原生构建产物，慎用）
```

⛔ 已知环境坑：本机封 node 内嵌 spawn ⇒ 带 postinstall 的依赖（esbuild / better-sqlite3）装不上原生产物，
用 `--ignore-scripts` 能装上但 **better-sqlite3 缺 `build/Release/*.node`，服务起不来** ⇒ 端到端写读验证在本机做不了
（用户机器无此限制）。连接器接入：以 `connectors.json` 注册 stdio 服务器
（`node <userData>/memory-mcp/node_modules/@vheins/local-memory-mcp/bin/mcp-memory-server.js`，
`MEMORY_DB_PATH` 指到 userData）；⛔ 不要手改 `config.toml` 的 `mcp_servers`（那是 harness 生成的）。

### ⛔ 记忆后端必须用「带回退」的判定（09-25 追加，守卫【150】）

用户 09-25：「你弄好，如果我的电脑不行，用户电脑肯定也不行」—— 指向一个真实缺陷：
这个 MCP 服务依赖原生模块（better-sqlite3）+ 带 postinstall 的依赖（esbuild），在
**禁 npm scripts / 无构建工具链 / 取不到预编译二进制**的环境里会**装得上但起不来**。

- 捕获链与技能互斥一律用 `effectiveMemoryBackend()`（**不是** `memoryBackend()`）：
  选了 mcp 但服务入口缺失 ⇒ **回退内置金字塔**并 `console.warn`。
  ⛔ 若此处按裸 `memoryBackend()` 让位，坏安装环境下会**记忆一处都不写 = 彻底丢记忆** ——
  这比"重复"严重得多，所以宁可回退。
- 安装器必须提供 `--verify`（真起一次服务做 MCP 握手，15s 超时）：只判文件存在会把坏安装报成"已就绪"。
  实测本机：`--verify` → `{installed:true, verified:false, error:"服务退出码 1（原生模块未构建）"}`。
- 用户侧兼容性结论（写进给用户的答复）：Windows + 正常网络下 better-sqlite3 走 prebuild 下载，通常能装；
  装不上时**自动回退内置**，不丢记忆；`--ignore-scripts` 是受限环境的逃生口（会缺原生产物，须配 `--verify` 自证）。
