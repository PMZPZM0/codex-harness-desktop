# 项目改造计划与现状（从 AGENTS.md 搬出，11-19）

> 查阅型：只在需要了解「架构改造做到哪 / 插件化方案是什么」时读。
> ⛔ 内容与搬出前逐字一致（11-19 搬家，未改一字）。

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
