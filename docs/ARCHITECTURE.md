# 应用架构

> 面向「这个应用是怎么搭起来的」。数字为 **2026-11-27（v0.0.82）实测**，口径一律 `wc -l` / `ls`。
> 规则条文（该放哪一层、加板块的 checklist、红线）见 [`ARCHITECTURE-RULES.md`](ARCHITECTURE-RULES.md)；
> 板块清单见 [`MODULES.md`](MODULES.md)；长文变更史见 [`FEATURE-LEDGER.md`](FEATURE-LEDGER.md)。
> 09-21 那份「目标形态草案」已归档到 [`archive/ARCHITECTURE-2026-09-21-目标形态草案.md`](archive/ARCHITECTURE-2026-09-21-目标形态草案.md)。

---

## 1. 运行时形态：三进程 + 一个引擎子进程

```
┌──────────────────────────────────────────────────────────────────┐
│ 主进程 (Electron main, electron/main.ts 1,573 行)                 │
│  窗口 / 托盘 / 自定义协议 / 单实例锁 / 全部系统能力                  │
│  ├─ electron/features/*.ts        158 个条目 = 121 个 IPC 域       │
│  ├─ codex-server.ts               spawn 引擎，stdio JSON-RPC       │
│  └─ 存储：codex-home / app-settings / 记忆原子 / 会话 rollout       │
└───────────────▲──────────────────────────────────────────────────┘
                │ ipcMain.handle（经 ipc-registry 账本登记）
┌───────────────┴──────────────────────────────────────────────────┐
│ 预加载桥 (electron/preload.ts，contextIsolation)                  │
│  window.codex.*  ← 由 ipc-channels.manifest.json **生成**         │
│  统一 __ipc：参数个数校验 / 错误归一化 [ERR_*] / 通道级超时表        │
└───────────────▲──────────────────────────────────────────────────┘
                │
┌───────────────┴──────────────────────────────────────────────────┐
│ 渲染层 (React 19 + Vite 8)                                        │
│  src/App.tsx 22 行 → AppView 992 行 → features/ 103 个域目录       │
│  状态：useHarnessApp 建 bag → 9 个 part → bag-types（自动生成）    │
└──────────────────────────────────────────────────────────────────┘

          引擎子进程：@openai/codex app-server
          上行 item/* turn/* 事件（JSON-RPC notification）→ 渲染层归约成回合
```

关键点：**引擎是子进程、不是内嵌库**。主进程只做「起进程 + 转发 JSON-RPC + 落盘」，对话状态的归约在渲染层完成。

---

## 2. 分层与依赖方向

| 层 | 目录 | 允许 | 禁止 |
|---|---|---|---|
| **壳层** | `src/App.tsx`、`src/features/app-view/`、`electron/main.ts` | 装配、路由、布局骨架、启动链、遍历注册面 | 写业务逻辑、持有域状态、长出新分支堆 |
| **域层** | `src/features/<域>/`、`electron/features/<域>.ts` | 域内自由实现（组件 / 状态 / 样式 / IPC） | 深链引别的域的内部文件（只许走对方公开面） |
| **基座层** | `src/lib/*.mjs`(+`.d.mts`)、`src/components/`、`src/hooks/`、`electron/*.ts` | 纯函数、通用件、通用 hook、引擎 / 桥 / 存储 / 策略 | 反向 import 域层 |

**依赖方向恒为**：壳 → 域 → 基座。域 ↔ 域只经 `app` 对象、显式 props、对方 barrel。

主进程侧另有「域组合层」：`electron/composition.json`（121 个域）→ `npm run gen:domains` → `composition.gen.ts`，只导出 `mountEnabledDomains()`，由壳在 `app.setPath("userData")` 之后 `process.nextTick` 调用（模块体求值早于壳句体，早挂会读错目录）。

---

## 3. 目录地图（实测）

| 位置 | 规模 | 职责 |
|---|---:|---|
| `src/App.tsx` | 22 行 | 只做 `useHarnessApp()` + earlyView 短路 + `<AppView/>` |
| `src/features/app-view/AppView.tsx` | 992 行 | 视图装配壳：编号段 `01-sidebar-shell` … `09-file-preview-editor` |
| `src/features/` | 103 个域目录 | 每个功能一个目录；`settings-*` 按页同构拆分 |
| `src/features/app-state/` | 组合根 + 9 个 part | `bag` 是渲染层唯一状态容器 |
| `src/lib/` | 纯函数 `.mjs` + 同名 `.d.mts` | 可被预检直接跑真断言 |
| `src/styles/` | 65 个分节 CSS | 前缀 = 域 id，禁跨域选择器 |
| `electron/main.ts` | 1,573 行 | 启动链 + 7 个搬不动的 handler（`theme:apply` + `window:popout-*`）+ 单例 |
| `electron/features/` | 158 个条目 / 121 个域 | 一个板块 = 一个域前缀 |
| `electron/*.ts` | 175 个顶层模块 | 引擎、桥、存储、策略、市场、记忆 |
| `electron/builtin-skills/` | 35 个内置技能 | 启动时落盘到 `$CODEX_HOME/skills` |
| `electron/ipc-channels.manifest.json` | 725 个通道 | IPC 桥**单一真相源** |
| `scripts/guards/` | 130 个守卫文件 | 每个板块可机器校验的不变量 |

---

## 4. IPC 契约链：manifest 是唯一真相源

```
electron/features/<域>.ts        handler 实现（defineFeature + ctx.ipcHost.handle）
        │  同轮登记
        ▼
electron/ipc-channels.manifest.json   通道 + 参数名（invokeArgs）  ← 手写源
        │  npm run gen:ipc
        ▼
electron/preload.ts        window.codex 的方法体（生成段，禁手改）
src/vite-env.d.ts          类型声明（生成段，禁手改）
electron/ipc-registry.ts   账本：prefix / count / file / channels（改通道要同轮改 count）
```

- ⛔ **实参只由 `invokeArgs` 决定**：manifest 里漏写某个参数名 = preload 层静默丢参（历史两次事故：工具描述恒全列、通知对象类别恒空）。守卫【2】逐字节比对生成物，`verify-preload-args.mjs` 在编译产物上验到 IPC 边界。
- ⛔ 没有 `preload.generated.ts`：那会让 `window.codex` 不存在。
- 新增一条通道 = handler + manifest + `gen:ipc` + registry 记账，四处缺一即红。

---

## 5. 状态模型：一个 bag + 按序 part

```
useHarnessApp.tsx（组合根，39 行）
  ├─ 建 bag（一个可变对象，跨 part 共享）
  ├─ 按序调用 9 个 part：parts/part01 … part09
  └─ 合并 return → HarnessAppApi（壳与各域按需解构）

bag-types.ts  ← 自动生成（从 part 实现推断），禁手改；守卫【93】双向覆盖 + 类型串比对
```

- 渲染层**不引入全局 store**：状态只挂 `bag`，跨域通过 `app` 传引用；纯展示件 props ≤5。
- 事件箱模式（跨模块一次性通知）用极小 `.mjs` store + `useSyncExternalStore`，例如 `panel-zoom` / `canvas-open` / `canvas-activity`。

---

## 6. 引擎事件 → 回合：归约在渲染层

| 事件 | 处理 |
|---|---|
| `item/*`（消息 / 推理 / 工具调用 / 文件变更 / 审批） | 追加到对应回合的条目列表 |
| `turn/started` · `turn/completed` | 只标状态；**回合容器必须由事件流建立**，未知回合的 item 不能丢弃（用 userMessage 兜底建回合，否则「用户消息不出现」） |
| `request/*`（审批 / 询问） | 弹覆盖层；**回合结束必须释放覆盖层**（唯一实现 `app-view/helpers/turn-overlays`） |
| 排队消息 | 由引擎自己启动，宿主不假设能启动它 |

渲染层的三条硬约束：钉顶几何只看正文底、内容高度变化后必须重算贴底、灰线只留回合级大折叠。

---

## 7. 记忆与技能

- **记忆**：一个内核 + 三作用域（private / team / project），落盘 `<workspace>/.codex-harness/memory/`；注入有预算（用户级 4,000 字符、工程级按层分配），写在 `memory-layers.ts` / `memory-lessons.ts`；前端 `memory-ui` 只读。
- **技能**：两个落点 —— 全局 `$CODEX_HOME/skills/` + 项目级 `<cwd>/.codex/skills/`（引擎原生发现）；`.codex-harness/skills` 引擎不认。内置技能启动时由 `builtin-skills/` 落盘。
- **工具面**：在 `thread/start` 定死，resume / fork 的 `dynamicTools` 引擎整份忽略；派生会话的工具面由主进程按会话类型决定（`ownsHostToolSurface`）。

---

## 8. 打包与发布

```
scripts/prepare-windows-tools.cjs   →  resources/tools（Node / nuphus / agent-desktop / VS Code CLI /
scripts/prepare-mac-tools.cjs           cloudflared / ponytail / python / rg / uv / jq / ninja /
                                        7-Zip / yt-dlp / CMake / adb；>50MB 的大件按需下载）
        ↓  electron-builder（extraResources / afterPack 逐条补齐）
Windows NSIS exe  +  macOS arm64 / x64 zip
        ↓  git push origin v<版本>（tag 触发 .github/workflows/release.yml）
GitHub Releases（唯一渠道，完整包；客户端点胶囊才下载安装）
```

版本号 4 处对齐：`package.json` / `package-lock.json`（根 + `packages[""]`）/ `electron/whats-new-notes.ts` 最新条目 / `docs/releases/v<版本>.md`。`app.getVersion()` 是运行时唯一版本来源，⛔ 不手写第二份。

---

## 9. 质量门

- **`npm run check`**：清 dist → 构建（`tsc -p electron` + vite）→ 130 个守卫 + 5 个结构校验（bag-types / 死导入 / require 路径 / 运行时文件）→ 末尾总账必须 0 ✗。
- **`npm run accept`**：驱动真实应用跑验收项，失败自动截图。
- 守卫是**可读的判据**：改哪个板块，就往 `scripts/guards/` 对应域文件补一条机器可校验的不变量；守卫还会「自洽地错」，所以关键契约要问「主进程真返回吗」，参照值要独立测量。

---

## 10. 加一个功能，改哪几处

1. **新建板块目录**：`src/features/<域>/`（组件 + 状态 + 样式），页面组件命名导出、可整页 lazy。
2. **主进程域文件**：`electron/features/<域>.ts`，`defineFeature` + `ctx.ipcHost.handle`。
3. **登记 IPC**：`ipc-channels.manifest.json` 加通道 → `npm run gen:ipc` → `ipc-registry.ts` 改该域 `count`。
4. **状态**：新状态进既有 part 或新建 part，同轮更新自动生成的 `bag-types.ts`。
5. **样式**：`src/styles/<编号>-<域>.css`，类前缀 = 域 id。
6. **判据**：往 `scripts/guards/` 补断言，`npm run check` 全绿。
7. **文档**：`docs/MODULES.md` 板块表、`docs/FEATURE-LEDGER.md` 一行、必要时 `DESIGN.md`。

⛔ 新增功能一律**独立板块 + 留拓展接口**，不往既有域里顺手加块。
