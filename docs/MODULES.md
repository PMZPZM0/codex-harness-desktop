# 功能板块划分与接口规则（从 AGENTS.md 搬出，11-19）

> 这篇是**查阅型**文档：要改某个板块、加一个板块、判断该放哪一层时读它。
> 每轮常驻的 AGENTS.md 只保留一张板块总表 + 四条接口面契约，细则全在这里。
> ⛔ 内容与搬出前逐字一致（11-19 搬家，未改一字）。

> **写/改代码前先读 `docs/ARCHITECTURE-RULES.md`**（以实测现状为基准的规范条文：板块划分判据、四条接口面契约、新增板块 checklist、红线汇总）。
> ⚠️ `docs/ARCHITECTURE.md` 是 09-21 的**目标形态草案**（`registry.ts` / `defineFeature` / `Slot.tsx` / `lib/bus.mjs` 未落地；`gen-ipc-bridge.mjs` 已于 09-23 落地，见 ARCHITECTURE-RULES.md §0/§6），**冲突时以 ARCHITECTURE-RULES.md 为准**。
> ✅ **10-03 更新**：**主进程侧**的 `defineFeature` + `ctx` 容器**已落地**（`electron/context.ts` + `electron/ipc-host.ts`），并已加**域组合层**（`electron/composition.json` → `npm run gen:domains` → `composition.gen.ts`，守卫【252】【253】）。**P2 批次 1–7 已迁 13 个域**（queue-timer / clipboard / phone / updates / dataDir / history / work-logs / expert-market / soul-market / drama-canvas / pet / screenshot / favorites）：`inject: ["ipc"]` + `ipcHost.handle` + `ctx.effect` 摘 handler，`main.ts` 副作用域 import 26 → **15** 行。⛔⛔ **一个板块恒等于一个域前缀**（板块 = `features/` 下的一个顶层文件**或一个顶层目录**；样板 = `features/voice-ipc/`）。批次 8 已把"一个文件两个前缀"这条例外拆掉：`skillhub-markets-ipc.ts` → `expert-market-ipc.ts` + `soul-market-ipc.ts`，`screenshot-favorites-ipc.ts` → `screenshot-ipc.ts` + `favorites-ipc.ts`。**10 处历史欠账已于 10-03 全部拆完（56 个前缀，`07397e2`）**，守卫【253】⑥ 棘轮名单**清零为 0 行** —— 只许缩不许长，缩到 0 之后也**不许再长出来**（前半段 `grew253` 仍会捕获任何新增的多前缀板块）。【253】另有「表每行 `id` == 域文件 `defineFeature` 的 `id`」断言。⛔ 域仍可从 `electron` 取 `app`/`dialog` 等宿主能力（那是 P3 白名单的事），本阶段只把「注册通道」收进容器。**渲染层**的 `Slot.tsx` / `registry.ts` **仍未落地** —— 现状见 ARCHITECTURE-RULES.md §8。
> ⛔⛔ **09-29 用户点名的通用纪律**（细则见文档 §2.2）：**后续新增功能一律做成独立板块、留好拓展接口、并考虑后续维护与拓展** —— 不往既有域里"顺手加一块"；能力表/厂商表/类型表保持单一真相源；新增或修改时**同轮**同步它的每一处引用（守卫、文档、生成器、能力清单）。
> ⛔⛔ **10-07 挂载时机修正（事故后定死）**：组合层生成物**不在模块作用域自动挂载** —— 只导出 `mountEnabledDomains()`，由壳 `main.ts` 在 `app.setPath("userData")` **之后**用 `process.nextTick` 调用（守卫【253】②「生成物只导出 + 壳在 setPath 后调用」与【270】真跑「require 生成物本身 0 挂载」双层钉；`electron/compaction-watch` 同款）。两条实测事故：① 模块体先于壳句体执行 ⇒ 停用域判定读**默认目录**的 app-settings.json，读失败空对象进 **app-settings 进程缓存** ⇒ 用户全部设置静默失效（实测：自动压缩比例 0.9 从未生效，config.toml 恒为默认 0.6 的阈值 629146）；② 壳被域间接 `require`（`../main` 白名单依赖）时 `ENABLED` 表尚未赋值 ⇒ 同步调用 `exports.ENABLED is not iterable`（守卫真跑实测）⇒ nextTick 推迟到调用栈展开后。app-settings 缓存同时**按文件路径归属**（`cachedFor`）—— 任何"重定向前的读"不再污染重定向后的读。【159】钉缓存归属语句。
> 样板 = **AI 画布工作流**（`src/features/drama-canvas/`），它是五层全占的独立功能板块，见文档 §2.1。

最硬的六条（细则见文档）：
1. **分层依赖恒为** 壳（`App.tsx`/`AppView.tsx`/`main.ts`）→ 域（`features/<域>/`、`electron/features/<域>.ts`）→ 基座（`src/lib/*.mjs`、`src/components/`、`src/hooks/`、`electron/*.ts`）；基座不反向 import 域；域↔域只经 `app` / props / 对方 barrel，**禁深链内部文件**。
2. **三前缀同源**：目录名 = IPC 域前缀（`ipc-registry.ts` 的 `prefix`）= CSS 类前缀，全小写 kebab；`<域>:<动作>` 一个域多动作不加新前缀。
3. **新增功能：IPC 桥走 manifest**：`electron/features/<域>.ts` handler ↔ `electron/ipc-channels.manifest.json`（单一真相源）→ `npm run gen:ipc` 自动重生成 `preload.ts` / `vite-env.d.ts` 的 gen 段（**禁手改生成物**，漏一处由守卫【2】打红）；同时 `ipc-registry.ts` 记一行。
4. **渲染层收 `app`**（类型 = `HarnessAppApi`）按需解构，不当"几百个 props 的搬运工"；纯展示件 props ≤5；需要共享状态的页面组件**命名导出**（默认可 `lazy`），懒加载只在整页级、Suspense fallback 必须静态常量高度。
5. **状态只挂 bag**（新状态进既有 part 或新建 part，且同轮更新自动生成的 `bag-types.ts`，**禁手改**，守卫【93】）；真相源唯一（守卫【95】）；重置挂"动作"不挂渲染分支。
6. **改了就要留判据**：每新增一个域/接口，把该有的不变量补进 `scripts/guards/` 下对应域文件（可机器校验），并同轮同步本文与 `AGENTS.md` 的实测数字 —— **文档滞后 = 主动误导下一轮**（09-22 自检教训）。

**当前落点（实测值见 `docs/archive/REFACTOR-INVENTORY-2026-09-22.md` §10；行数口径一律 `wc -l`，别用 `split("\n").length`——后者多算 1 行；⛔ 09-22 自检教训：文档数字滞后会主动误导下一轮，每轮收尾必须同步本节）**：
- `src/App.tsx` **12 行**：仅剩 hook 调用 + earlyView 短路 + `<AppView/>`（组件体已全部落 `app-view/`）。
- `electron/main.ts` **1,184 行**（口径 `wc -l`＝数换行符、**含空行**；⛔ 10-03 自查纠错：此处曾写 **1,017**，那是 `Get-Content | Measure-Object -Line` 的「非空行」口径，两者差 197 行 —— 本项目已两次踩在"行数口径不一致"上）：剩 5 个 handler（theme + popout×4，已证不可搬；`ipcMain.handle/on` 实测计数 = 5）+ 启动链 + 模块级单例 + `import { mountEnabledDomains } from "./composition.gen"`（域挂载唯一入口；⛔ 10-07 起挂载在 `setPath(userData)` 之后 `process.nextTick(mountEnabledDomains)`，见上方挂载时机条）。**纯副作用 import 已 14 → 0 行**、含 `features/` 的 import 合计 23 行（组合表启用 **83 个域**，10-07 实测）。⚠️ 「副作用 import」与「含 features/ 的 import」是两把尺子，别混用。
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

### 🐾 桌面宠物（`src/features/pet/` + `electron/features/pet-*.ts`，2026-09-30 立）

一只浮在桌面的小宠物，状态跟着引擎事件走。**两种包格式并存**：

- **Petdex / 官方图集包**：`pet.json` + 图集；图集 **8 列 × 9 行**、每帧 **192×208**（v2 包 11 行，多两行 16 向）。
- **动画包（10-21 起内置主用，我们自己的格式）**：`pet.json` 的 `animationSet` 给九态各一对
  `animatedSrc`（30fps 动画 WebP）+ `stillSrc`（减少动效用），可选 `lookFrameSet` 16 向看帧，顶层 `fps: 30`；
  **没有图集**。渲染层按 `animationSet` 是否存在分流：动画包用 `<img>` 自己播（`<picture>` 在
  `prefers-reduced-motion` 回落静帧），图集包仍走 background-position 切帧，两套互不打架。
- **九态行名（顺序即行序，⛔ 不可重排/增删，两种格式同一套）**：`idle / running-right / running-left / waving / jumping / failed / waiting / running / review`。
- **四个宠物目录**（扫描面 = 协议白名单，单一真相源 `features/pet-ipc.ts` 的 `petRoots()`）：
  `dist/pets`（内置，随包）· `public/pets`（dev）· `<userData>/pets`（用户，可写）· `~/.codex/pets` + `~/.petdex/pets`（官方/Petdex 装的，只读展示、点「导入」才复制）。
- **内置六只全部是 30fps 动画包**：
  · **阿焰**（`harness-fox`，细毛小狐狸，**默认宠物**）：画布 **288×312**，整包约 5.3MB；
  · **阿糯**（`harness-mochi`，奶油猫）· **阿团**（`harness-tuantuan`，垂耳兔）· **阿柴**（`harness-chai`，柯基）·
    **阿栗**（`harness-lizi`，小熊猫）· **阿青**（`harness-qingtuan`，小龙）：画布 **256×277**，每只约 3.3~3.9MB。
  六只都是九态 `animationSet` + 16 向看帧（idle 带眨眼、头/尾巴分段运动）；源图在
  `scripts/pet-art/<slug>/`（六张姿态 + `pet-meta.json` 管显示名 / 尾巴方向 / 画布 / 补毛缝），
  `python scripts/gen-pet-animation-set.py <slug>` 生成到 `public/pets/<slug>/`。
  旧 SDF 三只（小墨 / 阿弦 / 小枢）及其 `gen-pet-sdf-animation.mjs` / `pack-sdf-animation.py` 已删除；
  `gen-pet-spritesheets.mjs` 只保留为 8×9 图集格式示例（`PETS` 为空）。完整制作教程见 `docs/PET-MAKING.md`。
  默认只改 `DEFAULT_SETTINGS.active` / 空值回落；用户档案里**显式选过**别的宠物不会被改写。
  ⛔ **必须落 `public/`（→ `dist/pets`），不能放 `src/` 让 JS import**：`before-pack` 的可达闭包只认 js/css 与 CSS 里的 `url()`，
  JS import 的位图会被判成陈旧死块删掉（v0.0.27 事故同型）；`dist/pets` 不在裁剪面内。
- **两个必须记住的坑（都踩过、守卫【232】钉住）**：
  1. ⛔⛔ **CSP 里 `*` 不覆盖自定义协议** —— `img-src * data: blob: file: harness-image:` **不够**，必须显式加 `pet:`，
     否则图集被拦成空白（症状：浮窗截图**全透明 0% 不透明像素**，而 computed style 里 url 好端端的 = 典型假绿）。
     与当年 `connect-src` 不放行 `data:` 导致 Pixi 贴图变白方块同型；**只在构建产物 + 真实 CSP 下暴露**。
  2. 浮窗（`?pet=1`）必须在**首帧前**摘掉启动页（`index.html` 内联脚本判定 + 内联 CSS `display:none`）——
     启动页是不透明白底，晚一步就在桌面上闪一块白。
- **架构落点**：主进程归约（`pet-state.ts`：引擎事件 → **每会话一条活动**，`waiting > running > failed/interrupted > completed→review`，旁听不改流向；completed 的**活动/气泡**保留到已看，但**宠物姿态只审阅 6s 就自动回 idle** —— 10-21 用户实测「运行结束宠物不刷新，要点打开箭头才刷新」，长期占着 review 会让宠物看起来卡住）→ 两个透明置顶窗（`pet-window.ts`，**都不登记 window-bus**，主窗口关时由 window-factory 显式关掉）：宠物 `?pet=1` + 活动气泡 `?pet=activity`（独立 320px，标题/状态/最近一句 + 打开/停止）→ `pet://` **窄口径**协议供图（只放行宠物目录 + 图片扩展名；
  ⛔ 不放宽 `harness-image` 的可信根，那是安全回归）→ 渲染层 `src/features/pet/`（`main.tsx` 按 `?pet=1` / `?pet=activity` 分流，
  ⛔ 不能进 `App()` 条件调用 `useHarnessApp` —— hook 调用序）。
- ⛔ **悬停工具栏的隐藏由主进程推 hover**（10-21）：窗口移出可交互矩形后会切成穿透，页面从此收不到 `pointerleave` ⇒ 工具栏会永久挂着；`pet-window.ts` 在光标轮询里把 inside 变化推成 `pet:hover`，浮窗用 `onPetHover` 收起。工具栏底部 42px **不参与看帧**（指针停在图标上切静态 look 帧会让宠物看着像冻住）。
- ⛔ **拖拽不要挂 `-webkit-app-region: drag`**（10-21）：drag 区属非客户区，渲染层收不到 pointermove ⇒ 做不了左右跑/竖向跳反馈，也放不下悬停工具栏。现走「渲染层指针捕获 → `pet:drag-*` → 主进程 setBounds」；拖动期间 `applyPetMouseState` 必须强制可交互，否则窗口跟随移动会被判穿透、丢事件。
- ⛔ **活动气泡贴「宠物本体」而不是窗口上沿**（10-22 用户截图「离得太远了」）：宠物窗 230×300，精灵在窗内还有 ~97px 透明留白；`positionPetActivityWindow` 必须用 `petInteractiveRect` 算头顶/中心，拖动与矩形上报时都要重排（否则气泡甩在原地）。⛔ **hover 重跑 effect 时不许上报 `petInteractiveRect(null)`**（只在卸载时发）——null 会让主进程把整窗瞬切穿透，用户正好这一帧按下左键就「拖不动」。
- ⛔ **活动气泡跟随当前会话**（10-22 用户「任务状态刷新慢、没有跟随会话」）：渲染层 `PetFocusBridge` 把 `thread?.id` 经 `pet:focus-thread` 报给主进程，`orderPetActivities` 把该会话顶到第一位（后台 waiting/running 保留）；切会话立即 `publish`，不等下一条引擎事件。**确认后的第一条新 item 恢复 running**（`clearWaiting`）——有些引擎版本不回 `serverRequest/resolved`，否则气泡永远卡在「等待你的确认」。
- ⛔ **e2e 必须排除宠物浮窗 target 整族**：宠物和活动气泡都是 page target，`harness._connect()` 取 `list[0]` 会随机连错窗口
  （实测症状：设置导航读到 0 项，看着像"设置页坏了"）。已在 `scripts/e2e/lib/harness.mjs` 里按 `pet=` 排除。
- 设置页 = 注册表一行一页（`pet` 页）+ `settingsNav` + `HelpDialog.OVERVIEW_GROUPS` **三处都要加**
  —— 少总览那处会被守卫【32】打红。

### 🧩 插件市场（`electron/codex-market.ts`，2026-10-01 二次换源）

数据源 = **Gitee 官方镜像**（`gitee.com/yuqiaodi/claude-plugins-official-gitee`，Claude Code
官方插件市场的国内镜像，48 个插件 100% `.claude-plugin` 兼容）。换源史：codex-marketplace.com
（国内访问不稳）→ SkillHub（9600+ 条，实测几乎全为 DeepSeek Harness 生态装不上，用户令换）→ 本源。
- list = `.claude-plugin/marketplace.json`（Gitee contents API base64，5 分钟缓存，客户端过滤分页）；
  install = git trees API（recursive）+ `gitee.com/{owner}/{repo}/raw/{branch}/{path}`（302 跳转，
  electron net 自动跟随）→ 写本地 marketplace → `plugin/install` + `plugin/list` 注册。
- ⛔ 守卫【239】：源锚定 Gitee 镜像、SkillHub 插件 API 与 DSH 探测分支不许复活。
- 分类中文名映射在 codex-market.ts 的 `CATEGORY_ZH`；UI 分类 tab 在 `helpers/catalogs.ts` 的
  `pluginMarketCategoryTabs`（两处要与 marketplace.json 的 category key 对齐）。

### 🧩 Codex 官方插件市场（`electron/codex-official-market.ts` + `features/codex-official-market-ipc.ts`，2026-10-03 立）

插件页的**第二个数据源**：GitHub `openai/plugins`（Codex 官方市场原档，**65 条**）。与上面的 Gitee 源是两个板块、
两套目录，插件页顶部源切换，**各用各的分类 tab**（Gitee 8 类 / 官方 10 类，key 不重叠）。守卫【254】【255】。

- 清单 = `.agents/plugins/marketplace.json`（65 条，只有 name/source/policy/category）+ `.agents/plugins/api_marketplace.json`
  （50 条子集 = ChatGPT 精选）。⛔ **简介与显示名不在清单里**，在各插件的 `plugins/<slug>/.codex-plugin/plugin.json`
  ⇒ 文案走生成快照 `electron/codex-official-catalog.gen.ts`（**禁手改**，重跑 `node scripts/gen-codex-official-catalog.mjs`）；
  中文名仍是手写表 `OFFICIAL_PLUGIN_ZH`（缺条目回落快照英文）。
- 下载 = `git/trees?recursive=1` 一次拿全 + 落盘缓存（`<市场目录>/.cache/tree.json`，6h）+ raw 逐文件（8 路并发）。
  ⛔ 镜像序 = **gh-proxy → ghfast → 直连**；前两个连 `api.github.com` 都能代理（未登录直连限 60 次/小时）。
- 落盘 = `<codexHome>/plugins/codex-official-market/plugins/<slug>` + marker `.codex-official.json`
  （**「已安装」的真相源**，同【245】口径）+ 本地 `.agents/plugins/marketplace.json`（照上游形态）
  + config 段 `[marketplaces.codex-official-market]` → 引擎 `plugin/install`（清单**文件**路径）→ 重启引擎。
- ⛔ **官方 65 条全部要鉴权**（ON_INSTALL 58 / ON_USE 7），其中 15 条还依赖 ChatGPT 应用连接器 ⇒ 每张卡片必须写
  `authNote`（「装了 ≠ 能用」）；3 条 `source` 指向外部仓库（CrowdStrike ×2 / Qodo）⇒ 只给查看来源，不给一键安装。
- ⛔ 62 个插件共 **51.13 MB** > 50MB 内置口径 ⇒ 不随包，按需下载；单插件最多 795 个文件 ⇒ `MAX_FILES` 不许退回 300。
- ⛔ 安装进度事件 type = `official-plugin-install`，**不与 Gitee 的 `plugin-install` 共用**（两源 slug 有重名：linear / github）。
- 渲染层 = `src/features/codex-official-market/`（自包含、本地 state，**不进 bag**；样板同 `component-library` 页）。
- ⚠️ **已知边界（与 Gitee 源同款，不是本轮新欠账）**：「已安装」管理列表只补引擎已认领的插件（part04 的 union 扫的是
  Gitee 目录）；官方源里**引擎没认领**的那批在本板块卡片上有 ✓ 与卸载，但不出现在下方「已安装」卡片区。
  补齐它要动 part04/part05 的 bag 分流（多一个市场维度），未经用户确认不擅自扩。

### 🖥 Windows 原生控件清单通道（`resources/tools/harness-uia.mjs` + `desktop-uia.ps1`，2026-10-04 立）

nuphus 的桌面定位是「截屏 → 本地 OCR → 像素坐标」，窗口挪动 / DPI 缩放 / 自绘界面就会失手。
本通道用 **Windows 自带的 UI Automation** 直接拿「控件清单」（元素类型、名字、AutomationId、矩形、
支持哪些动作），按**元素序号**操作，不猜坐标。守卫【273】9 条。

- ⛔ **是独立 MCP 服务器 `harness-uia`，不塞进 nuphus**：nuphus 是第三方预编译二进制，我们改不了它的工具面。
- 4 个工具：`desktop_ui_windows` / `desktop_ui_snapshot` / `desktop_ui_invoke` / `desktop_ui_set_value`
  （后两个是写操作，**必须显式 `confirm:true`**，与 `desktop_mouse` 同口径）。
- 注册判据 = **win32 + 桌面总闸开 + 两个随包脚本齐备**（`shouldRegisterUia`）；不注册就是整段不写、
  工具干净消失，⛔ 不复用 nuphus 的 `disabled_tools` 掩码（那套是为「一个服务器混装两组工具」准备的）。
- 三条通道的分工写进了 `desktop-automation` 技能与常驻指令：**原生应用走清单；网页与 Electron/Tauri 内容走
  `browser_*`（实测这类窗口的 UIA 树只有个位数元素）；清单拿不到才退回 OCR 坐标**。
- ⛔ 两个实测坑（守卫已钉）：PowerShell 按 GBK 写管道，**汉字尾字节可能是反斜杠或双引号的 ASCII 码**
  ⇒ 输出的 JSON 直接打断
  ⇒ `.ps1` 必须纯 ASCII 且强制 `[Console]::OutputEncoding` 为 UTF-8；最小化窗口的矩形是 `Infinity`
  ⇒ 原样写出就不是合法 JSON，坐标一律过 `Round-Geom` 归一。
- ⛔ `harness-uia.mjs` 拉起 PowerShell 只用**参数数组、不开 shell**（title/text 是外部输入 = 注入面）。

### 🖥 桌面自动化后端（11-13：agent-desktop 默认主；Nuphus / Computer Use 保留为可选兜底，守卫【274】）

用户决策（11-13）：**三个后端都保留，默认只开 agent-desktop**；另两个默认关，用户显式开启后参与兜底。
三者的优势与调用顺序（常驻指令 / 桌面技能 / 能力表三处必须一致）：

| 后端 | 优势 | 角色 |
|---|---|---|
| **agent-desktop**（Vercel Labs，Apache-2.0） | OS 无障碍树 + 语义 `@ref`，不截图不猜坐标；窗口挪动 / DPI 变化都不受影响 | **默认主后端**（原生应用 / 对话框 / 表单 / 菜单） |
| **computer-use**（open-computer-use，MIT） | 紧凑的 app state 控件清单 | 第二清单通道（Agent Desktop 不可用时） |
| **nuphus**（@nuphus/nuphus-mcp） | 截屏 + 本地 OCR + 像素坐标；另提供 `browser_*` 浏览器回落 | 像素兜底（画布 / 自绘 / 控件树残缺） |

- **agent-desktop 随包内置**：npm 包 32MB 自带六平台二进制，`scripts/prepare-{windows,mac}-tools.cjs`
  用 `agent-desktop@<tools-versions.agentDesktop>` 装进 `npm-global`；装完**只留目标平台**并补执行位
  （mac：本架构主程序 + `agent-desktop-macos-helper-darwin-<arch>`，约 4.5MB；Windows：win32 x64/arm64），
  其余平台/架构当场裁掉。⛔ mac 两条 npm 分支都不跑 agent-desktop 的 postinstall
  （x64 `--ignore-scripts` / arm64 只放行 nuphus）⇒ 二进制与 helper 必须由 tarball 自带 + prepare 补 `0o755`；
  before-pack / verify-packaged-tools 硬校验「启动器 + 本平台主程序（mac 还要 helper/执行位）」且不许残留别的平台二进制。
- **注册** = `[mcp_servers.agent-desktop]`（command = 随包 node，args = `[<launcher>, "mcp"]`）；
  上游 75 个工具（1.3.0 实测）**只保留核心 12 个**，其余写 `disabled_tools`（不占模型上下文）。模型侧实际走 CLI：
  `agent-desktop snapshot --app "<名>" -i` → `click @ref` / `type @ref` / `focus @ref` + `press return` /
  `scroll @ref --direction down --amount 3`（ref 只属于最近一次 snapshot；⛔ `press` 只收组合键、`scroll` 的方向是参数，别再写成 `press @ref ENTER` / `scroll @ref down`）。
- 关闭某后端后，常驻指令不再引导它的 CLI/工具；**Nuphus 关掉只掩 `desktop_*`，`browser_*` 永远保留**
  （未装 Ego 时的浏览器回落）；computer-use 关掉则整段不写。
- 三个开关在「设置 → 自动化 → 桌面自动化」与「控制台 → 通用 → 桌面自动化」读同一份 app-settings；
  默认值：`desktopBackendAgentDesktop !== false`、`desktopBackendNuphus === true`、`desktopBackendComputerUse === true`。
- 「开发工具 / 组件更新」里 `agent-desktop` 走 npm 国内镜像在线更新；桌面自动化卡片也带安装/检查更新入口。
- ⚠️ **mac 真机未验证**：agent-desktop 是裸 CLI + `agent-desktop-macos-helper`（不是 .app），
  **辅助功能授权的归属**（本应用 vs helper）与签名/公证、Gatekeeper 放行只能在 mac 上跑出来；
  首次调用失败先看「系统设置 → 隐私与安全性 → 辅助功能」里有没有本应用/helper 并授权。
  产物层硬校验见 `scripts/verify-packaged-tools.cjs`（主程序 + helper + 执行位 + 无外平台二进制）。

### 🔁 RPA 配方（`rpa_save` / `rpa_run`，11-13 补齐，守卫 12bn）

「设置 → 自动化 → RPA 自动化」= 把跑通的自动化流程存成**人话步骤**，下次按名字交给模型逐步复现。

- 模型工具：`rpa_save`（同名 **upsert**，不重复新建）、`rpa_run`（不传 name 列清单；按 name 执行，**只认唯一匹配**）。
- 两种执行：**文本配方**把 steps 回给模型逐步复现；**键鼠录制配方**（带 `actions`）由主进程原生回放，不经过模型。
- **键鼠录制（Windows + macOS）**：设置 → RPA 自动化 →「开始录制」→ 操作目标窗口 → 停止（Windows `Ctrl+Alt+F9` / macOS `⌘⌥F9`）→ 命名保存。
  Windows 走系统 PowerShell 轮询，macOS 走随包 Swift helper（CoreGraphics；构建期 `swiftc` 编译，用户不装 Xcode）；
  回放停止 Windows `Ctrl+Alt+F10` / macOS `⌘⌥F10`，坐标按录制分辨率等比缩放。⛔ 录制会记录键盘（可能含密码/验证码），只存本机；
  中文输入法逐字回放不可靠、滚轮暂不录制；mac 首次要授权「输入监控」（录制）+「辅助功能」（回放），授权后仍失败就重启应用。
  ⛔ 配方记录 `recordedOs`，按键码/坐标不跨平台；别的平台录制的一律拒绝回放。
- **定时**：RPA 页每条配方可设「每天 / 每周 / 一次性 / 关闭」，复用「设置 → 定时任务」的调度器；
  录制配方到点由宿主**原生回放**（不依赖模型，应用需保持运行），文本配方到点由模型在会话里按步骤复现；
  删除配方会级联删除它的定时任务。⛔ 后台回放要求录制里有目标应用（focus/target），否则拒绝盲点。
- 模型工具 `rpa_schedule`（daily / weekly / once / off）用于设置/取消定时。
- 状态只在**回合/回放结束**回写（`turn/completed` 或播放器退出码；失败/中断记 failed），并刷新设置页的「上次成功 / 运行次数」。
- 通道：`rpa:list / save / delete / run-result` + 录制 `record-start/stop/recorder-state/record-discard` + 回放 `play-start/play-stop`（⛔ 运行结果不是 `record`）；落盘 `<userData>/rpa-recipes.json`。
- 步骤格式 / 何时保存 / 失败处理 = 内置技能 **`rpa-recipes`**（`skill-discipline` 已点名）；设置页空态不再声称「自动沉淀」。
- 守卫 `12bn-rpa-recipes` + 验收 `rpa-recipes` 钉住工具注册 / 分发 / 回合结算 / 去重 / 通道 / 技能。

### 🎨 前端开发（`ui-sketch` 板块 + `sketch://` 协议，2026-10-05 立；两轮改名：界面草图 → 手机前端UI → 前端开发；10-06 起画布 = 上游 + 本仓组件补丁层，守卫【283】162 条）

把开源 **m3e-canvas**（Material 3 Expressive 屏摄画布，MIT）嵌进应用：侧栏「···更多」开一整屏的界面画布，
**手机 / 电脑 / 网页**三种形态都能拼（手机屏 412×892；电脑屏显式 1280×800；`platform` 选 android/web），
摆好的界面可一键预览、直接变成前端提示词。要点如下：

- ⛔ **上游源码 + 本仓补丁层**（10-06 用户：「3800个组件你从中调一些常用的组件做成图里面这些组件啊，
  现在默认组件太少」）：组件面板与 kind 体系写死在上游，加组件必须改上游源码 —— 做法是
  `scripts/sketch-fork/build.mjs`：克隆上游到 `.workbuddy/tmp`（源码**不进仓**）→ checkout **钉死提交**
  （PIN 在 build.mjs，与 `public/sketch/CANVAS-BUILD.json` 的 `fork` 字段同源）→ 拷贝 overlay
  `scripts/sketch-fork/extra-kinds.tsx` → **29 处锚点唯一的定点补丁**（tokens/i18n/prompt/M3Node/PartInspector/agent.md）→
  `next build` → `build-sketch-bundle --from` 出货。比官方 36 种多 **8 个常用组件**（`avatar` / `skeleton` /
  `rating` / `tooltip` / `expansionPanel` / `segmentedButton` / `stepper` / `timeline`，从 3800 组件库里挑的常用类型）。
  ⛔ 上游更新 = 换 PIN 重跑（锚点失配**当场报红**，不许静默套用）；加组件 = 改 overlay + 补锚点 + 重跑。
  ⛔ 产物仍只能落 `public/sketch/`：`clean-dist.mjs` 每次 check 会 `rmSync(dist)`（手放 dist 必丢），
  而 `before-pack` 的可达闭包只走 `dist/assets` ⇒ `dist/sketch` 天然不被裁（同 `public/pets` 口径）。
- **刷新产物** = `node scripts/sketch-fork/build.mjs`（全程一条龙；`--no-ship` 只到 out/ 调试补丁用）。
  它内部调 `node scripts/build-sketch-bundle.mjs`：剪掉 GitHub Pages 死文件、**把两个 Google Fonts 本地化**、
  把 `scripts/sketch-bridge.js` 内联进 `index.html`。只改了桥时：`node scripts/build-sketch-bundle.mjs --bridge-only`。
  ⛔ 字体必须本地化：Material Symbols 是这套 UI 的**全部图标**，外链取不到时图标退化成 `home` / `add_circle` 这样的**单词**，看着就是坏了。
- `sketch://` 协议（`electron/sketch-protocol.ts` 声明口径 + `boot.ts` 注册 handler）：根**恒等于打包内 dist/sketch**，
  扩展名白名单，越界 403、越类型 415。⛔ 不复用 `harness-image`/`pet`（那两个只放图片扩展名，放宽它们 = 扩大任意文件读取面，安全回归）；
  ⛔ 不用 `file://`（产物里资源引用全是绝对路径 `/_next/…`，file:// 下会解析到文件系统根）。
  `standard: true` 让 `sketch://app` 成为标准 origin（绝对路径解析与 `frame-src` 匹配都靠它）；
  `secure: true` 给 `navigator.locks` —— 上游用它做"同一份草图只允许一个可写实例"的单写者锁，非安全上下文里这个 API **直接不存在**
  ⇒ 静默降级（同 pet:// 的 CSP 事故同型，最难发现的那类）。
- ⛔ **CSP 的 `frame-src` 必须显式加 `sketch:`**：`*` 不覆盖自定义协议（`index.html` 里已写成纪律），漏写 = iframe 静默空白。
  这条链六个接缝（侧栏按钮 → bag 开关 → AppView 挂载 → 协议 → CSP → 产物+桥），**每一个都能在 tsc 与预检全绿时白屏**
  ⇒ 验收项 `ui-sketch`（10-06 轮重写为三形态探针）真跑「桥握手成功」（`data-bridge="ready"`）+ 写回往返（⑦真实上游接受分享哈希 / ⑧摘要变「2 屏 / 2 部件」= 手机屏 + 电脑屏 + platform web 真落盘 / ⑨一键预览点到真键 / ⑩原样还原）：
  跨源 iframe 读不到 DOM 也读不到存储，握手与回执是唯一可观测判据。
- **读写通道 = `scripts/sketch-bridge.js` + postMessage**（构建时内联进产物的 index.html）：读 = 桥把草图同源的
  `localStorage["m3e:doc"]` 回传宿主（宿主据此显示「N 屏 / M 部件」、复制 JSON、合成任务）；**写回只走上游自己的导入通道** ——
  桥把文档编码成它的分享哈希（`#docz=` = deflate-raw + base64url；无 CompressionStream 回落 `#doc=`）挂 `location.hash`
  → 上游 `hashchange → arrive()` 落盘（有校验、可 Ctrl+Z 撤销）。⛔ 桥自己从不 `setItem/removeItem` —— 直接改存储
  会绕过上游校验与撤销栈（【283】静态断言 + VM 真跑两处都钉）。
- **Codex 侧两个 dynamicTool**（10-05 立；两轮改名，用户点名「涉及手机前端开发能主动调用这个工具」+「手机电脑 网页前端UI都有」）：
  `frontend_get_doc` / `frontend_apply_doc`（注册 part08 → 分发 part05；窗口没开自动开 + 等桥就绪 ≤15s）。
  写侧先过**上游同口径**前置校验（`validateSketchDoc`：kind 44 种 / variant 5 种 / 必填字段，口径抄自上游 bundle 的
  `fL`/`fz`/`fE`/`fT` + `lp`/`sZ` 两张表，守卫再从产物原文提取枚举逐字对账），失败不打开窗口、回中文原因；
  回执以桥的 `load-doc-result` 为准（没有回执不算成功）。渲染层 `sketch-session.mjs` 是唯一的就绪态与在飞请求持有者
  （弹窗 attach/feed；串行队列防两次 hash 写入互踩；StrictMode 重挂载不误杀在飞请求）。
  ⛔ 配套**常驻指令第 13 条**（`electron/developer-instructions.ts` 的 `FRONTEND_CANVAS_INSTRUCTIONS`）与工具同在 ——
  做手机 / 电脑 / 网页界面时明确让模型先 `get` 再在文档基础上 `apply`（工具在表里模型不主动用 = 白配，同第 12 条纪律）；
  工具描述**列全 44 种 kind 名字**（守卫钉住"一个都不许缺"），字段级说明在组件手册技能里（见下条）。
  改名代价：旧会话要切走再切回才出现新工具名（dynamicTools 只在 thread/start 与 resume 注入）。
- **组件手册技能 `frontend-canvas`**（10-05 夜立、10-06 随补丁层扩到 44 种）：内置技能，44 种组件的
  字段速查（含 `bottomSheet` / `datePicker` / `timePicker` / `carousel` 这四种上游 agent.md 没写的，
  以及补丁层新增的 8 种）+ 手机 / 电脑 / 网页三形态 + 导航/主题/坐标/自查清单；`ensureBuiltinSkills` 落盘，指令第 13 条点名它。
  ⛔ 组件面板的**新增**只能走补丁层（改 `scripts/sketch-fork/` 重跑构建）——宿主侧不许自造第二条组件通道。
- **一键预览**（10-05 夜，用户：「加一个对话框预览这个UI界面」）：弹窗头部「预览」按钮 → 桥**代点上游工具栏的
  play_arrow 键**（图标 ligature 是语言无关锚；跳过 disabled / 隐藏键）→ 上游自己的交互预览（点按跳转 / 滑动返回 /
  ESC 退出）在弹窗里全屏播放；桥回 `preview-result` 回执、宿主状态条同步。⛔ 预览界面是上游渲染的，宿主不造第二层；
  ⛔ 预览路径不碰存储（【283】VM 用例 D + 验收 ⑫ 真跑回执）。
- 10-05 做过一版"把组件库控件送进草图"，用户实测后判「跟左边那些不适配，加进来没啥用」⇒ 整块撤掉，
  守卫【283】留两条负向断言防复活（弹窗里不许出现组件库面板 / 纯函数层不许残留写入侧旧实现）。
- ⛔ **界面弹窗里不要再塞并排面板**（同一条用户反馈）：iframe 必须占满整块主体，并排会把画布挤到 ~910px，
  它自己的浮动工具栏就摆不下、右上角控件互相遮挡。标题与动作也合成一行，别多一条工具栏。

### 📚 Uiverse 组件库（`electron/features/uiverse-library.ts` + `src/features/component-library/`，2026-10-01）

组件库的唯一数据源 = `src/lib/ui-skin/data/*.gz` + `src/lib/ui-skin/catalog.gen.ts`（ingest：`scripts/gen-ui-skin-library.mjs`；⛔ 不复制第二份）：

- **独立设置页「组件库」**（`component-library` 域）：浏览全部 11 类 3802 个组件，点卡片看 HTML+CSS 原文、一键复制（`writeClipboard`），给用户开发别的软件用。加载失败必须可见（`comp-lib-error`，⛔ 不许静默空白）；代码视图用 `<pre>` 文本节点（⛔ 不用 innerHTML）；预览走 `components/SkinHost`（Shadow DOM 隔离，只 preview 禁交互）。
- **Codex 引擎查询工具**：内置 MCP（harness-dispatch）的 `ui_component_search` / `ui_component_get`（定义在 `dispatch-core.ts`，执行端 `dispatch-rpc.ts`，数据端 `uiverse-library.ts` 从 `dist/assets/<Cat>.html-*.gz` 前缀匹配定位、dev 回落 `src/lib/ui-skin/data/`）。⛔ 模型侧常驻指令第 12 条（`UI_COMPONENT_INSTRUCTIONS`）必须与工具同在——工具在表里模型不知道 = 白配。
- ⛔ **个性化皮肤已整体删除**（10-01 用户令；09-30 首版单品散绑 → 10-01 套装化 → 当天删）。守卫【234】是负向断言防复活（皮肤文件 / 换肤分支不许回来）；其中「胶囊开关全仓统一走共享 ToggleSwitch」一条与皮肤无关，**独立有效**（新开关不许写散装实现）。localStorage 旧状态由组件库页模块体清理（`ui-skin-state-v2` / `ui-skin-bindings-v1`）。
- 守卫【235】7 条钉住组件库全部接线。

### 🎨 设计参考库（awesome-design-md；`electron/design-md-library.ts` + `features/design-md-ipc.ts` + `src/features/design-library/`，11-15 立）

用户给了 <https://github.com/VoltAgent/awesome-design-md>（84 份真实网站的品牌 DESIGN.md，Google Stitch 格式：YAML tokens + 主题/排版/组件/布局/Do&Don't/响应式/迭代指南，MIT）：

- **数据随包**：`resources/design-md/library.json`（生成物，`node scripts/sync-design-md.mjs --force` 从上游**整包 tarball** 重建，镜像序 gh-proxy → ghfast → 直连；⛔ 不逐个打 GitHub API —— 匿名配额 60 次/小时，84 份一次就耗光）+ `LICENSE` 原文。上游 README 漏列的 `slack` 由脚本 EXTRA 补齐（84 份完整）。打包走 `build.files` 的 `resources/design-md/**`（⛔ 不另占 extraResources，同一份数据不重复打包）。
- **三类出口同一份实现**：Codex 工具 **`design_md`**（`list` / `search` / `get`，走 `harness_tools` 网关；常驻指令**第 20 条**只在工具表里有它时才引导）、设置 → 能力与内容 →「**设计参考**」页（`design-library`：搜索 + **分类下拉** + 卡片分页；详情**默认中文导读**（由 tokens 自动生成：中文一句话 + 字体家族 + 字号层级表 + 按用途分组的中文色板 + 圆角/间距 + 各组件的底色/文字/圆角/内边距），可切「英文原文」看完整 DESIGN.md；**展示中文、复制 / 导出 / 交给 Codex 一律英文原文**；导出目标可选当前项目 / 其它项目 / 自选目录）、内置技能 **`design-md-library`**（+ 中文导读）。
- **导出落点** = `<项目>/design-references/<slug>.md`，⛔ 不覆盖项目根 `DESIGN.md`；「交给 Codex」= `bag.setPrompt` 填进输入框，**不自动发送**（避免误触发一轮）。
- ⛔ **合规**：MIT 原文与版权头随包；只作**风格参考** —— 不复制品牌 logo / 商标 / 图片 / 专有字体，生成界面不冒充官方。工具描述、技能、页面文案、`THIRD_PARTY_NOTICES.md` 四处都写明。
- 判据：守卫 **`12bs-design-md`（74 条：数据真值与中文导读全覆盖 / 同步脚本来源 / 三通道 / slug 白名单 / 工具+指令+技能 / 页面五处注册 / 中英文预览与色板分组真值表 / 分类下拉与导出项目选择 / 打包与合规）** + 验收 **`design-library`（8 条：84 份加载（中文导读 + 分类下拉）/ 搜索 / 中文导读色值 / 英文原文页签 / 复制回执 / 导出目标可选 / 真导出 / 交给 Codex 填输入框）**。

### 🖼 PhotoCraft 专业图像后期（`electron/photocraft.ts` + `features/photocraft-ipc.ts`，11-15 立；11-17 改 Launcher 安装）

用户给了 <https://github.com/storytold/photocraft>（纯 Rust 的开源 Photoshop 重写，MIT/Apache-2.0，7.9 万星）问怎么用。三条出口（P1 工具 / P2 MCP / P3 GUI）：

- ⛔⛔ **安装归 Craft 全家桶的 Launcher（11-17 用户令：「跟其他应用一样那个软件安装，这边负责识别联动」「不要直接下载安装」）**：宿主**不再**下载 release、不再解压到 `tools/photocraft`。CLI / GUI 路径来自 `artcraft.ts` 的安装扫描（`installedCraftApp("photocraft")`，Launcher 装在哪都能认）；老安装目录只作兜底。入口与其它 App 同一层级 3 弹窗（`ArtCraftSuite`），⛔ 没有独立安装卡（`PhotoCraftCard` 已删除），工具名仍是 `photocraft`（不改成 `craft_photocraft`）。
- **工具 `photocraft`**（7 动作）：`status` / `commands`（500+ 命令可发现）/ `info` / `run`（按序执行 ≤20 条命令）/ `convert` / `batch`（整目录）/ `open`（原生窗口）。⛔ 命令 id 走白名单正则、参数 ≤8KB/条；文件必须落在可信根或 `userData/photocraft-io`；**输出不得与输入同路径**（不覆盖原图）；一律 `spawn` 参数数组、不开 shell。
- **MCP 连接器（P2）**：检测到才写 `[mcp_servers.photocraft]`（headless CLI，`--no-gpu`，读/写根都限 `userData/photocraft-io`），由 `custom-model-apply` 统一生成。⛔ 引擎 0.157 会**延迟暴露 MCP 工具** ⇒ 主路径永远是上面的动态工具；MCP 只作高级命令面。
- **GUI 编辑（P3）**：图片产物卡右上角「在 PhotoCraft 中编辑」→ `photocraft:open` 启动 Launcher 装的 GUI（mac 若只装了 CLI 会提示去装 App）。⛔ 不嵌入 Electron、不重写它的界面。
- ⛔ **许可/边界**：只识别官方发行物；不重打包、不冒充 ArtCraft 官方。项目 early alpha：命令 id 与参数随版本变化，升级由 Launcher 管。
- 判据：守卫 **`12bt-photocraft`（35 条：不自行安装 / Launcher 路径解析 / 可信路径 / 不覆盖原图 / 命令白名单与参数上限 / MCP 段 / 工具+指令+技能+弹窗 / 图片入口 / 许可）** + 验收 **`photocraft`（三级入口 / 与其它 App 同一弹窗 / 状态与路径闸）**。

### 🧰 Craft 全家桶（`electron/artcraft.ts` + `features/artcraft-ipc.ts` + `src/features/settings-devtools/ArtCraftSuite.tsx`，11-16 立）

用户问「photocraft 是不是还有几个配套开源」⇒ 查明是 ArtCraft 的 **Craft App Suite**（`storytold` 组织，**19 个 App = 17 个官方 + 2 个社区**，全部 Apache-2.0 可商用）：PhotoCraft 图像 / LightCraft RAW / FilmCraft 视频 / EffectCraft 动效 / AniCraft 2D 动画 / VectorCraft 矢量 / FigCraft 原型 / DesignCraft 版式 / DeckCraft 演示 / WordCraft 文档 / GridCraft 表格 / PdfCraft PDF / CADCraft CAD / SoundCraft 音频 / MaterialCraft 材质 / TextureCraft 贴图 / Craft Anything + 社区 SolidCraft / MailCraft。每个 App 都有独立 Windows portable zip + MSI + CLI 构建，整套装齐约 **1.36GB**。

- **UI = 三级弹窗**（用户令「开发工具界面一个 Craft 全家桶，弹窗里面细分到每个点击在一个弹窗」）：层级 1 = 开发工具页唯一的「Craft 全家桶」卡；层级 2 = `ArtCraftSuite`（启动器安装/更新/卸载 + 每个 App 独立的 Codex 工具行 + 19 个 App 网格）；层级 3 = 每个 App 一个弹窗（安装状态 / 能做什么 / 怎么用 / 独立工具名 / 来源）。PhotoCraft 那一层**直接复用完整 `PhotoCraftCard`**。⛔ `artcraft-apps.ts` 是 App 目录的单一真相源（id/仓库/官网/主题色/中文功能点均对照 Launcher 自带目录）。
- **工具按 App 拆开**（11-16 用户令「跟 PhotoCraft 一样，都单独」「工具都拆开」）：每个**已装且带 `-cli.exe`** 的 App 各自一条 `[mcp_servers.<id>]`（无头 CLI `mcp` 子命令）+ 一个独立 dynamicTool `craft_<id>`（status / commands / info / run / convert / open），执行端 `artcraft:run`。⛔ 不再走「一个统一网关」；没有已装 App 就整段不写，App 卸载后其段按 `userData/artcraft-mcp-servers.json` 账本清掉。
- **联动（装完有反馈）**：主进程扫描 Launcher 安装目录得到已装列表 + exe 版本；弹窗开着每 2.5s 轮询 + 回前台立刻刷新 ⇒ 在 Launcher 装完回来就显示「已安装 vX」；已装名单变化时**自动重写 config**（新 App 自动接上，不用手点）。
- ⛔⛔ **安装位置不是固定的（11-17 用户实测「别的电脑装完完全识别不到」）**：扫描面 = 已知 App 名（`CRAFT_APP_IDS` ∪ Launcher 目录缓存的 id）+ Launcher **自己记录的** `install_locations`（`ArtCraftLauncherData/data/app.ron` 的 root/per_app）+ `%ProgramFiles%` / `%ProgramFiles(x86)%` / `%LOCALAPPDATA%\Programs` / `%LOCALAPPDATA%\ArtCraft` / `%APPDATA%\ArtCraft` / `%ProgramData%\ArtCraft` / Launcher 旁边；容器目录再下一层。⛔ 仍识别不到时用 **`artcraft:pick-root`** 手动指定安装目录（落 `<userData>/artcraft-root.json`，「自动检测」一键恢复）；status 回传扫过的根与自定义位置，界面写明「已扫描 N 个目录」。 **macOS**：App 是 .app 包（/Applications 与 ~/Applications）⇒ 扫描时去掉 .app 后缀认名字、可执行文件取 Contents/MacOS、*-cli 无后缀也认、版本读 Info.plist；Launcher 本身在 mac 不代装（官网 .app），只识别并带系统代理（scutil --proxy）直启 Contents/MacOS。 ⛔ **Launcher 自己下载 App 慢（实测 1MB/s）时**：它用 ureq、只认 HTTPS_PROXY / ALL_PROXY 环境变量（Windows 不读 WinINET、macOS 不读 SystemConfiguration；mac 走 scutil --proxy，.app 必须直接 spawn Contents/MacOS 才会带上）⇒ artcraft:open 会把 Windows 系统代理翻译成环境变量注入（没有就不加），status 回报 proxy 并在「打开 Launcher」行写明；⛔ 别在宿主里自己下 App（用户令）。⛔ 不要退回「只认 Program Files\ArtCraft 两个死目录」。
- 每个 App 的 MCP 段登记为 harness 所属（`ownedMcpServers` 收当前 + 上次名单 + 清 override）；卸载 Launcher 会摘掉全部 App 段并重启引擎。⛔ 不冒充 ArtCraft 官方。
- 判据：守卫 **`12bu-artcraft`（86 条：安装链 / 五通道 / 安装位置识别与手动指定 / 按 App 拆分 MCP / 联动轮询与自动同步 / 三级弹窗 / craft_<id> 工具接线 / 目录与文案条数一致 / 许可）** + 验收 **`artcraft`（三级弹窗真点 / 已装联动 / artcraft:run 执行端 / 状态通道）**。
- **产出文件按格式打开**（11-16 用户令「跟 PhotoCraft 一样」）：`src/lib/craft-openers.mjs` 是格式→App 的单一真相源（只写官方文档确认过的扩展名；顺序即优先级）；产出文件卡的「打开方式」下拉、文件卡右键菜单与媒体产物卡（图片/视频/音频）只对**已安装**的 App 显示「用 X 打开」，走 `artcraft:run` 的 `open`（spawn 官方主程序带文件，不开 shell）。⛔ 图片保留 PhotoCraft 专用按钮，不再重复列。
- **宿主只装 Launcher**（约 11MB portable zip：镜像序 + SHA256SUMS → `tools/artcraft-launcher/`，`GITHUB_UPDATEABLE.artcraft`，仅 win32）：19 个 App 的安装/卸载交给 Launcher 自己（UAC 与安装目录由它处理），⛔ 不代装不代卸；mac 是 `.app` ⇒ 不代装，只给官网指引。虽 <50MB 仍按需下载：它是第三方**应用分发器**，随包等于把外部 App 分发塞进安装包，且 mac/linux 资产形态不同。

### 🧑‍🤝‍🧑 工作伙伴群编排（抄 Pachat 的「先读再说 + 按需唤醒」，11-14，守卫 11f/12be/09）

工作伙伴群（`electron/features/harness-team-ipc.ts` + `electron/features/group-talk/` + `src/features/harness-team/`）的成员协作改成 Pachat 式的**确定性编排**，替掉原来的自由催办启发式（那类启发式正是「同一问题回两条 / 回得断断续续」的根因）。详细设计/取舍见 `docs/TEAM-GROUP-ORCHESTRATION-PACHAT-2026-11-14.md`。

- **先读再说（Phase 1）**：每成员各记**已读游标**（`electron/group-read-cursors.ts`，键 `群::发言身份 speakerId`、只前移、落 `group-read-cursors.json`）。每轮只把它**没读过的新消息**喂进 `buildTalkInput`（拼输入前快照 `readUpTo`，拼输入期间新到的留作下轮未读），读完推进游标；`group_read` 工具仍读「最近 N 条」（**故意不同**：一个是漏看的、一个是再看更多）。
- **去自由催办（Phase 1）**：⛔ `leadSelfNudges` / `leadTurnTaskLike` / `isInfoRequest` 已**整体移除** —— 谁说话由「被 @ / 被回复 / 工具结果回交」决定，宿主不再在「主理人没派活」时强催它一轮。团队推进靠 `mustHandBack`（成员产出/工具结果 → 回交主理人）+ 行首 @ 接力。代价（Pachat 同样接受）：主理人既不 @、不调工具、也不写「收口」，这一轮就到此为止。
- **持久预算 + 失败重试（Phase 2）**：`electron/group-run-budget.ts` 每成员每天最多跑 **100** 次（跨轮失控保护，与单轮 `canRun`/`chainBudget` 是两套）；成员一轮失败 ⇒ 隔 **5 分钟只重试 1 次**（每成员最多 1 次直到成功才重置；新消息开跑会作废旧重试；群已清空/删除则跳过；in-memory + unref、重启即丢）。
- **群治理（Phase 3）**：①**活跃度**（`src/lib/group-activity.mjs` 纯函数）接**群列表卡副行** `今日 N 人活跃`（⛔ 不进群头——11-08 用户把群头副标题当赘述删过）；②**群规矩** `rules` 字段每轮作为【这个群的规矩 · 必须遵守】独立注入（与「简介 memory」「记忆 memoryNotes」分开），设置页可编辑，通道 `harness-team:set-rules`；③**成员治理**（设管理员 `set-admin` / 移除 `remove-partner`）本已具备；④**群模板**（`src/lib/team-templates.mjs`，localStorage **无通道**）：群「···」菜单「存为模板」+ 建群弹窗「从模板新建」直接套用。
- **判据**：守卫 `11f`（协作判据真值表 + 先读再说接线 + 去催办负向 + 预算/重试 + 活跃度/规矩/模板真跑）、`12be`（催办移除负向 + 主链喂未读）、`09` 棘轮（harness-team-ipc / 04-team-group-view / 03-team-settings 按实测）。

