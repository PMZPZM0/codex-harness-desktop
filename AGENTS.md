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

## 🧭 对话与信息准则（2026-09-26 用户指定，对项目内 AI 助手行为生效）

1. **信息边界**：遇到不确定、无法查证的内容直接回复「不知道」，禁止猜测、编造信息，主动减少幻觉。
2. **信息溯源**：涉及数字、日期、价格、政策等内容，区分有无权威来源；给不出权威来源的，明确标注「需要自行核实」。
3. **语言要求**：使用通俗直白的语言，摒弃空洞晦涩、没有实质内容的词汇。
4. **回答结构**：先给出结论，再阐述理由；不做冗长无效的铺垫。
5. **需求确认**：用户需求表述模糊时，主动提问确认，不自行揣测并直接作答。

## ⛔ 本文件有注入上限（2026-09-26 实测，守卫【172】）

**引擎读本文件是有字节上限的，超了会静默截断**（不报错、也不加"已截断"提示 ⇒ agent 自己不知道少读了什么）。

- 引擎参数 = `project_doc_max_bytes`，**官方默认仅 32768 字节**；本应用已在启动参数里抬到 **262144**（`electron/codex-server.ts`，守卫【172】钉住 + 校验值必须 > 本文件实际大小且留 2× 余量）。
- ⛔ 引擎会**从 cwd 向上遍历并拼接多级 AGENTS.md**（项目级 + `codex-home` 全局个性化约 12KB），**上限卡的是拼接总量** ⇒ 本文件不要无限增长。
- ⛔ 写在这里、超出上限的部分**等于没写**：agent 读不到，却以为规则已生效。**关键规则往文档前部放**。
- 自查口径：`wc -c AGENTS.md`（字节，不是 `wc -l`）。

## 🔑 现行不变量速查（改这些地方前必读；详解见括号里的文档）

> 09-26 拆骨时从各轮变更小节提炼。**⛔ 每条都有守卫钉着，改坏会红**；这里是「为什么」与「别踩的坑」。

- **记忆后端二选一**（`docs/CHANGELOG-ROUNDS.md` →「记忆后端二选一」）：内置金字塔 ⇄ MCP 记忆**互斥**，同一时刻只用一个。⛔ 判定一律用 `effectiveMemoryBackend()`（**不是** `memoryBackend()`）：选了 mcp 但服务起不来 ⇒ **回退内置**（宁可回退也不能"一处都不写 = 丢记忆"）。`electron/memory-backend.ts` 是叶子模块，不许进 `runtime-refs.ts`。守卫【150】。
- **`electron/main/**` 零反向依赖**（同上 →「断环收尾」）：所有 `electron/main/*.ts` 不得 `import ... from "../main"`。路径常量走 `electron/runtime-paths.ts`（叶子）、单例走 `electron/runtime-refs.ts`；`from "../main"` 的**白名单**（守卫【132】，9 符号）与 `main/**` 历史引用上限（守卫【143】）都不许扩大。⛔ 新增守卫 **【147】** 用剥注释后的 import 图求 SCC，`runtime-refs` 与三个叶子不得在任何环里。**注释里写 `from "…"` 会被裸正则当成真 import** ⇒ 环检测器必须剥注释。
- **正文 Markdown：列表尾部的「结语行」**（同上 →「正文 Markdown 渲染」）：列表最后一项后紧跟顶格结语会被 CommonMark 判成 lazy 续行 ⇒ 渲染歪成 `<li>…<br/>结语</li>`。修法是 `softenListTailLazyContinuation`（`src/lib/markdown-blocks.mjs`，纯函数可跑真值表）。⛔ **围栏感知是必须的**：代码块（含流式未闭合 ```）内绝不能注入空行。另：行首/行尾的**全角空格 U+3000 不参与 HTML 空白折叠** ⇒ 会渲染出可见空白，由 `trimInvisibleSpace` 处理（只对非围栏行、不动行中间）。守卫【149】。
- **停止链路：委派场景不要挂"运行中"**（同上 →「停止链路」）：引擎报 `expected active turn id <X> but found <Y>` 时，宿主已结束、真实活跃回合是 Y ⇒ **按报错里的 Y 重试中断**；重试也失败 ⇒ **一律复位运行态**，绝不挂着让用户反复点。守卫【131】。
- **搜索 = 当前会话内**（同上 →「搜索改为『当前会话内』」）：顶栏 🔍 只搜当前会话（跨会话实现保留但不接 UI）。⛔ 开关必须复用 `bag.chatSearchOpen` **单一真相源**（Ctrl+Shift+F 也走它）。⛔ `collectMessageTexts` 必须用 `itemText(item)` 按 type 取字段 —— **userMessage 的正文在 `content[]` 里、`item.text` 为空**，只看 `item.text` 会让用户自己发的消息搜不到。守卫【146】。
- **更新检查的版本比较**（同上 →「审计报告遗漏项补修」）：`updates.ts` 用 `parseVersion`/`compareVersions`，⛔ 不许退回「字符串不等即更新」；stable 通道尊重 `prerelease`（**本地是预发布版时除外**，否则 beta 用户永远收不到更新）。守卫【144】。
- **守卫的「行为断言」要跑真产物**（同上）：`accelerator.ts` 与收藏夹的判据跑 `dist-electron` 产物（sanitizeAccelerator / acceleratorLabel / 收藏夹 add·删·clear），收藏夹用 `mkdtempSync` 临时目录、**不碰用户真实数据**（守卫【145】）。

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

1. **⛔ 验收范围由流程保证：默认只跑「最新一轮」**（用户严令，不靠自觉加 `--only`）—— `scripts/accept.mjs` **按轮次分区**：
   - 每个验收项在文件顶部的 `ROUND_OF` 里登记轮次，`LATEST_ROUND` 指向当前轮；
   - **默认（不带参数）= 只跑 `LATEST_ROUND` 那一轮**；`--only <id>` 只跑指定项；`--all` 才是全量；
   - `--list` 会打印每项所属轮次；新增验收项**必须**登记轮次，否则默认跑不到且会打印警告。
   历史项不删（仍是回归证据），但**永远不会在默认路径上被执行** —— 单跑一次默认验收只有 4~5 项。
   **全量 `--all` 只在三种情况**：发版/里程碑前、跨模块改动无法界定范围、用户明确要求，且跑之前先说明理由。
   判断"本轮该跑什么"的原则：改渲染层交互/滚动 → 那几项渲染项；**改主进程/引擎/打包 → 不跑 accept**
   （CDP 断言测不到），改跑 `check` 并把可静态验证的部分补进预检守卫；纯文档/注释 → 只跑 `check`。
   判据：**这条断言会不会因为这次改动而变红** —— 不会就是纯浪费用户的时间和 token。
2. **改了哪个模块，就改 `scripts/accept.mjs` 里对应的验收项**（每项是 `{ id, name, run(h) }`，可 `--only <id>` 单跑）。⛔ **不要再新建场景目录**（旧「历史场景 + 增量哈希 runner」已删，preflight【7】不许它回来）；本轮不再对应的旧验收项**直接删掉**，别攒着。
3. **断言必须带前置条件**（先断言「有这个前提」再做判断），否则上一步的残留状态会导致假通过。
4. **不做反证**（用户明令）：断言写完直接跑正式那轮，"改回去确认会红"的步骤**取消**。
   ⛔ **反证删除、审查保留**：**代码审查是收尾固定一环，与反证无关，不许一起删**。
5. **能用静态守卫的别用 CDP 跑**：要「重启应用 / 断网 / 换网段 / 并发多会话」才能复现的，钉进 `scripts/check-preflight.mjs`（如【10】【11】），改坏了 build 阶段就红，零运行成本。
6. **⛔ 每个功能/任务收尾都要跑一遍代码审查**（用户明令，**不是可选项**）。用 `open-code-review` 技能。
   **审查对象是本轮 diff**（不是全仓库）；**问题当轮修掉再提交**；**结论要能说出依据**。
   改动极小可走轻量路径并说明为何轻量，但**不许因"改动小"跳过**（历史真 bug 全出在"看起来只是小改"的地方）。
   四条自查判据（**完整版 → 技能 `open-code-review` §2/§6**）：
   · 改「运行态开关/模式/后端」时，**搜全仓库找每个引用点**逐个确认是否跟着分岔（同族缺陷常散在未改文件里）；
   · **只验「剔除」不验「落地」**：把一批项从顶层摘走改到别处渲染时，反向自问「每一项都还在某处渲染吗」；
   · **断言必须打到「代码形态」**（`indexOf`/`includes` 会命中**注释** ⇒ 代码改回去照样绿）：用数组字面量 / 三元 / 转义 payload / `delete→set` 语句序列；
   · **新加/改过的断言必须做变异测试**（备份 → 改坏 → 跑检查 → **必须报 ✗** → 还原）—— 验证「断言非恒真」的唯一可靠手段。
   ⛔ 环境坑：agent 的 node 里 `spawnSync` 被沙箱拒 ⇒ 变异脚本写 **bash 逐项跑**；检查输出可能走 **stderr** ⇒ 用 `2>&1` 合并。
   ⛔ **负向结构断言必须过 `codeOnly()` 剥注释**（`guards/_ctx.mjs`）：注释里引用代码片段是本项目常态，
   裸 `!/xxx/.test(src)` 随时被注释顶成假红。欠账数由预检末尾的**守卫自检告警**报告（只报告不失败，逐步收敛），
   按**赋值来源**判定（⛔ 不靠变量名猜：`hardCode` 是「hard-coded」缩写，不是 codeOnly 产物）。


### 排查方法论（09-13 一整天弯路换来的，动手前先读）

> ⚠️ 完整版（含当轮的具体证据与六个反例）→ **`docs/TESTING.md` 的「排查方法论」**。要点：

1. **看到症状先别调阈值、别加条件** —— 先问「**有几个东西在写同一份状态 / 同一根滚动条？**」根因几乎总是两类：① 多个 owner 抢同一个东西；② 状态被提前/错位消费。**阈值从来不是根因。**
2. **先打点，再推理**。打点是第一动作，不是最后手段；打点要带数字（top/gap/pad/err），不要只写"到这里了"。
3. **测试必须跑到事件真正结束**（用户原话：「每次测试消息都不看完，你能发现什么bug，总是运行中就杀应用」）—— 长回合的毛病只在后段暴露。
4. **判据不能用会随渲染状态变化的量**：折叠组收起时 `innerText` 是空串（用 `textContent`）；侧栏按最近活动重排 ⇒ **会话要用标题点、不能用行索引**（用索引测出来的结论一半是假红）。
5. **状态重置要挂在「动作」上，不能挂在「某条渲染分支」上**（挂分支 ⇒ 分支被挡掉时清零也跟着跳过）。
6. **文档与代码同轮更新** —— 过时文档会主动误导下一轮（旧 AGENTS.md 描述过已删的实现，当天的弯路有一部分就是照它走的）。

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

## 验证基建实现细节 → `docs/TESTING.md`

**写新验收项 / 调试 e2e 时才需要查**，细节已整体外置。三条最常踩的：

- **E2E 靠主进程自带开关**：`CODEX_HARNESS_USER_DATA`（重定向 userData）+ `CODEX_HARNESS_DEBUG_PORT`（CDP 端口）—— ⛔ **别写行号**（搬过就失效），用符号 grep 定位。
- **测试实例工作区 = 项目根**（harness 用 `addScriptToEvaluateOnNewDocument` 注入 `localStorage.workspace`）；`new ElectronHarness({ workspace: null })` 可关掉。
- ⛔ **宿主环境变量必须摘干净**：`ELECTRON_RUN_AS_NODE`（不摘 = 启动即崩）、`NODE_OPTIONS`（不摘 = 窗口能开但功能全哑）、`CODEBUDDY_SAFE_DELETE*`。harness 已处理。

⛔ **现存验收项不在此列举** —— 要看清单就跑 `node scripts/accept.mjs --list`，要理解某项就读它的 `name` 与 `run(h)`（早期文档列过已删除的脚本，只会误导）。

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

> 功能变更轮次记录整体在 **docs/CHANGELOG-ROUNDS.md**（2026-09-24 首次拆骨：AGENTS.md 曾达
> 502KB、被截断到 13%；**2026-09-26 二次拆骨**：09-24/09-25 新堆回的历史小节再迁一次，
> 66,650 → 38,418 字节）。下面只留条目名/索引，细节查那边。⛔ **只增不回迁**。

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
- （09-24 下午 ~ 09-25 的详细记录已迁往 `docs/CHANGELOG-ROUNDS.md`，2026-09-26 二次拆骨；本处只留索引）
