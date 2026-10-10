# AGENTS.md — Codex Harness Desktop 项目环境速览

本文件供 Codex 引擎读取：进到本项目（Codex Harness Desktop 桌面应用的源码 / 或本机运行环境）时，先读这里就知道「环境里有什么、缺什么怎么装、怎么调用」。保持简洁，详细手册见 `docs/TOOLCHAIN.md`（若存在）。

## 🔁 多仓协作与发版（**AI 协作者必读**：跨仓改动的同步、推送、PPcode 发版全流程）

完整步骤见 **`docs/REPO-WORKFLOW.md`** —— 要点：本仓（主应用源码）与 `D://PPcode`（= 私有仓 ppcode-src，PPcode 源码）同步走「主仓 diff → 逐文件 apply 预检 → 副本验证」；公开仓 `PMZPZM0/PPcode` 只放 PPcode 的 README 与安装包（应用内检查更新匿名拉它，⛔ 不放源码）；PPcode 发版 = 版本对齐 4 处 → mac 审计 → check → tag → CI 三端构建并跨仓发布；两仓 `AGENTS.md` 逐字镜像，改一边必须同步另一边。

## 📐 架构改造计划（2026-09-21 立项，**已基本完成**：计划与盘点存档见 `docs/archive/`）

目标：把 `src/App.tsx`（22,216 行 / useState ~500 / 导入 79 个文件）与 `electron/main.ts`（8,971 行 / 313 个 `ipcMain.handle` / 66 个前缀域）按**域**拆成模块树（`src/features/*` + `electron/features/*` + `electron/ipc-registry.ts`）。

**拆分期纪律（每批都适用，违反会直接红或埋雷）**：
1. **一批一提交**、每批 `npm run check` 必须绿，禁止长命重构分支（用户明确拒绝 fork/新分支绕开）。
2. **零行为变化**：DOM 结构 / class 名 / 可见交互一律不动（`accept.mjs` 的 CDP 选择器依赖它们）。
3. **IPC 桥走生成器**：`electron/features/<域>.ts` handler ↔ `ipc-channels.manifest.json`（单一真相源）→ `npm run gen:ipc` 生成 `preload.ts` / `vite-env.d.ts` 的 gen 段（**禁手改生成物**）；守卫【2】6 条逐字节盯一致性。
4. **断言跟着搬**：预检断言读的是**递归聚合面** —— `readAppUi()` = `App.tsx` + `src/features/**` + `src/lib/*.ts`；`readMainSource()` = `main.ts` + `electron/features/**`。所以搬运时必须同轮把对应断言改到新路径（一次搬一块、一次改一组，禁批量替换）；⛔ 聚合器**必须递归**，漏新目录 ⇒ 断言假红，只读单文件 ⇒ 守卫**静默恒真**（最危险）。
5. **判据**：搬组件时若需要新加 >5 个 props，说明它和 App 状态耦合仍太深 → 回退，等状态抽成域 hook 再搬。
6. 域目录按功能域拆（09-25 实测 52 个，其中 `settings-*` 26 个为设置页**按页同构拆分**，粒度稳定；09-25 新增 `team-office`（专家团办公室预览，用户立项；原「公司模式」独立菜单已按其要求收成专家团专属预览））；**不再无谓新增**：新增或合并域目录需用户点头；不引入全局 store（会**增加**耦合面）。
7. ⛔⛔ **一个板块恒等于一个域前缀**（板块 = `electron/features/` 下的**一个顶层文件**或**一个顶层目录**；正确样板 = `features/voice-ipc/`：3 文件、只有 `voice` 一个前缀）。多前缀的文件/目录**必须拆开** —— 用户 10-03 明确否掉了"一个文件塞两个前缀"（功能必须独立板块、不许巨型文件）。守卫【253】⑥ 是**棘轮**：欠账名单只许缩不许长，拆完一个就必须把它从名单里删掉（不删会红）。

## 🧩 「一切皆插件」改造方案（⛔ **待用户批准，尚未执行**，10-03 立）

参照物：**DeepSeek Harness**（`dsh`，2026-08-13 v0.1，MIT，底层 Cordis）。完整方案 = **`docs/PLUGIN-ARCHITECTURE-2026-10-03.md`**（现状基线 / 差距 / 四层架构 / 职责边界 / 7 阶段迁移 / 判据）。要点四条：

1. **内核不是从零建**：`electron/context.ts` + `ipc-host.ts` + 组合层已具备 Cordis 语义（`inject` 门禁、`Fiber.dispose()` 可逆副作用、半注册回滚）—— 缺的是**覆盖面**与**接缝 / 组合 / 渲染层**三块。
2. ⛔ **不能照抄 dsh**：Electron 有宿主特权边界 —— `app` 生命周期 / 窗口 / preload / CSP / 自定义协议 / 路径可信校验**必须留在内核**，插件化它们 = 安全回归（CSP `*` 不覆盖自定义协议、`harness-image` 可信根，均有实证事故）。内核 = 宿主绑定 + 安全强制 + 插件运行时。
3. ✅ **阶段 0 已完成（`07397e2`）**：10 处多前缀欠账（**56 个前缀**）全部拆成独立板块并**顺带插件化** —— 组合表启用域 **13 → 69**，守卫【253】⑥ 棘轮名单由 10 行**清零为 0**（仍会捕获任何新长出的多前缀板块）。`main.ts` 纯副作用 import **14 → 5 行**、行数 1214 → **1204**（`ipcMain.handle/on` 仍 = 5）。拆分中把**跨域共用**的辅助函数下沉到基座层（`connector-store` / `openai-vault` / `custom-model-store` / `skill-store`）—— 拆成独立板块后它们不能留在任一域的内部文件里。
4. ✅ **阶段 1–6 已批准**（10-03 19:35 用户「直接改完」，含三项拍板：新增顶层目录 / `bot` 系归一化 / 渲染层范围）。**按批推进中**：
   - **接缝层已建**（`5d9c236`）：`electron/runtime/seams/index.ts` 提供 `app`(38 域) / `secure`(14) / `shell`(12) / `dialog`(11) / `window`(6) 五条宿主能力接缝 + 原有 `ipc`。⛔ `protocol` 与路径可信校验**内核独占、不提供接缝**（协议白名单可替换 = 安全回归）。⛔ **不做 fs/path/crypto/child_process 的接缝化**——那是 Node 能力不是宿主绑定，真门禁是路径可信校验。
   - ⛔ **接缝必须在域挂载前 provide**：组合表生成物头部 `import "./ipc-host"; import "./runtime/seams";` 排在所有域 import 之前（顺序即契约，晚了 `ctx.get("host")` 得 undefined）。
   - **样板**：`features/remote-ipc.ts` 是唯一"只依赖 ipc"的老域，已改 `defineFeature`，照它办理其余。
   - ⛔ **守卫要等域改完再加**：此刻 59 个已插件化域里仍有 8 个用 `shell`、5 个用 `BrowserWindow`、1 个用 `ipcMain`，先加断言必然红。顺序：接缝层 → 改域 → 加棘轮守卫。

## 📐 功能板块划分与接口规则（现行有效，2026-09-22 立）

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

一只浮在桌面的小宠物，状态跟着引擎事件走。接入的是 **Codex 官方宠物格式**（实测自引擎二进制
`tui/src/pets/*.rs` + petdex 公开规范，两者逐字吻合）：

- **宠物包 = `pet.json` + 图集**；图集 **8 列 × 9 行**、每帧 **192×208**。
- **九态行名（顺序即行序，⛔ 不可重排/增删）**：`idle / running-right / running-left / waving / jumping / failed / waiting / running / review`。
- **四个宠物目录**（扫描面 = 协议白名单，单一真相源 `features/pet-ipc.ts` 的 `petRoots()`）：
  `dist/pets`（内置，随包）· `public/pets`（dev）· `<userData>/pets`（用户，可写）· `~/.codex/pets` + `~/.petdex/pets`（官方/Petdex 装的，只读展示、点「导入」才复制）。
- **内置三只自产**：`scripts/gen-pet-spritesheets.mjs`（零依赖 SDF 光栅化 + 自写 PNG 编码）→ `public/pets/<slug>/`。
  ⛔ **必须落 `public/`（→ `dist/pets`），不能放 `src/` 让 JS import**：`before-pack` 的可达闭包只认 js/css 与 CSS 里的 `url()`，
  JS import 的位图会被判成陈旧死块删掉（v0.0.27 事故同型）；`dist/pets` 不在裁剪面内。
- **两个必须记住的坑（都踩过、守卫【232】钉住）**：
  1. ⛔⛔ **CSP 里 `*` 不覆盖自定义协议** —— `img-src * data: blob: file: harness-image:` **不够**，必须显式加 `pet:`，
     否则图集被拦成空白（症状：浮窗截图**全透明 0% 不透明像素**，而 computed style 里 url 好端端的 = 典型假绿）。
     与当年 `connect-src` 不放行 `data:` 导致 Pixi 贴图变白方块同型；**只在构建产物 + 真实 CSP 下暴露**。
  2. 浮窗（`?pet=1`）必须在**首帧前**摘掉启动页（`index.html` 内联脚本判定 + 内联 CSS `display:none`）——
     启动页是不透明白底，晚一步就在桌面上闪一块白。
- **架构落点**：主进程归约（`pet-state.ts`：引擎事件 → 九态，旁听不改流向）→ 透明置顶浮窗（`pet-window.ts`，
  **不登记 window-bus**，主窗口关时由 window-factory 显式关掉）→ `pet://` **窄口径**协议供图（只放行宠物目录 + 图片扩展名；
  ⛔ 不放宽 `harness-image` 的可信根，那是安全回归）→ 渲染层 `src/features/pet/`（`main.tsx` 按 `?pet=1` 分流，
  ⛔ 不能进 `App()` 条件调用 `useHarnessApp` —— hook 调用序）。
- ⛔ **e2e 必须排除宠物浮窗 target**：它也是 page target，`harness._connect()` 取 `list[0]` 会随机连错窗口
  （实测症状：设置导航读到 0 项，看着像"设置页坏了"）。已在 `scripts/e2e/lib/harness.mjs` 里排除 `pet=1`。
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

### 🖥 mac 桌面自动化后端 open-computer-use（10-04 用户拍板，守卫【274】8 条）

用户决策：**mac 用 computer use 随包内置，Windows 用 nuphus**（+ 上面的 UIA 清单通道）。

- 数据源 = npm 包 `open-computer-use`（MIT，作者 iFurySt，是对 Codex 原生 computer use 的开源复刻）。
  包内**已带四平台二进制**（解包 ~13MB），`postinstall` 只打印安装提示 ⇒ CI 加 `--ignore-scripts` 也装得动。
- 装法照 nuphus：`scripts/prepare-mac-tools.cjs` 里 `npm install -g --prefix`，版本走
  `scripts/lib/tools-versions.cjs` 的 `computerUse`（⛔ 不许在别处写字面量，【274】钉着）。
  装完**裁掉 `dist/windows` 与 `dist/linux`**（mac 包里不该躺别的平台的二进制），并补 `Contents/MacOS/*` 执行位。
- 注册 = `[mcp_servers.computer-use]`，`command` 用**随包 node + 启动脚本绝对路径**、`args = [<launcher>, "mcp"]`。
  ⛔ 不能写裸命令名 `open-computer-use`：装进 `.app` 后 PATH 里没有它，会得到一个静默起不来的服务器。
- ⛔ **同一时刻只留一条真实键鼠通道**：mac 上把 nuphus 的 15 个 `desktop_*` 整组进 `disabled_tools`
  （`nuphusDisabledTools(switches, platform)` 的新参数），浏览器组照旧由 nuphus 提供。
  否则模型会随机挑一个后端，出错也分不清是谁。
- 「设置 → 开发工具」的**当前能力链路**按平台给唯一后端（mac=`computer-use-desktop`，win=`nuphus-desktop`），
  判据与 automation-policy 同源，【274】真跑 `resolveCapabilities` 比对两平台结论。
- ⚠️ **未经真机验证**：签名/公证与 Gatekeeper 放行、首次「辅助功能 + 屏幕录制」授权体验只能在 mac 上跑出来。
  产物层的三条硬校验（主程序存在 / 执行位 / 不残留别的平台二进制）已写进 `scripts/verify-packaged-tools.cjs`。

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

## 🎨 视觉规范（2026-09-26 立，守卫【170】）

> **改 UI 前先读根目录 `DESIGN.md`**（色板 / 字体 / 组件约定 / 主题机制，全部实测自 `src/styles/`）。
> 三个真相源的分工：`AGENTS.md` 管「怎么建」· `docs/ARCHITECTURE-RULES.md` 管「架构怎么划」· `DESIGN.md` 管「长什么样」。
> ⛔ 改了 CSS 变量必须同步 `DESIGN.md` 的变量表 —— 守卫【170】做的是**真值对账**（文档里的色值 ≠ CSS 真值会打红），不是检查"文件存在"。
> ⛔⛔ **加浮层前先查 `DESIGN.md` 的「层叠层级带」**（09-29 立，守卫【198】）：主界面 <30 < 设置内 backdrop 80~97 < **画布 90** < 全局模态 400 < 轻浮层 1000/1001 < toast 9999+。四条硬规则：轻浮层必高于模态遮罩、全局模态必高于画布、**画布专属弹层只能画布内渲染（不许 portal 到 body）**、画布根 backdrop-filter 会创建 containing block。

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

- **Codex 日志管理（09-29）**：设置 → 数据管理里的「Codex 日志」管的是引擎写的**会话记录原档**（`codex-home/sessions|archived_sessions/rollout-*.jsonl`，含对话全文），按项目（文件首行 `cwd`）→ 日期两级分组，可勾选批量删除 / 整库清空。⛔ **销毁性功能**：域内通道只认 `rollout-*.jsonl` 且必须落在那两个根目录内（越界/目录一律拒绝、不存在幂等）；删除时**级联剔除 `session_index.jsonl` 对应条目** —— 不剔就是会话列表里一堆打不开的死条目。守卫【200】12 条。

- **记忆后端二选一**（`docs/CHANGELOG-ROUNDS.md` →「记忆后端二选一」）：内置金字塔 ⇄ MCP 记忆**互斥**，同一时刻只用一个。⛔ 判定一律用 `effectiveMemoryBackend()`（**不是** `memoryBackend()`）：选了 mcp 但服务起不来 ⇒ **回退内置**（宁可回退也不能"一处都不写 = 丢记忆"）。`electron/memory-backend.ts` 是叶子模块，不许进 `runtime-refs.ts`。守卫【150】。
- **`electron/main/**` 零反向依赖**（同上 →「断环收尾」）：所有 `electron/main/*.ts` 不得 `import ... from "../main"`。路径常量走 `electron/runtime-paths.ts`（叶子）、单例走 `electron/runtime-refs.ts`；`from "../main"` 的**白名单**（守卫【132】，9 符号）与 `main/**` 历史引用上限（守卫【143】）都不许扩大。⛔ 新增守卫 **【147】** 用剥注释后的 import 图求 SCC，`runtime-refs` 与三个叶子不得在任何环里。**注释里写 `from "…"` 会被裸正则当成真 import** ⇒ 环检测器必须剥注释。
- **正文 Markdown：列表尾部的「结语行」**（同上 →「正文 Markdown 渲染」）：列表最后一项后紧跟顶格结语会被 CommonMark 判成 lazy 续行 ⇒ 渲染歪成 `<li>…<br/>结语</li>`。修法是 `softenListTailLazyContinuation`（`src/lib/markdown-blocks.mjs`，纯函数可跑真值表）。⛔ **围栏感知是必须的**：代码块（含流式未闭合 ```）内绝不能注入空行。另：行首/行尾的**全角空格 U+3000 不参与 HTML 空白折叠** ⇒ 会渲染出可见空白，由 `trimInvisibleSpace` 处理（只对非围栏行、不动行中间）。守卫【149】。
- **停止链路：委派场景不要挂"运行中"**（同上 →「停止链路」）：引擎报 `expected active turn id <X> but found <Y>` 时，宿主已结束、真实活跃回合是 Y ⇒ **按报错里的 Y 重试中断**；重试也失败 ⇒ **一律复位运行态**，绝不挂着让用户反复点。守卫【131】。
- **搜索 = 当前会话内**（同上 →「搜索改为『当前会话内』」）：顶栏 🔍 只搜当前会话（跨会话实现保留但不接 UI）。⛔ 开关必须复用 `bag.chatSearchOpen` **单一真相源**（Ctrl+Shift+F 也走它）。⛔ `collectMessageTexts` 必须用 `itemText(item)` 按 type 取字段 —— **userMessage 的正文在 `content[]` 里、`item.text` 为空**，只看 `item.text` 会让用户自己发的消息搜不到。守卫【146】。
- **更新检查的版本比较**（同上 →「审计报告遗漏项补修」）：`updates.ts` 用 `parseVersion`/`compareVersions`，⛔ 不许退回「字符串不等即更新」；stable 通道尊重 `prerelease`（**本地是预发布版时除外**，否则 beta 用户永远收不到更新）。守卫【144】。
- **守卫的「行为断言」要跑真产物**（同上）：`accelerator.ts` 与收藏夹的判据跑 `dist-electron` 产物（sanitizeAccelerator / acceleratorLabel / 收藏夹 add·删·clear），收藏夹用 `mkdtempSync` 临时目录、**不碰用户真实数据**（守卫【145】）。
- **办公室场景的遮挡顺序 = 显示器 → 桌 → 人 → 椅**（`docs/CHANGELOG-ROUNDS.md` →「办公室 v10」）：三件物体各按**自己的地面基线 y** 排 zIndex（桌 `v − DESK_DV/2`、椅 `v + CHAIR_DV`、人取座位点）；⛔ 合成一件 Graphics 必错（要么人只露头顶、要么椅子被整个人盖住）。地板纵深 / 行距必须满足 `行距 > 桌纵深 + 椅距`，否则**下排显示器会盖住上排的人**。角色是**纯黑动物剪影 + 彩色项圈**：物种靠耳朵外形（每个成员一种动物、CEO 狮子）、个体靠项圈色，两者都按序号**稳定派生**；⛔ 不加五官 / 描边 / 高光。跑腿目标坐标必须与 `drawAmenities` 的设施坐标**同源**。守卫【169】【176】。
- **办公室几何两个"放大才看得见"的坑**：① 等距块（`isoPrism`）**只画 4 个可见面、不画底面** —— 俯视下底面被自己的顶面遮住，但它的屏幕位置只比顶面低 `(z1−z0)·k`，画在最后会**盖住顶面上半** ⇒ 白桌面成一大片灰（当时把桌面渐变 alpha 从 0.019 调到 0.005 都不见效，根因就是它）。② 柜面上的物件（咖啡机 / 杯子 / 置物架）必须用 `counterTopY()` 按**柜体前面**定位；用 `wallPoint`（那是 **2D 墙面**坐标、基线恒在地板后边线）会让物件**浮在柜顶上方 39px**。守卫【169】有负向断言 + 变异验证。

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
6. **⛔ 每个功能/任务收尾都要跑一遍代码审查**（用户明令，**不是可选项**）。用 **`dongming-code-review`** 技能
   （随包在 `resources/expert-skills/dongming-code-review/`，源自 alibaba/open-code-review；⛔ 旧文档里写的
   `open-code-review` 在本机**加载不到** —— 10-08 实测，按那个名字找技能会扑空，故更正）。
   **审查对象是本轮 diff**（不是全仓库）；**问题当轮修掉再提交**；**结论要能说出依据**。
   改动极小可走轻量路径并说明为何轻量，但**不许因"改动小"跳过**（历史真 bug 全出在"看起来只是小改"的地方）。
   四条自查判据（**完整版 → 技能 `dongming-code-review` §2/§6**）：
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

> ⛔ **50MB 口径（10-01 用户定稿）**：**下载体积 ≤50MB 的工具一律随包内置**（装机即用）；
> 只有大件与浏览器内核留在「开发工具」页按需下载。改内置清单必须三处同步：
> ① `package.json` 的 `build.extraResources` ② `scripts/prepare-windows-tools.cjs`（win 构建期现造）
> ③ `scripts/prepare-mac-tools.cjs`（mac 构建期现造）。守卫【29】按 extraResources 逐条比对。

**内置（builtIn=true，11 项）**：引擎本体 · Node.js · VS Code CLI · Nuphus 桌面自动化 ·
Playwright 浏览器自动化（CLI）· ponytail 写代码模式插件 · **Python（完整版，自带 pip + Tkinter）** ·
**ripgrep** · **uv** · **CMake** · **7-Zip CLI** · **jq** · **Ninja** · **yt-dlp** · **Android 平台工具（adb）**
（后 9 件为本次按 50MB 口径新纳入；打包靠上面两个 prepare 脚本现造，CI 干净检出必然命中）。

**按需下载（>50MB / 内核）**：PowerShell 7（282MB）· Git（90MB，缺了首启自动补装）·
FFmpeg（307MB）· Miniconda（100MB）· MinGW（267MB）· Playwright 内核（170MB）· Cloak 内核（200MB）。
全部走国内镜像优先、失败自动回落官方源。

| 能力 | 入口 | 说明 |
|---|---|---|
| 引擎本体 | `app-server --listen stdio://` | 会话、工具、插件、钩子、技能全部走它 |
| 基础运行时 | `resources/tools/{node,python,git,pwsh,vscode-cli,rg,uv,cmake,ninja,sevenzip,jq}` | 开发机本地保留；**打包后仅 node/vscode-cli 内置**，其余开发工具页按需下载（缺 Git 启动自动补装） |
| 桌面自动化 MCP | `tools/npm-global` 里的 `nuphus`（MCP 服务器名） | 需先装「自动化工具包」，工具前缀 `desktop_*` / `browser_*` |
| 浏览器自动化 CLI | `tools/npm-global/playwright-cli` | 需先装「自动化工具包」，首次 open 会提示装内核 |
| 指纹浏览器 | `require("cloakbrowser")` / `tools/npm-global/cloakbrowser` | 需先装「自动化工具包」+「Cloak 内核」 |
| 内置技能 | `codex-home/skills/` 的 `desktop-automation`、`browser-skill` | 随应用写入，引导引擎调自动化工具；旧 `browser-automation` 已退役（升级时按指纹自动清理，用户改过的目录不碰） |

## 会话动态工具（thread/start / thread/resume 注册，可直接调用）

| 工具 | 来源 | 用途 |
|---|---|---|
| agent_invoke / agent_archive_sessions | 宿主 **dynamicTools**（`part08/01-seg.tsx` 的 `buildDynamicTools`，分发在 `part05/event-router/02-request.tsx`） | 派一个干净上下文的自己 / 归档本次调度产生的临时会话。执行端转 IPC `agents:invoke` / `agents:archive`，与内置 MCP harness-dispatch **共用同一个 `runDelegatedTask` 硬闸** |
| memory_recall / memory_save | 引擎 dynamicTools | 查询/保存分层记忆（用户偏好/项目背景/工作流/任务经验）；发送前应用会自动注入相关记忆 |
| 生图：命令行 `harness-media.mjs image`（首选 dynamicTool `generate_image`）；识图：命令行 `harness-media.mjs vision` | 命令行 / dynamicTool | 需在 设置→插件→内置插件 配置；未配置时调用会返回指引 |
| rpa_save / rpa_run | dynamicTools | 保存自动化流程为 RPA 配方 / 列出并执行已存配方（逐步复现） |
| task_add / task_update | dynamicTools | 维护用户任务清单（新增/改状态/列出/删除） |
| agent_ask | dynamicTools | 向用户展示选项卡等待选择（第一项为推荐），用于关键决策确认 |
| frontend_get_doc / frontend_apply_doc | dynamicTools（前端开发，10-05；两轮改名：sketch_* → mobile_ui_* → frontend_*） | 读/写应用内「前端开发」画布（m3e-canvas，手机 / 电脑 / 网页三种形态）：读回整份文档 JSON + 摘要；写回=在文档基础上改（追加屏/加部件/调坐标），走上游分享哈希导入、用户实时可见可 Ctrl+Z。写侧先过 `validateSketchDoc` 前置校验（失败回中文原因）；画布没开自动打开等桥就绪；描述列全 44 种 kind，字段速查在内置技能 frontend-canvas。做手机/电脑/网页界面时主动用（常驻指令第 13 条配套） |
| harness_tools | dynamicTools（**能力网关**，10-05） | 调其余内置能力：`scheduler_*`（定时任务）/ `knowledge_*`（知识库）/ `ui_component_*`（组件库）/ `video_*` / `voice_generate` / `workflow_*` / `expert_list` / `expert_save` / `subagent_save` / `connector_register`。传 `name` + `args`；⛔ 参数拿不准先 `name="list"` 取清单。执行端 = IPC `agents:dispatch-call` → `dispatchRpcCall`（与内置 MCP 同一套）。⛔ `agent_invoke` / `agent_archive_sessions` / `image_generate` 有专用工具，**不在**网关里 |

> ⛔⛔ **内置 MCP（harness-dispatch）的工具在引擎 0.157 里不再直接可调**（10-05 实测定性，用户报「调度工具用不了」的根因）：
>   · 引擎把 MCP 工具改为**延迟暴露** —— `input[0].additional_tools` 里只有 `functions` / `clock` / `collaboration`
>     三组 11 个工具，`agent_invoke` 出现 0 次；`functions.exec` 的说明原话是「Some deferred nested tools may be
>     omitted from this description … still available on the global `tools` object and **listed in `ALL_TOOLS`**」。
>     引擎 feature `tool_search_always_defer_mcp_tools` 已 `removed=true` ⇒ 该行为**永久生效**。
>   · 直接调裸名 → `unsupported call: <name>`（`codex_core::tools::router`）；调 `mcp__<server>__<name>` 同样不支持。
>   · 复现方法：起**独立 `CODEX_HOME`**（隔离，不碰用户会话）+ 把 `model_provider` 指向一个本地 mock HTTP 服务，
>     截获引擎真实请求体 —— 工具面在 `input[0]`（`type:"additional_tools"`）的 `tools[]` 里，直接数 `name` 即可。
>     （隔离起真实 app-server 的握手套路见技能 `codex-engine-config-probe`；判定「某个名到底在不在工具面」必须这样实测，读代码会漏。）
>   ⇒ **10-05 已用「能力网关」重新接回**：宿主注册 1 个网关工具 **`harness_tools`**
>     （`part08/01-seg.tsx` 注册 → `part05/event-router/02-request.tsx` 分发 → IPC `agents:dispatch-call`
>     → **原样转给 `dispatchRpcCall`**，与内置 MCP 共用同一套实现与闸）。模型传 `name` + `args` 调用；
>     `name="list"` 返回全部能力 + 参数 schema。
>   · ⛔ **为什么是 1 个网关而不是 19 个独立工具**：工具面**每次请求**都要带上 ⇒ 19 份 schema 是常驻
>     token 成本，还会挤掉真正重要的工具；且主进程以后新增 MCP 工具时**渲染层不用改**。参数说明按需取。
>   · ⛔ `agent_invoke` / `agent_archive_sessions` / `image_generate` **不在网关里** —— 它们已有专用
>     dynamicTool。同一个能力挂两个名字，模型只会用最直白的那个、另一套被绕过（项目踩过：`subagent_invoke`）。
>   · ⛔ **身份两条路径都要是引擎事实**：网关的 `callerThreadId` 取 `item/tool/call` 的 `params.threadId`
>     （模型伪造不了）；MCP 路径仍靠 `dispatchProbes` 旁证。⛔ 别在渲染层"顺手"补一个模型可见的入参。
>   · ⛔ **老会话要切走再切回**（dynamicTools 只在 `thread/start` / `resume` 生效）。
>   · 守卫 `scripts/guards/11i-capability-gateway.mjs`（16 条）钉住接线；`11j` 钉「内置示范插件一律默认停用」。

> ⛔ 上表的**权威来源是代码**：MCP 工具见 `electron/features/dispatch-core.ts` 的工具数组（改完跑 `npm run gen:ipc` 会同步进 `harness-api` 技能），命令行能力见 `electron/developer-instructions.ts`。表里对不上的名字以代码为准（09-29 发现本表长期把命令行能力 `generate_image` 写成"工具"，且漏了后来新增的调度/媒体工具）。
> ⛔ **生图生视频的完整用法**读两个内置技能：`image-generation`（提示词五段结构 / 尺寸选择 / 变体策略 / 一致性）、`video-generation`（模式路由 / 8 家厂商矩阵 / 去漂移 / 失败修复 / 成片拼接）。

## 工具链清单

**随包内置（离线可用，勿重复下载）**：Node（安装器引导）、VS Code CLI、**Nuphus 桌面自动化 + Playwright 浏览器自动化 CLI**（`tools/npm-global` 预解压，≈48MB 原始；09-16 起 **CloakBrowser 已从包里剥离**，extraResources `filter` / `pack-automation.cjs` / mac `copy-mac-tools.cjs` 三处同源排除。⛔ **必须两条 extraResources 映射**：`from=resources/tools/npm-global`（根级 shim）+ `from=resources/tools/npm-global/node_modules`（包体本身）——electron-builder 会**无条件丢弃 `from` 根级的 `node_modules`**，只写一条映射的话包里只剩 shim、包体全无）、**ponytail 插件源**（`tools/ponytail-plugin` 1.6MB）。其余（Python/Git/PowerShell/rg/uv/CMake/Ninja/7-Zip/jq）09-16 起不随包，走「开发工具」页按需下载；**首次启动检测到缺 Git 会自动后台补装**（`autoInstallGitIfNeeded`：仅 Windows、与手动安装互斥、装完 `restartServerWhenIdle` 刷新引擎、失败广播 done 事件不悬挂安装态，下次启动仍缺会再试）。**ponytail 默认不装**（09-27，见【26】）：随包只留安装源，启动**不再自动种**；想用在「开发工具」页手动安装（`runtime:install` id=ponytail），卸载后不会自动装回。

**按需安装（应用内「开发工具」页 或 手动）**：

| 工具 | 大小 | 安装方式 | 装完效果 |
|---|---|---|---|
| Nuphus 桌面自动化 | 随包 30MB | **随包直出**，卡片显示「内置」；目录损坏时点「修复安装」（重新解压 zip 到 `tools/npm-global/` + 激活联动开关 + 引擎重启） | nuphus MCP 注册 35+ 桌面工具（经 nuphus-call 按需调用） |
| Playwright 浏览器自动化（CLI） | 随包 18MB | 同上（随包直出 / 可修复安装） | playwright-cli 可用（**默认浏览器通道**） |
| CloakBrowser 指纹浏览器（npm 包） | ~4MB | 开发工具页「下载」（`runNpmInstall`：内置 node 自带 npm + registry.npmmirror.com，失败回落官方源；用户自设 registry 时不覆盖） | `CLOAKBROWSER_ENTRY` 生效，可过 Cloudflare/reCAPTCHA；**不装不影响日常浏览**（默认走内置浏览器视图 + playwright-cli） |
| Playwright 浏览器内核 | ~170MB | 开发工具页「下载」（需先有 Playwright CLI） | playwright-cli 首次 open 不再提示缺内核 |
| Cloak 指纹浏览器内核 | ~200MB | 开发工具页「下载」（需先装 CloakBrowser npm 包） | cloakbrowser 可开反检测窗口 |
| ponytail 写代码模式插件 | 随包 2MB | **默认不装**（09-27 起，按需安装）；用人在开发工具页手动安装 | 会话钩子 + 6 个 ponytail-* 技能 |
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
5. **缺 ponytail 插件**：默认就没装，要用就走这条安装：`runtime:install`（id=`ponytail`），随包安装源 `tools/ponytail-plugin` 种到 `codex-home/plugins/cache` + 写 `[marketplaces.ponytail]` / `[plugins."ponytail@ponytail"]` / 钩子信任。
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
- 官方精选市场（`openai-api-curated`）需 ChatGPT 账号登录才能装，API Key 方式装不了。**10-03 用户改判：卡片放出来**（不再整源隐藏），点不动时由 `changePlugin` 给中文提示兜底。想要「装了就能一键用」的官方插件走上面「Codex 官方插件市场」那一节内置的镜像源。

## 引擎怎么知道「宿主有哪些能力、能拓展什么」（09-25 立，守卫【153】【159】）

用户报障：「接口和拓展清单，Codex 好像不知道，扫半天都没扫到，不知道能拓展什么」。实测根因**不是清单没做**，
而是**可达性**：

- 清单本体 = 内置技能 **`harness-api`**，由 `scripts/gen-capability-skill.mjs` 从
  `ipc-channels.manifest.json` + `ipc-registry.ts` **生成**（87 域 / 441 通道，10-11 实测重生成）⇒ 永远与代码同步。
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
- 🧠 知识库 Laya 软增强（10-04 立项，10-05 校准定案）：knowledge_add 写入门禁（knowledge/chatter 问法）+ 重复内容拦截可用；**检索相关性过滤校准证明不可用已砍**；判定置信读 answer_confidence；校准脚本 scripts/calibrate-laya-kb.mjs；守卫【kb】判据 8 十条（docs/KNOWLEDGE-BASE.md §9）
- 🧊 3D 模型预览（10-05 立项，model-viewer 域）：harness_tools 网关 preview_3d（.glb/.gltf，可信根+白名单+256MB 闸）→ 应用内可旋转弹窗（@google/model-viewer 懒加载 ~1MB 独立分块）；技能 3d-modeling + 鲁班种子同轮接入；守卫【mv】13 条（scripts/guards/12-model-viewer.mjs）
- 🖊 界面草图写入通道（10-05 下午）：dynamicTools 加 `sketch_get_doc` / `sketch_apply_doc`；写回只走上游分享哈希导入（`#docz=`，桥不碰 localStorage）；渲染层会话单例 `sketch-session.mjs`（串行队列 / 关窗拒绝 / StrictMode 语义）；守卫【283】67 → 131 条（含桥 VM 真跑三用例）；验收 ⑨⑩⑪ 真跑写回往返与还原
- 📱 手机前端UI 改名 + 一键预览（10-05 夜，用户：「名字改一下叫手机前端UI…加一个对话框预览这个UI界面」）：展示名「界面草图」→「手机前端UI」全量改（域 id / 协议 / 存储键不动）；工具改名 `mobile_ui_get_doc` / `mobile_ui_apply_doc` + 描述改「手机前端开发主动用」；常驻指令第 13 条；弹窗「预览」按钮 → 桥代点上游 play_arrow（交互预览是上游自带）；守卫【283】131 → 149 条（VM 用例 D 预览触发真跑 + 弱断言加强）；验收 ⑫ 真跑回执
- 🧩 前端开发画布组件补丁层（10-06，用户：「3800个组件你从中调一些常用的组件做成图里面这些组件啊，现在默认组件太少」）：画布从"官方产物原样嵌"升级为**上游钉死提交 + 本仓补丁层**（`scripts/sketch-fork/`：overlay + 29 处定点补丁 → next build → 出货一条龙），面板新增 8 个常用组件 `avatar` / `skeleton` / `rating` / `tooltip` / `expansionPanel` / `segmentedButton` / `stepper` / `timeline`（36 → **44 种**）；kind 枚举 / 工具描述 / 组件手册 / 指令全部同轮跟到 44；上游 758 项测试全过；守卫【283】158 → 162 条（补丁层来源/清单/产物中文名对账）；验收探针加 avatar 真落盘（2 屏 / 3 部件）
- 🗂 文件更改汇报卡补交互（10-06，用户对照 Qoder 效果图：「汇总消息底部显示文件…这个生成文件直接打开预览就行，和右键打开文件地址和复制文件路径…还有生成的图片」）：回合底部「已更改 N 个文件」卡升级 —— 行**点击直接打开预览**（图片走灯箱）、行**右键复用**文件卡菜单（新增「复制文件路径」，原「在文件夹中显示」即打开文件地址）、超 6 行折叠「再显示 N 个文件」、图片行缩略图、新增文件「新增」徽标；守卫新增 **11p**（16 条，5 处变异全抓）；验收 `file-summary` 8 条（真事件驱动真卡：点行预览 / 右键两项 / 复制成功回执 / 折叠往返 / 缩略图）
- 🩹 文件汇报卡**真链路修复**（10-06，用户真机实测：「汇报底部没有出现你的新改动」——上一轮的注入式验收放过了三处静默缺陷）：① 渲染层 `turn-file-changes.mjs` 监听的 `window "message"` 通道**全仓无发送方**（死信道）⇒ 改走真通道 `window.codex.onHarnessEvent`（裸 payload）；② 主进程追踪器广播的 `turnId` 是**线程 id**、卡片按**回合 id** 取 ⇒ 快照记下回合 id、广播改用它（线程 id 只当快照/结算键）；③ 工作区遍历是深度优先 ⇒ 大子目录（AppData…）烧光 4000 文件预算、根级新文件永远不进快照 ⇒ 改**文件优先两趟遍历**。守卫 11p 16 → 24 条（id 链/真通道/遍历顺序，5 处变异全抓）；验收 `file-summary` **重写为零注入真回合全链路**（真起回合 → 测试进程落盘 8 文件 → 追踪器 diff → 真广播到达且 turnId == 真回合 id → 卡+交互 12 条，约 12s）
- ⚡ 运行中**实时编辑行**（10-06，用户对照 WorkBuddy 并纠正口径：「**运行中是运行中的 —— 在编辑板块对应文件后面 +-n 数字；汇总是汇总，两个不要搞错了**」）：模型走 shell/MCP 写文件时引擎一个 fileChange 都不发（实测本环境工具面没有 apply_patch，模型自己说的）⇒ 宿主每 2.5s **轻量重扫**（`walkLight` 只 stat、异步并发、不阻塞主进程）→ 对比回合开始快照 → 广播 `turn-file-changes-live`（**回合 id**，与最终报告同链）→ 回合视图渲染**扁平行**「✏ 编辑 (类型图标) 文件 … +N -M」（数字变化重放 live-tick 动画；**不是卡片、无总计头**——那是汇总的形态）；收尾先发空 live 清场、汇总卡接管。新基座 `src/components/FileTypeIcon.tsx`（扩展名→图标+配色，一处真相源；汇总卡行的彩色文字块已换掉）；编辑卡（fileChange 路径）行头同步加图标+行级实时徽章。守卫 **11q** 19 条（7 处变异全抓）；验收 `file-summary` 扩到 **14 条**（③④ 真回合里断言实时行出现 + 第二批写入后行数 3→8 增长 = 实时在更新，21s）
- 🧭 三处用户实测修复（10-06 深夜，同一轮里用户连报三个）：① **粘贴附件消息「渲染两次」**——纯附件消息两侧可见文本都为空，旧 `userMessageMatchesInput` 直接落空到图片分支返回 false ⇒ 乐观气泡永不合并（运行中一条消息显示两遍）；修法 = 两侧按 `parseUserRefs().files` **附件文件列表**逐项同序比对（`src/lib/user-refs.ts`），且文本比较同时要求 filesMatch。② **编辑行改就地锚定**（用户：「在哪个地方就展示在哪个地方，不是一直在新消息下面，这样多丑」）——`TurnFoldStream` 订阅 live、按「文件首次出现时刻流里最后一条工具项」定锚（`liveAnchorsRef`），`CappedToolSequence/CappedToolRun` 加 `renderAfter` 把行挂在对应项后面；`LiveFileChanges`（底部块）退役为哑组件 `LiveFileRows`。③ **审查弹窗关不掉 + 思考板块回合结束重放缩放**：前者真因是 `.turn-group` 上的**恒等 transform**（= containing block）让 `position:fixed` 遮罩退化成 481px 回合盒、弹窗头部被顶出屏幕 —— 修法 `createPortal` 到 body（右键菜单同病同修）+ 头部常驻/内滚 + Esc 兜底；后者是回合结束大折叠重挂载时残留的 `bufferedReasoningRevealStarts` 标记让 revealing 复位活 ⇒ 浮窗凭空 spawn→suck 一遍（animationstart 实测三连）—— 修法三重：初始揭示只在 running 用标记、非直播态清标记且不读、回合结束后浮窗只认用户显式点开（守卫【161】+3 条、11p 28 条；`file-summary` 扩到 15 条含「粘贴附件中途单气泡」③b）。④ **夜补**：新电脑实测「运行中行有、收尾汇总卡没有」（本机同场景复现全绿 → 疑引擎版本间结束事件形态差异）——收尾双保险 `settleTurnByTurnId`（按快照自存的回合 id 反查结算），boot 先线程键、再回合键，正常路径下兜底为 no-op（11p 30 条）。⑤ **思考浮窗层级账**（用户：「办公室预览会被思考板块遮住，其他窗口也是」）：浮窗 portal 到 body 时以 z-index:8 参加**根层**竞争 —— `app-shell` 是 `isolation` 层、壳内一切 z（办公室 400 / 设置 80~97 / 画布 90）只在壳内比较 ⇒ 全被外面那个 8 压住。修法 = 新增壳内宿主 `.reasoning-float-host`（**60 档**：高于消息流 <30、低于设置页/画布/整屏浮层），浮窗 portal 到它（挂 app-shell 壳根，⛔ 不许进回合卡——.turn-group 有恒等 transform 会让 fixed 退化）；DESIGN.md 层级表加 60 档 + 第 5 条硬规则「壳内浮层不许 portal 到 body 参加根层竞争」；守卫【198】+6 条（宿主 60 档相对画布/模态、挂壳根、portal 目标、穿透层配套），elementFromPoint 实测：办公室在浮窗之上 ✓、body 级对照仍能压住壳 ✓
- 🖼 应用壁纸（10-05 立项，wallpaper 域）：外观设置「壁纸」段五档（关/图案/粒子/3D 背景/自定义图）；图案 = 原创 SVG mask + --accent 上色；动效 = tsparticles + vanta（MIT，React.lazy 整块懒加载独立 chunk，vanta try/catch 降级）；层挂 timeline-wrap（absolute z-1 pointer-none，只在聊天区透出）；减动效偏好自动退回图案；守卫【wp】13 条（scripts/guards/14-wallpaper.mjs）
- 📄 运行中「N 个文件已修改」胶囊 + 汇总卡行悬停 diff 预览（10-06 深夜 · Round J，用户对照 WorkBuddy 图三/图四 + 三条追加令「弹窗不能被裁剪」「不要靠左」「放上去展示的那个也要居中」）：
  ① **胶囊**（`src/features/status/LiveEditedFilesCard.tsx`）贴输入框上方、询问/审批卡**之上**（卡片栈里普通一行，⛔ 不 portal —— 上下排序不互相遮从形态上保证）、**居中**（`text-align:center`）；悬停展开文件清单（类型图标 + 文件名 + 每文件 +N -N / 已删除），数据 = 同一条 `turn-file-changes-live` 源随运行实时刷新，回合结束**自动消失**（收尾由汇总卡接管）。弹层位置**自适应**：按上下空间选边（`pop-above/pop-below`）+ maxHeight 收窄（内滚）+ 左右钳进视口；**以胶囊中心居中**（⛔ absolute 基准是卡片，left 必须写「相对卡片偏移」，写视口坐标会叠卡片左缘画歪——实测 358→716；锚点取 `pillRef` 中心，贴边被钳住时豁免居中）。
  ② **汇总卡行悬停 diff 预览**（`Status.tsx` 的 `CompletedChanges`）：260ms 意图延时出、160ms 离开延时关（滚轮/离开即关），portal 到 body、位置自适应（先量后画：`Math.max(M, Math.min(rect.left, vw - width - M))` + 竖向钳制）、内容 = `ToolCodeBlock language="diff"`。
  ③ **弹窗自适应普查**（用户令：「凡事弹窗类都要加自适应…没其他窗口顺便也检查一下」）：ComposerMenu（上开 + maxHeight）/ FileCardMenu（翻转）/ ThreadRowMenu（钳制）/ AppSelect（翻转，守卫 197 已钉）核对无越界；**画布右键菜单**（`DramaCanvas.tsx`）此前未钳制 → 本轮补 `Math.max(8, Math.min(menu.x, innerWidth - 168))` 同款钳制。
  ④ 判据：守卫 11q **28 条**（+4：胶囊居中 CSS / 弹层相对卡片偏移 / 胶囊中心锚点 / 接线序在审批卡上）+ 11p **32 条**（+2：悬停预览 portal 与自适应 left / `maxHeight={diffHover.codeMax}`）；验收 `file-summary` 扩到 **19 条**（④b 真回合胶囊出 + 悬停清单 fits + **centered**（gap≤2px，贴边豁免）、⑮ 回合结束 `.edited-files-card` 归零、⑯ 汇总行悬停预览可见 + fits + 与行左缘对齐 ≤2px + 含 `@@`、⑰ 移开即关）+ 新验收项 **`popup-fits`**（登记 10-06 轮：逐个开合弹出类面板验 fits，⛔ `--only` 单跑缺前置时按提示走默认轮）。五条变异全抓（去居中 / 写视口坐标 / 固定 left / 断偏移 / 锚点回左缘）。
- 🧊 编辑行冻结 + 汇总卡持久化 + diff 预览升级（10-06 夜二改，用户实测三连 + 一条追加令）：
  ① **「运行结束后，我查看过程没有 +N -M」**——实时行原按设计在收尾时**清场**（只留底部汇总卡）⇒ 现在**收尾不清场**：行换成**最终报告的定格数字**，收成**一块始终可见**的 `frozenEditRows`，落在过程与最终答复之间（⛔ 不塞回折叠组——收起状态下视觉/文本都是空的、等于没显示，截图实锤后定稿；运行中的就地锚定不动）；主进程不再发空 live 清场、最终报告**无条件广播**（渲染层收到 final 才清 live）。
  ② **「重启应用，那个下面已修改的文件那个板块不见了」**——报告原来只活在内存（广播即弃）⇒ `electron/turn-file-watch.ts` 按线程落盘 `<userData>/turn-file-changes/<threadId>.json`（每线程 40 回合 / 单文件 1.5MB 防呆上限；目录由 `bootApp` 内 `setTurnFileWatchStore` 注入，⛔ 不在模块顶层求值 `app.getPath`）⇒ `codex-ipc` 在 `thread/resume` 时把存量报告**按原事件形态重播**（渲染层收件零改动）⇒ 重启/切回会话后卡片与冻结编辑行复活。
  ③ **「没有 Qoder 这种 diff 预览好看，他鼠标放上去还能左右滚动和上下滚动」**——根因是悬停面板的**捕获级 scroll 监听一律关窗**（想滚先关窗）+ 正文是裸文本块 ⇒ 新增纯函数 `src/lib/diff-view.mjs`（`parseDiffLines`：hunk 头解析旧/新行号，`---`/`+++` 只在进 hunk 前算文件头）+ `src/features/status/DiffPreview.tsx`（双行号槽 + 增删符号 + 彩色行底），面板 `overflow:auto` 两轴滚动（行 `white-space:pre` 不折行）、**面板内滚动不关窗**（`panel.contains(event.target)` 豁免）、头部加「打开完整 diff」展开钮。
  ④ 追加令「已修改那个文件…最多一次展示 2 行，多了的自动放进收纳里面（这个是汇总消息下面的）」⇒ 汇总卡列表 `COLLAPSE_LIMIT = 6 → 2`（收纳 = 原「再显示 N 个文件」折叠钮，形态不动）。
  ⑤ 判据：守卫 **11p 47 条**（32→47：2 行收纳 / 预览滚动豁免 / DiffPreviewBody / 两轴滚动 CSS / color-mix 行底 / parseDiffLines / 落盘 API / boot 注入位置 / resume 重播 / parseDiffLines 真值表 3 条 / 删除入口清落盘）+ **11q 32 条**（28→32：收尾不清场 / 冻结块取最终报告 / 落点在最终答复之前 / 运行锚定保持 / 锚点 localStorage 方案撤掉负向）；验收 `file-summary` 扩 **⑤b**（收尾后冻结行仍在）/ **⑤c**（读盘对账 `<threadId>.json`）/ **⑯b**（行号槽 + 两轴滚动 + 面板内滚动不关窗 + 展开钮）+ ⑧⑨⑭ 改 2 行口径；【118】锚点随重构更新；【265】棘轮 accept.mjs 1122→1189（实测；+13 等滚动静默 +12 悬停重试）。
- 🫧 回合状态胶囊 + 输入框拖动把手（10-06 夜三轮，用户对照 Qoder 截图：「步骤 0/6 · 5 个文件已修改 +177 -8」+ 图二的拖动条）：
  ① **合并胶囊**（`src/features/status/TurnStatusCapsule.tsx`，由 LiveEditedFilesCard 重构改名）：左区「步骤 N/M」= Codex 自己维护的任务清单（悬停展开步骤清单，todo ○ / doing ⟳ / done ✓），右区「X 个文件已修改 +A -D」= 运行中实时文件改动（悬停展开文件清单）；**两区各自独立可显示（单独存在即居中）、同时在才拼接「·」**（用户定稿：「都是可以独立居中展示的，只是多了另一方展示的时候，就拼接展示」）；⛔ 文件区只在运行中显示（收尾由汇总卡接管），任务清单区有清单就有（收尾后仍在）。（⛔ 10-06 夜六轮改：两区都只活在运行中 —— 见下方夜六轮条目）
  ② **旧「目标与进程」UI 整体撤掉**（用户令「把原来的目标和任务清单图标和浮窗移除」）：顶栏 Target 入口（tb-goals-entry）+ goals-pop 面板 + goals-handle + 相关 CSS（goals-pop/handle/summary/section/task-list、plan-steps/plan-dot/plan-check；⚠️ 裸 `.plan-step`/`.plan-step.done` 与 `@keyframes pulse` 有别的消费方，**保留**）+ chat-search 的 Esc goalsOpen 分支（留着会吞掉启动后第一次 Esc）；任务清单的唯一常驻入口 = 胶囊。bag 里 goals* 状态暂留（无 UI 消费者，未清——收口见 logs 条目）。
  ③ **任务清单由 Codex 维护 + 实时同步**：tasks-ipc 每次 add/update/delete 后广播 `tasks-changed` → 渲染层（part02c1）订阅刷新 bag.taskList（胶囊即刻跟上；原来只有工具分发处手动重拉）；`developer-instructions.ts` 新增**第 14 条** TASK LIST（多步任务先建清单、开工标 doing、完成一步立刻 done、别攒最后）；task_add/task_update 工具描述同步强化。
  ④ **输入框上下拖动把手**（02-composer-form.tsx + CSS）：顶部细条 + 居中胶囊视觉，拖动改输入区高度；**下限 48px（=编辑器 min-height）/ 上限 min(55vh,560px)** 硬钳；`window` 级监听拖动（⛔ 不用 pointer capture —— 合成事件下 setPointerCapture 直接抛；真拖与合成同路径）；localStorage 持久化（重启恢复、读回也钳上限）、双击复位；高度经 `--composer-editor-h/-max` 两个 CSS 变量下发（未拖动 = 原「内容自适应 + min(42vh,360px)」行为不变）。
  ⑤ 判据：守卫 11q 32→38（胶囊双分区 / 独立-拼接 / 三态 / 负向防复活）+ 新建 **11s-composer-resize（9 条）** + 【48】上限判据接受 var 形态 + 【160】白名单 + 【265】棘轮 accept.mjs 1189→1304（实测）；验收 file-summary 扩 ①b（任务播种走 tasks-changed 真链路）/ ④b 拼接 / ④c 文件区 / ④d 步骤区 / ⑮ 改「文件区消失但步骤区保留」（⛔ 10-06 夜六轮再改为「双消失」，见下条）/ ⑱ 删净收口 + 新验收项 **`composer-resize`**（合成 PointerEvent 真拖 + 上下限钳制 + 落盘 + 双击复位）。
- 🫧 任务清单生命周期修正（10-06 夜四轮，用户实测两条：「Codex 任务跑完，任务清单小胶囊没有自动消失」+「新的任务清单里叠着旧清单」）：
  （⛔ 10-06 夜六轮改：全完成隐藏保留；但「跑完/停掉就该消失」与「新回合清旧账」由夜六轮的运行门 + tasks:clear 接管 —— 见下条）
  ① **全部完成 ⇒ 胶囊自动隐藏**（`TurnStatusCapsule`：`hasSteps = steps.length > 0 && steps.some(s => s.state !== "done")`；悬停分区同步清掉）；
  ② **新一轮开工自动开新清单**（`rpa-store.addTask`：清单**全部完成**时再 add ⇒ 先清掉全完成清单，再落新任务；⛔ 只清全 done —— 批内 todo/doing 属同轮补步，不许动）；
  ③ 步骤改按**创建顺序**展示（store 接口序是 updatedAt 倒序，胶囊里重排，①②③④ 自上而下）；常驻指令第 14 条补「新任务开工先清与本轮无关的旧项；全完成会自动隐藏、下一次 task_add 自动开新清单」。
  ④ 判据：11q 38→41（全完成隐藏 / 创建序 / store 全完成清理）+ 验收 `file-summary` 扩 **①b2**（旧轮哨兵：全完成清单被新 task_add 自动清掉，count=2）+ **⑱a**（全部完成 ⇒ 胶囊自动隐藏）/ ⑱ 拆 a/b；⑯ 悬停目标改**本回合自己的卡**（⛔ 全局首个 `.completed-changes` 是最老历史、常在视口上方 2000+px，长列表布局漂移让 scrollIntoView 落点失真 —— 悬停假红三次全败的真根因，改作用域后 attempts=1 稳过）；【265】棘轮 accept.mjs 1310→1323。
- 🎯 /goal 目标条 Qoder 化（10-06 夜五轮，用户对照 Qoder 截图：「跟输入框一样长，贴在输入框上面，展示内容和展示效果和功能按键和跟这个qoder一样，目标 时间 ，目标内容 尾部 编辑，删除，暂停」）：
  ① 旧「目标模式横幅」（`.mode-banner.goal-loop`）+ 输入框内目标小圆片（`.mode-chip-float.chip-goal`）整体撤除，换成新 `GoalBar`（`src/features/status/GoalBar.tsx`）：软粉底圆角条、**width:100% 与输入框同宽**、贴输入框上方卡片栈；左「🎯 目标 · 计时」+ 内容（单行省略）+ 状态词（自动推进中/已暂停/受阻/已完成），尾部三键 **编辑 / 删除 / 暂停-继续**（完成态隐藏暂停键）。`.mode-banner` 全族随最后一个消费方一起删净（plan-confirm 变体此前已无消费方，全仓 grep 确认零引用）。
  ② **计时 = 引擎侧**（`thread/goal/get` 的 `timeUsedSeconds` + 活动态按 `updatedAt` 差值每秒外推；暂停/完成冻结）—— ⛔ 不本地记挂载起点（切会话/重启后必须仍准）；`updatedAt` 缺失/为 0 时**不外推**（按 epoch 差值加会变几十万小时）。格式化纯函数 `src/lib/goal-time.mjs`（3秒 / 2分5秒 / 2小时2分，非法回落 0秒）。
  ③ **暂停/继续走 `thread/goal/set` 的 status 字段**（10-06 隔离引擎实测：set 接受 status；⛔ 引擎**没有** thread/goal/pause|resume 两个方法，别改回去）；暂停时若回合在跑补一发 `interrupt`（引擎的 paused 只停「下一次自动续跑」）；编辑目标经 `openAppPrompt` 弹窗、**保持原暂停态**（不误触发续跑）；删除 = 既有 stopGoalLoop → `thread/goal/clear`。
  ④ 判据：新建守卫 **11t-goal-bar（14 条）**（布局 / 引擎计时+不外推 / status 暂停路径 + 负向不许复活 goal/pause RPC / interrupt 接线 / 编辑保态 / 旧 UI 负向 / 样式与同宽 / formatGoalTime 真值表；6 处变异全抓）+ 新验收项 **`goal-bar`（7 条）**（真回合全链路：无目标不渲染 → set(paused) 出现 → 编辑往返保态 → 继续后计时真跳 + 真续跑 → 暂停真中断 → 删除后引擎 goal 清空）；【265】棘轮 accept.mjs 1323→1410（实测）。
- 🫧 任务清单生命周期收口（10-06 夜六轮，用户实测两条：「清单不会自动消失」「新会回合，旧的任务清单还在」—— 夜四轮的修法只覆盖「全完成」一种状态，停在半路（被 /stop）的清单全漏）：
  ① **步骤区与文件区同款：只活在回合运行中**（`TurnStatusCapsule` 的 `hasSteps` 加 `Boolean(runningTurnId)` 门）—— 回合跑完 / 被 /stop 停 / 切走会话，整卡即消失；配套两处：回合结束清悬停 `zone`（不清会在「渲染 null 的空档」里留着，下一回合一出现就凭空弹旧面板）；全部完成仍隐藏（夜四轮令，运行中同样生效）。
  ② **新回合开工清上一轮清单**：新 IPC `tasks:clear`（manifest 单一真相源 → tasks-ipc handler（清空后广播 tasks-changed）→ rpa-store.clearTasks），挂在 send.tsx 的**空闲直发路径、首个 startTurn 之前 await 落地**（排队分支不清 —— 旧回合还在跑、清单要用；goal 引擎自续回合不走 send()，天然不受影响）。⛔ 必须用 `window.codex.clearTasks()` **类型化宿主方法** —— `codex.request()` 是**引擎 RPC**，真跑实测把 tasks:clear 转给 app-server 报 `unknown variant`、被 catch 吞成「清了但没清」（首版就这么栽的，探针实测 2 任务一次清空才是对的）。
  ③ 判据：守卫 **11q 41→46**（hasSteps 运行门 / zone 清理 / 通道贯通 / 清空广播 / 直发挂钩顺序与「不用 request()」负向；6 处变异全抓）+ 验收 `file-summary` 重排为 **31 条**：①c 没在跑不渲染 → ①d 真发送清旧账（真 end-to-end）→ ④a 运行中重播种出「步骤 0/2」（独立居中）→ ④b 悬停步骤清单 → ④c/④d 运行中全完成隐藏 + 还原回显（旧位置在收尾后，夜六轮起会退化成恒真，必须搬进运行中）→ ④e 悬停文件清单 → ④f 拼接（**页内 300ms 采样日志**）→ ⑮ 收尾后**双消失**（清单仍在库里 = 隐藏不是删除）；⑱a 删除（恒真化）。
  ④ ⛔ **慢工作区两处治本**（本轮实测教训：cwd = 用户主目录这类大树，walkLight 一圈远超 2.5s，把窗口类断言整段推过回合结束）：③④ 实时行查询**作用域到本回合组**（`#turn-<turnIdLive>` —— 全局查询把历史回合的冻结行数进来，实测 3→16/24 的假增长，连「没广播也过」都能发生）+ 胶囊拼接改读页内采样日志（与 CDP 轮询时序解耦）；sleep 8→12 给运行中断言留余量；【265】棘轮 accept.mjs 1410→1483（实测）。
- 📁 顶栏标题区整改（10-06 夜七轮，用户截图圈出右侧 📁 并令「把文件图标放到最前面；标题长度固定，太长的就省略，不要撑长对话框上面左上角的名字」）：
  ① 工作区按钮（`.ctx-picker`，📁 FolderOpen）从右侧操作簇挪到 `.task-title` **最前**（AppView.tsx；part09 的 topbarActionsNode 不再渲染它，⛔ 不许加回 —— 两份会叠出双菜单）；点击行为不变（工作区上下文菜单，portal 到 body）。
  ② 标题定长 **300px** + 省略号（原 `min(42vw, 380px)` 随窗口变）；重命名输入框同宽（编辑时不跳宽）。
  ③ 搬家连带四处同步：窄屏（≤760px）隐藏规则前缀 `.topbar-actions` → `.task-title`；守卫【250】覆盖率清单与「窄屏收浮层」正则跟着换 + 新三条（📁 在 strong 之前 / 不许加回操作簇 / 定长 300px，4 处变异全抓）；守卫 11e 的 ctx-menu portal 断言与计数扩到 AppView（26/26）；part09 清掉 FolderOpen/basename 死导入（【94】）。
- 🧭 工作区菜单三修 + 顶栏标题 6 字截断（10-06 夜八轮，用户实测连报 + 一条补充令）：
  ① 用户报「项目地址弹窗一出来，点图标都不会自动消失、其他地方都点不了、关都关不掉」—— 根因＝原来靠 `.menu-backdrop`（fixed inset:0）当遮罩，而它挂在**顶栏拖拽区**（`-webkit-app-region: drag`）子树里：未豁免拖拽的子元素整块算拖拽区，真实鼠标点击被 OS 拿去拖窗口、页面收不到 onClick；遮罩又把整个视口圈进拖拽区 ⇒ 全屏点不动 + 菜单关不掉。修法＝工作区菜单**撤掉遮罩改非阻塞**（`window mousedown` 判外部：弹层内用 `closest('.ctx-menu')` 判、📁 按钮用 `ctxBtnRef` 判 —— DispatchMenu 同款范式；点图标一次就关闭**且图标照常生效**）+ Esc 兜底 + `.menu-backdrop` 全局豁免拖拽（搜索面板 / 任务菜单的遮罩共用此类一并救回）。⛔⛔ **这类缺陷 CDP 探针永远测不出**（合成点击绕开 OS 拖拽判定，验收全绿、真机一按就中）—— 守卫 11e ⑨ 四条结构判据钉（5 处变异全抓）。
  ② 菜单新增「**打开项目地址**」行（用户点名）：`window.codex.shellReveal(workspace)` —— shell-ipc 对目录走 `shell.openPath` 在文件管理器打开（工作区在可信根内，主进程放行）。
  ③ **顶栏标题按字符数截断：最多 6 个字、超出补「…」**（用户令「那个会话窗口左上角那个字最多 6 个字，其他省略」）—— AppView 模块级 `truncateThreadTitle`（`[...value]` 展截，⛔ 别用 slice 劈开 emoji 代理对；⛔ 只包顶栏 render 处，别套进 `cleanThreadDisplayTitle` 连侧栏一起截）；夜七轮的 300px 定宽保留为护栏。守护卫 04【250】第四条（3 处变异全抓）。
  ④ 验收 `popup-fits` 扩 ④-⑧：工作区菜单开 → fits → **点外面即关** → 重开 → Esc 关 → 无残留；【265】棘轮 accept.mjs 1483→1505（实测）。真机探针亲验：给测试会话改名「一二三四五六七八九十」→ 顶栏显示「一二三四五六…」。
- 🎚 输入框拖动把手改「骑边框」（10-06 夜九轮，用户令「放到输入框边框上，不要放里面，可以稍微长一点点，现在有点短」）：
  ① 把手从**框内顶部**的内嵌细条改成**骑在输入框顶边框上**：绝对定位 + 水平居中 + 纵向一半在框外（`top: 0; left: 50%; translate(-50%,-50%)`，锚 = `.composer` 新加的 `position: relative`）；命中面 96×12（胶囊本体之外留白），`touch-action: none` 保留（真机拖动不被滚动手势吃掉）。
  ② 胶囊 40→56px（「稍微长一点点」）；默认色 `--line`→`--faint`（骑在 --line 边框线上，同色会隐形）、hover `--muted`。
  ③ 顺手补偿：`.composer` 的 `padding-top 14→24`（= 原 14 + 把手去流前的净占位 10）—— 编辑区与顶边框的距离保持原样，不动观感。
  ④ 判据：守卫 11s 9→12 条（骑边框定位 / `.composer` 定位锚 / 56px）—— ⛔ 变异实测连抓两处**假绿**并当场收紧：`[\s\S]{0,N}` 窗口跨过 `}` 撞上邻居规则的同名属性、`\.composer \{` 首匹配撞上 `.docked-center` 变体 ⇒ **一律 `[^}]*` 规则体内匹配 + 行首锚定**；3 处变异全抓。验收 `composer-resize` 扩 **①b**（真 DOM：把手中点 == 顶边框线 ±2px、胶囊 ≥50px）；【265】棘轮 accept.mjs 1505→1514（实测）。
- 🧭 新手引导板块 + 首启「环境体检」弹窗整体删除（10-07 用户两条令：先要「侧栏底部加新手引导常驻板块，点击弹窗，/左选项右内容/迷你版设置界面；模型配置/开发工具/人格市场三个映射 + 版本更新日志置底；留好 UI 拓展接口，你从专业角度给新手定制」+ 追问「这个新手引导不能被对话选项遮住」；后追加「把那个首次安装启动的引导弹窗删了，反正现在也新手引导选项了」）：
  ① 新板块 `src/features/newbie-guide/`（自包含、不进 bag，样板同 component-library）：侧栏底部常驻入口 `.guide-entry`（在 `.thread-list` **之外**、账户行之上 —— ⛔ 放进列表会随滚动被内容压住（用户点名）；`flex:none` 防窄窗压扁）+ 迷你设置弹窗（`.modal-backdrop` 全局模态 400 档；左 `.guide-nav` / 右 `.guide-body`；三路关闭 = ✕ / 遮罩 / Esc）。**七节注册表 `GUIDE_SECTIONS`**（拓展接口 = 数组加一项：`action.kind="settings"` 跳真设置页 + `changelog:true` 渲染版本日志 + 纯说明节；**日志约定置底**）：快速上手（默认页）/ 配置模型 / **功能地图（10-11 增，全应用能力分类导览，入口名按 settingsNav 与侧栏实测核实）** / **进阶技巧（10-11 增，斜杠命令与按会话选模型，以 builtinCommandCatalog 为据）** / 开发工具 / 人格市场 / 更新日志。
  ② 版本日志 = **单一真相源**：新 IPC `whatsnew:history`（manifest → whats-new-ipc → registry → gen:ipc 生成物；数据仍是 `whats-new-notes.ts` 的 WHATS_NEW_ENTRIES，GitHub Release 链接在主进程拼好）；渲染层只画不抄（守卫 11x 负向钉「组件里无硬编码版本/日期数据」）。
  ③ **首启「环境体检」弹窗整体删除**：EnvCheckDialog 组件 + 自动弹出触发（part06 的 1.4s 定时检查）+ 体检/一键补齐/后台角标（installEnvMissing 并发队列、env-skip 等一组 localStorage 状态）+ 三处 CSS + bag 16 个字段全下线（part02/05/06/08 + timeline/main-stage/AppView 逐点切除；bag-types 1407→1386 项）。守卫翻**负向防复活**：04-misc【首启体检】段 + 07-turn-fold【32】三处（组件文件不许回来 / app-ui 层 env 状态与样式清零 / **删旧必须有新** = 侧栏 NewbieGuide 仍在位）。
  ④ 判据：新守卫 **11x-newbie-guide（17 条）**（入口在列表外 / 三映射与 settingsNav 真值对账 / 日志置底 / history 单源贯通 / 4 处变异全抓）+ 验收新项 **`newbie-guide`（6 条，10-07 轮）**（入口不被遮用 elementFromPoint 命中自身 —— ⛔ 必须**先等 boot-splash 摘掉**，否则命中启动页假红；弹窗开合 / 三映射+日志置底 / 跳转真落 model 页 / 日志真数据 / Esc 关）；**LATEST_ROUND = 10-07**（默认轮即本项；10-06 五项转回归证据）。真机实拍：首启无任何引导弹窗、`__envCheckDbg` 消失、侧栏底部入口 + 迷你设置弹窗完整。
  ⑤ ⛔⛔ 本轮两个真教训（都写进了守则注释）：**(a) 大段 CSS 区间删除会夹带共用规则** —— 环境体检块里混着 `.runtime-progress-bar` 一族（知识库页 / 开发工具页在用），整块删完【66】当场红，从 HEAD 按规则逐条回捞才补全；删 CSS 区前必须按**规则选择器**逐条过一遍，别只按区间切。**(b) preflight 会被更早的守卫红整段遮住** —— npm run check 是 `&&` 链，11h（并行会话在途）红了以后 check-preflight / bag-types 根本不会执行，`--ic-page`（08-settings-sheet 内联注入型，一直漏在【160】白名单外）这类陈年漏网就被一直遮着 —— 单跑下游检查才发现；【160】白名单已补登记 `--ic-page`。
- 🗜 上下文压缩链重建（10-07 夜十一轮，用户三条实证要求：「运行中会按压缩阀值自动触发模型侧真实压缩吗」「压缩线常驻、跟着历史消息往上走」「压缩完自动继续会话，上下文不丢」+ 授权调低阈值在真实大会话上实测）：
  ① **引擎侧实测取证**（隔离实例 + 真 rollout 文件）：当前引擎对压缩**不发任何 item 事件**（只有一条 turn/started+completed；压缩 item 只落 rollout）——且**自动压缩是内联完成的**：ContextCompaction 记录的 `turn_id` == **用户回合** id（手动 thread/compact/start 才是独立空回合）。命中阈值 = config.toml 顶层 `model_auto_compact_token_limit`（= 窗口 × autoCompactRatio，applyCustomModel 与启动漂移自愈两处同源写入）。
  ② **宿主侦测**（新 `electron/compaction-watch.ts` + worker op `check-compaction`）：每个 turn/completed 增量扫该线程 rollout **新增段**（worker 维护逐线程读取偏移 + 8KB 重叠 —— 压缩记录写在回合开头，之后同回合还能写几百 KB 工具输出，只读"尾部 N 字节"会被挤出窗口）→ 按**记录自己的 turn_id 归因**（== 刚完成回合 id）→ 落盘 `<userData>/compaction-records/<threadId>.json`（30 条/线程）+ 广播 `thread-compacted-host` + resume 重播（codex-ipc）+ 删除会话清落盘。⛔ 首版判据「非渲染层回合才查」被大会话实测**证伪**（自动压缩内联在用户回合里 ⇒ 真压缩全丢、存储恒空）——守卫留负向禁止复活。
  ③ **渲染层第三来源**：`src/lib/compaction-records.mjs`（内存镜像 + `useSyncExternalStore` 订阅，记录到达即重渲染）+ timeline 三源互斥（引擎 item → 宿主记录 → toast 兜底）；**锚点 10-07 改**「压缩记录**自己所在回合**（含）之前最近一条用户消息正上方」——新消息到来线不动、随历史往上走（旧口径"永远黏最新一条用户消息"= 用户实测点出的毛病）。
  ④ **压缩比例下限 0.5 → 0.1**（ModelSettingsSection 档位 0.1~0.95；⛔ 别退回 0 值区 —— 阈值变 0 会每轮都压）。⚠️ 真实档案 D:/11 里的 0.9 曾**从未生效**，真因是下面那条挂载时机事故，修好后 0.9 会真生效。
  ⑤ **实测证据**：大会话 01a11136（326,200 tokens / 1M 窗口）ratio=0.25 → 阈值 262,144 → 发一条消息 → 引擎真压缩（rollout ContextCompaction 实锤）→ 宿主广播 + 落盘 → `.compact-divider`「上下文已自动压缩」**在运行中出现、锚在用户消息上方、回合继续跑完**（59s）→ 重启重开会话线仍在（resume 重播）。判据：守卫【165】16 条（含 worker 增量扫描归因 / 负向禁旧判据 / 订阅接线）+【159】缓存归属与下限；验收新项 **compact-line**（新会话两条短回合 + 手动 compact 真链路 → 线出现/锚点/落盘）。
- 🧨 组合层挂载时机事故修复（10-07 夜十一轮挖出，由压缩实测触发）：`composition.gen` 的域挂载从**模块作用域**挪到壳在 `app.setPath("userData")` 之后 `process.nextTick(mountEnabledDomains)` —— 原方式在 userData 重定向前用**默认目录**的 app-settings.json 做停用域判定，读失败空对象进**进程级缓存** ⇒ **用户设置读取全部拿到空值**（实测：D:/11 的 autoCompactRatio 0.9 从未写进 config.toml，恒为默认 0.6 的 629146）；app-settings 缓存同时**按文件路径归属**（`cachedFor === file` 才命中，任何"重定向前的读"不再污染之后）。判据：【253】②「生成物只导出 + 壳在 setPath 后调用（认 nextTick/裸调两种形态）」+【270】真跑「require 生成物本身 0 挂载」+【159】「两条读取路径 + 保存路径都带路径命中」。⛔ 另一个坑：壳被域间接 require（`../main` 白名单依赖）时 `ENABLED` 表未赋值 ⇒ 同步调用 `exports.ENABLED is not iterable`（守卫真跑实测）⇒ 必须 nextTick 推迟到调用栈展开后。
- 🛠 开发工具安装体验改版（10-11，用户三条令：「每个下载的工具的卡片内加一个提示词复制功能图标，常驻」+「工具安装报错或者失败，会出现换行内容被剪切，展示不全，报错和失败做成弹窗」+「注意弹窗顺序」）：① 常驻图标 `.runtime-prompt-copy`（每个 `fallbackPrompt` 且非 guide 的工具卡都有，不等失败才出现；提示词正文仍是主进程 `runtime:list` 下发的原文，渲染层只复制）；② 失败呈现改版：`bag.runtimeModal` 加 `error` 字段（安装/卸载 catch 都写**完整报错原文**，此前这个 state 是死状态没人渲染）→ `DevtoolsSettingsSection` portal 渲染「完整报错」弹窗 `.devtools-error-*`（pre-wrap 全文可滚动可复制 + 复制错误信息 + 复制提示词交给 Codex + 关闭）；卡片留一行失败摘要 `.runtime-failed` 点开重看（从 runtimeProgress 同一前缀行重建，弹窗关了报错不丢）；旧内联块 `.runtime-fallback` 整体退役；③ **弹窗顺序**：错误弹窗 z-index **950** 严格大于二级 SettingsDialog 的 900 + portal 到 body（挂设置页树里会被 sheet stacking context 压住）+ Esc 在**捕获阶段** stopPropagation（否则同一个 Esc 把底下弹窗一起关掉）；④ 审查抓到并修掉：`.runtime-row` 是 4 列 grid，第 5 个子元素（失败摘要）必须 `grid-column: 1/-1` 否则挤进 22px 首列（旧 `.runtime-fallback` 同病，失败态少见从未暴露）。判据：守卫 11y **23 条**（新增 6：常驻图标/弹窗接线/z 950>900/Esc 拦截/pre-wrap/文案单源负向）+ 新验收项 **devtools-install-ux** 五条（LATEST_ROUND 10-07→10-11）；棘轮 accept.mjs 1689→1733（实测）。
- 🧭 新手引导内容扩容（10-11，用户令「优化新手引导界面里面的内容」+ 走「功能扫描 → 代码图谱 → 写内容 → code review」流程）：`GUIDE_SECTIONS` 5 节 → **7 节** —— 新增 **功能地图**（map：把 AI 变强 / 记住你 / 自动干活 / 派一群 AI / 创作与设计 / 声音陪伴 六组，全部按 settingsNav 页名与侧栏「···更多」实测入口名写，零编造）与 **进阶技巧**（tips：/plan /goal /compact /doctor、按会话独立选模型、任务清单与文件汇总卡、/archive 归档 —— 命令名以 builtinCommandCatalog 为据）；快速上手加「看左边的功能地图」交叉引用、配置模型补「调思考强度（/effort）」步。纯内容改动：组件/CSS/DOM 零变化，守卫 11x 17/17 绿、验收 `newbie-guide` 六条不受影响（默认停「快速上手」/ 三映射 / 日志置底全保留）。判据：check 全绿 + `--only newbie-guide`。
- 🔍 回合文件追踪：预算截断修复 + mac 断点诊断（10-07 夜十二轮，用户报「mac 上消息汇总下面的已编辑文件不展示」）：mac 侧链路**全平台同构**、断点藏在静默跳过点里而打包版 stdout 不可见 ⇒ 新增 `electron/turn-files-debug.ts`（诊断落盘 `<userData>/turn-files-diag.log`，JSON 行、512KB 上限）＋ 追踪器六个诊断点（快照跳过含 cwd 不在磁盘 / 根目录读取失败【mac TCC 权限的实锤点：EPERM/EACCES】/ 快照为空 / 收尾无快照 / 每次收尾心跳含 `truncated` 标记）+ boot 注入 `setTurnFileWatchDiag`；`thread/start` 的 cwd 登记改**引擎回执优先**（请求参数空串此前会赢 ⇒ 该线程追踪全程失明）。**同轮挖出真 bug（清档后验收复现）**：全局 4000 文件预算被 `release/win-unpacked`（约 5 万文件）整段吃光 ⇒ 真写的文件进不了快照、深处图标集文件被**误报「已删除」**；修法 = 单目录上限 `MAX_PER_DIR=600`（walk 与 walkLight 同口径）+ IGNORE 补 `release`/`*-unpacked`/`dist-electron` 等构建产物目录 + **截断时抑制删除判定**（截断点随本轮文件数漂移，删除只能"明确扫过却消失"才算）。判据：守卫 11p 扩 **57 条**（含「两处口径一致」「截断抑制 ×2」变异全抓）+ 验收 `file-summary` 31/31（显式断言目标会话 cwd==工作区根 —— 清档重播种后旧写法会点开别目录的老会话、diff 恒 0 假红）。
