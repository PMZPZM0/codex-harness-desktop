/**
 * 拓展接口目录 —— 应用内「设置 → 拓展接口」页的数据真相源（09-24 立；10-30 全量校准）。
 *
 * 为什么单独立一个纯函数库（而不是写在页面组件里）：
 *   ① 页面只负责渲染，数据可被预检守卫**直接断言**（通道数 = manifest 实际条数、列出的路径必须存在）；
 *   ② 新同事 / AI 接手时，这一份就是"哪些地方可以扩展、怎么扩、扩完怎么生效"的准绳。
 *
 * ⛔ 每条都必须给全五要素：用途 / 扩展位置 / 扩展方式（可照做） / 生效方式 / 配套与坑。
 *    缺任何一项都视为"没写"（守卫【128】会查字段非空）。
 * ⛔ 这里的 paths 必须真实存在（守卫【128】逐个 existsSync）；`$` `<` `%` `~` `*` 开头或绝对路径会被跳过校验，
 *    但正文里也不要写"计划中"的路径。
 * ⛔ 10-30 校准范围：补上一年来新增的板块（组合层 / 二级弹窗 / 内嵌浮窗 / 知识库后端 / 云账号 /
 *    技能包 / CLI 智能体 / 自动更新 / 开发工具目录 / 日志与台账），并修掉过期描述（工作区技能目录、
 *    插件市场只有一家、个性化只讲应用侧等）。
 */

/** 分组顺序即页面展示顺序 */
export const EXTENSIBILITY_GROUPS = ["接口与契约", "界面与呈现", "智能体与能力", "记忆与质量"];

/**
 * IPC 通道数（页面统计用）。
 * ⛔ 这个数字**由守卫【128】保证与 manifest 实际条数一致**（写死在别处必然过期）。改 manifest 后若忘了改这里，预检会红。
 */
export const IPC_CHANNEL_COUNT = 604;

export const EXTENSIBILITY_ENTRIES = [
  /* ── 接口与契约 ─────────────────────────────────────────────────────── */
  {
    id: "domain",
    group: "接口与契约",
    name: "功能板块（组合层插件）",
    purpose: "新功能一律做成独立板块：defineFeature 声明依赖与清理，组合表决定启停，生成物负责挂载 —— 加板块不再改壳文件。",
    where: [
      "electron/composition.json（启用清单：id / file / export）",
      "electron/context.ts（defineFeature / inject / effect）",
      "electron/ipc-host.ts（通道注册容器）",
      "electron/runtime/seams/index.ts（宿主能力接缝：app / shell / dialog / window …）",
      "electron/composition.gen.ts（生成物，禁手改）",
    ],
    steps: [
      "在 electron/features/ 建一个板块文件（或目录），用 defineFeature 声明 id / inject / setup",
      "组合表加一行 { id, enabled, file, export }；⛔ 一个板块只用一个域前缀（多前缀必须拆）",
      "跑 npm run gen:domains 重生成挂载表（生成物只导出 mountEnabledDomains，壳在 setPath(userData) 之后 nextTick 调用）",
      "通道注册走 ipcHost.handle + manifest（见「IPC 请求接口」那条）",
      "宿主能力（窗口 / shell / 对话框）走 ctx.get(\"host\") 的接缝，不要直接 import electron",
    ],
    effect: "新增/停用板块在下一次启动生效（组合表决定挂载）；域内 handler 重启后可用。",
    guards: "【252】组合表与生成物、【253】板块边界（一板一前缀 / 生成物只导出 / 挂载时机）、【270】require 生成物零挂载",
    pitfalls: [
      "⛔ 组合层生成物在模块作用域自动挂载会导致 userData 重定向前的设置读空（10-07 事故），必须由壳在 setPath 后调用",
      "⛔ 多前缀文件会被【253】⑥ 棘轮抓到（欠账只许缩不许长）",
      "领域之间的共享辅助函数下沉到基座层（electron/*.ts），不要互相深链",
    ],
  },
  {
    id: "ipc-invoke",
    group: "接口与契约",
    name: "IPC 请求接口（渲染层 ↔ 主进程）",
    purpose: "渲染层调用主进程能力的唯一通道。加一个方法 = 改 manifest + 跑生成器，不再手写 preload / d.ts 多处。",
    where: [
      "electron/ipc-channels.manifest.json（单一真相源）",
      "electron/ipc-registry.ts（前缀账本：prefix / count / file / channels）",
      "electron/features/<域>.ts（handler 实现）",
      "electron/preload.ts（生成段，禁手改）",
      "src/vite-env.d.ts（生成段，禁手改）",
      "src/lib/ipc-error.mjs（错误码解析）",
    ],
    steps: [
      "manifest 加一条：name / channel / paramsImpl / paramsDecl / returns / invokeArgs / note",
      "跑 npm run gen:ipc —— 同步 count、重生成 preload 与 d.ts 的 gen 段、并重生成内置技能 harness-api 清单",
      "ipc-registry.ts 补该前缀的账本行（prefix 与文件名/通道前缀同源）",
      "在 features/<域>.ts 里 ipcHost.handle(channel, …) 实现并返回结果",
    ],
    effect: "生成物随下次构建生效；主进程新 handler 需重启应用注册。",
    guards: "【2】22 条：生成段逐字节一致、所有 invoke 走 __ipc、账本全登记、手写面收敛、minArgs 正确",
    pitfalls: [
      "gen 段禁手改（逐字节比对会红）；生成物必须内联在 preload（沙箱禁相对 import）",
      "渲染层不要读 error.code —— 跨 contextBridge 会丢，统一用 ipcErrorCodeOf(e) 解析消息前缀",
      "只改 manifest 不跑 gen:ipc = 预检红（且 harness-api 技能清单会过期）",
    ],
  },
  {
    id: "ipc-event",
    group: "接口与契约",
    name: "IPC 事件通道（主进程 → 渲染层推送）",
    purpose: "流式输出、进度、状态变化等单向推送。订阅必须可退订，且不能误伤别人的监听。",
    where: ["electron/preload.ts（手写事件区）", "src/vite-env.d.ts（手写声明区）"],
    steps: [
      "主进程用 sendToWindow(\"harness:event\", { type, … }) 或 webContents.send(\"<域>:<事件>\", payload) 发送",
      "preload 手写区加 onXxx: (listener) => __on(\"<域>:<事件>\", listener, …)",
      "vite-env.d.ts 手写区补 onXxx(listener: (payload: T) => void): () => void",
      "消费侧在 useEffect 里订阅并 return 退订函数（part05 事件订阅三件套）",
    ],
    effect: "preload 改动需重新加载窗口（重启应用）生效。",
    guards: "【2】：__on 幂等订阅、preload 不许 removeAllListeners（会清掉同通道其它订阅）",
    pitfalls: [
      "同一监听函数重复订阅只生效一次（按引用去重）",
      "退订要精确到本次注册，别用 removeAllListeners",
      "事件里带 threadId 时消费侧先按当前会话过滤（后台会话的事件不许串到前台）",
    ],
  },
  {
    id: "capability",
    group: "接口与契约",
    name: "外部能力（MCP / 连接器 / 插件市场 / CLI 智能体）",
    purpose: "把外部能力接进来：MCP 工具、连接器（OAuth）、两个插件市场、CLI 智能体，各自有注册与开关表。",
    where: [
      "electron/capability-registry.ts（能力快照与「当前链路」判定）",
      "electron/features/plugins-ipc.ts（插件安装 / 启停）",
      "electron/codex-market.ts（Gitee 插件镜像）",
      "electron/codex-official-market.ts（Codex 官方市场：GitHub openai/plugins）",
      "electron/features/cli-agents-ipc.ts（命令行 AI 接入）",
      "src/features/cli-agents/",
    ],
    steps: [
      "MCP：走 mcp-servers:* 覆盖表启停；工具级权限用 mcp-servers:set-tool-permission",
      "插件：Gitee 源走 plugins:market-*，官方源走 official-market 通道；装完整理本地清单后由引擎暴露",
      "CLI 智能体：在「开发工具 → CLI 智能体」登记（启用 + 可执行名），之后 @ 直接派活（同 runDelegatedTask）",
      "能力现状统一在 capability-registry 汇总，界面「当前能力链路」读它（别各页自算）",
    ],
    effect: "插件/连接器启停通常要重启引擎；CLI 智能体保存即生效（派活走新回合）。",
    guards: "【2】通道三件套；【11i】能力网关；【239】Gitee 源锚定；【254】【255】官方市场；【12ah】CLI 智能体",
    pitfalls: [
      "两个插件源的 slug 有重名（linear / github）——安装进度事件 type 不许共用",
      "引擎 0.157+ 对 MCP 工具延迟暴露：`agent_invoke` 这类要同时挂 harness_tools 网关，裸名调不到",
      "官方市场插件大多要鉴权（ON_INSTALL / ON_USE），卡片必须写「装了 ≠ 能用」",
    ],
  },
  {
    id: "dev-tools",
    group: "接口与契约",
    name: "开发工具目录（按需下载）",
    purpose: "「设置 → 开发工具」里的运行时清单：一条 spec = 检测 marker + 安装链 + 卡片文案，≤50MB 随包、以上按需下载。",
    where: [
      "electron/features/dev-runtimes.ts（devRuntimeSpecs / marker / builtIn / kind）",
      "electron/features/runtime-ipc.ts（runtime:install / uninstall / cancel / list）",
      "scripts/install-runtimes.cjs（下载与解压，国内镜像优先）",
      "scripts/prepare-windows-tools.cjs（随包产物现造）",
      "scripts/prepare-mac-tools.cjs",
    ],
    steps: [
      "devRuntimeSpecs 加一条：name / description / size / marker / kind（download | guide | plugin | bundled）",
      "安装分支：npm 包用 runNpmInstall，归档包在 install-runtimes.cjs 里加下载源；系统级软件用 kind=\"guide\"",
      "marker 必须指向**真实产物**（例：7za.exe 而非 7z.exe），否则旧安装会被误判成已装",
      "随包项三处同步：package.json extraResources + 两个 prepare 脚本；否则守卫【29】红",
      "需要 Codex 工具时：在 dispatch-core 的工具表加一项 + 常驻指令一条（工具在表里模型才知道用）",
    ],
    effect: "卡片随设置页刷新出现；装完按需重启引擎（涉及 MCP 注册的）才可用。",
    guards: "【29】随包三处一致、【83】pip 默认清单负向、【265】棘轮；验收 `devtools-install-ux`",
    pitfalls: [
      "⛔ 随包根级 node_modules 会被 electron-builder 丢弃 —— 必须单独写一条 extraResources 映射",
      "⛔ 安装失败要弹完整报错并可复制（单行 toast 会剪切多行）",
      "卸载只删自己装的目录与记账，不动用户数据与随包件",
    ],
  },
  {
    id: "updates",
    group: "接口与契约",
    name: "自动更新体系（组件 / 补丁 / 镜像）",
    purpose: "所有可更新组件共用一份注册表与一条更新链：清单、开关、版本探测、下载与回滚都在这里，界面只读不判。",
    where: [
      "electron/update-registry.ts（可更新项与「不支持更新」原因）",
      "electron/update-backends.ts（手动与后台共用的 updateComponent）",
      "electron/updates.ts（应用自更新：NSIS 差分 + blockmap）",
      "electron/gh-mirror.ts（镜像前缀单一真相源）",
    ],
    steps: [
      "update-registry 加一项（id / 分组 / 探测函数 / 更新函数），同时登记到控制台开关清单（autoUpdateItems）",
      "更新动作一律走 updateComponent（快照 → 更新 → 失败回滚），不许在页面里另写下载",
      "应用自更新：Release 需同时上传安装包、*.exe.blockmap、latest.yml；旧版本 blockmap 必须保留作基线",
      "镜像顺序固定 gh-proxy → ghfast → 直连，取 gh-mirror 的 mirrorCandidates（带令牌请求绝不走镜像）",
    ],
    effect: "开关与清单即时生效；组件更新完成后按需重启引擎/应用。",
    guards: "【12e】更新镜像、【12j】技能/插件自动更新、【12k】统一更新体系、验收 `updates-simplified`",
    pitfalls: [
      "⛔ 不使用 /releases/latest（各产品 Release 专用），不跨仓复用安装包 / blockmap / latest.yml",
      "⛔ 重启引擎失败 ≠ 安装失败（前几步文件已落盘，要如实报 pending 而不是整个失败）",
      "套娃风险：更新器的依赖本身不要在更新中被替换（先落盘再换）",
    ],
  },

  /* ── 界面与呈现 ─────────────────────────────────────────────────────── */
  {
    id: "settings-page",
    group: "界面与呈现",
    name: "设置页（一行一页）",
    purpose: "设置面板每个页面：加一页 = 联合类型 + 注册表 + 导航一项 + 帮助总览一项，派发由注册表统一完成。",
    where: [
      "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/00-settings-registry.tsx",
      "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/00-settings-registry.tsx",
      "src/features/app-view/helpers/catalogs.ts（settingsNav）",
      "src/features/app-view/types.ts（SettingsPage）",
      "src/components/HelpDialog.tsx（OVERVIEW_GROUPS）",
    ],
    steps: [
      "types.ts 的 SettingsPage 加 id",
      "新建 src/features/settings-<域>/index.ts + 页面组件（收 props，不用全局单例）",
      "对应 pages/*.tsx 里加 render（lazy import，别写进壳）",
      "catalogs.ts 的 settingsNav 分组加 [\"<id>\", \"名称\", 图标]",
      "HelpDialog 的 OVERVIEW_GROUPS 同组补 { page, what, when } —— 侧栏与总览必须逐组同名同归属",
    ],
    effect: "构建后即时可见（纯渲染层改动）。",
    guards: "【101】id 唯一 / 注册表覆盖 nav / 二级页有 back；【247】侧栏与总览逐组一致；【12ad】页面统一版式",
    pitfalls: [
      "导航 / 注册表 / 总览三处必须同改，缺一个用户就找不到页",
      "页面内不写 settingsPage 分支逻辑；状态经 app（HarnessAppApi）按需解构",
    ],
  },
  {
    id: "dialog",
    group: "界面与呈现",
    name: "设置内二级弹窗（两级 IA）",
    purpose: "开发工具 / 拓展接口这类「分类卡 + 明细」页：一级只放分类卡，内容一律进 SettingsDialog，统一层级与交互。",
    where: [
      "src/components/SettingsDialog.tsx（size sm/md/lg、Esc/遮罩关、portal 到 body）",
      "src/features/settings-devtools/DevtoolsSettingsSection.tsx（一级卡 + 二级分支）",
      "src/features/settings-extensibility/ExtensibilitySettingsSection.tsx（同款）",
    ],
    steps: [
      "一级页只渲染分类卡（统计 + 搜索），详情用 SettingsDialog 承接（内容不内嵌一级页）",
      "尺寸：sm = 确认类（高随内容）、md = 普通面板、lg = 大清单",
      "层级：设置内弹窗 900；错误/二次确认档 950 且 portal 到 body",
      "Esc 在弹窗内关闭；需要拦捕获时 stopPropagation，避免连底下设置面板一起关",
    ],
    effect: "纯渲染层，构建即生效。",
    guards: "【dtIA】面板不许出现在一级渲染分支；【268-c】同一插槽 id 只消费一次；验收 `popup-fits`",
    pitfalls: [
      "⛔ 内部确认不要用 AppView 的 openAppConfirm —— 它挂在设置遮罩层之下，弹出来看不见（10-30 实测）",
      "⛔ 原生 confirm/alert 禁用（关闭后吞焦点，【191】）",
      "祖先有 transform/backdrop-filter 时 fixed 会退化 ⇒ 弹窗必须 portal 到 body",
    ],
  },
  {
    id: "function-menu",
    group: "界面与呈现",
    name: "主界面 · 功能入口（侧栏快捷组）",
    purpose: "侧栏「新建任务 / 指挥中枢 / 拓展功能」下面那组可排序入口：加一项 = 模型表一条 + 动作落到侧栏总线，两处展示位置共用同一份配置。",
    where: [
      "src/features/function-menu/menu-model.mjs（条目定义 / 默认顺序 / 分组）",
      "src/features/function-menu/store.ts（排序、更多分组、top|bottom 持久化）",
      "src/features/function-menu/FunctionMenu.tsx（渲染 / 拖动排序 / 更多分组）",
      "src/features/app-view/AppView/01-sidebar-shell.tsx（两处落点 + 动作总线）",
    ],
    steps: [
      "menu-model.mjs 加条目（id / label / 图标 / 默认 section），id 稳定（配置里存的就是它）",
      "动作统一经 setFunctionMenuActionHandler 回侧栏壳分流（设置页 / 画布 / 弹窗各自在这里处理）",
      "排序与「更多」由 store 持久化；top/bottom 共用同一份顺序",
      "需要首次教程就挂进 FunctionMenuTourHost 的 tour 数据",
    ],
    effect: "保存即生效（渲染层 + localStorage）。",
    guards: "验收 `function-menu`（拖动 / 两处位置 / 更多分组）；侧栏与总览一致性【247】",
    pitfalls: ["菜单里别写业务分支（两处展示位置会分叉）", "id 改名 = 用户排序配置失联；只改 label"],
  },
  {
    id: "global-shortcut",
    group: "界面与呈现",
    name: "全局快捷键（系统级）",
    purpose: "加一条不受焦点限制的系统快捷键（截图 / 语音已各有一组）：纯函数净化 + 注册表 + 设置页录入。",
    where: [
      "electron/accelerator.ts（sanitizeAccelerator / acceleratorLabel）",
      "electron/screenshot.ts（createHotkeyRegistry：先注册成功才注销旧键）",
      "electron/features/screenshot-ipc.ts（启动注册 + 变更即时重挂）",
      "src/features/settings-screenshot/ScreenshotSettingsSection.tsx（录入控件）",
    ],
    steps: [
      "新键位先进 sanitizeAccelerator（≥1 修饰键；主键只收字母/数字/F1-12/Space）",
      "注册走 createHotkeyRegistry.apply：新键成功后才注销旧键；失败保留原设置并回传 error",
      "设置变更后立刻重挂；设置页用 keydown 捕获录入（主键优先 e.code）",
      "mac 与 Windows 的展示差异交给 acceleratorLabel，存储一律 Electron accelerator 原文",
    ],
    effect: "保存后立即生效；被占用时设置页显示冲突原因。",
    guards: "【129】：注册失败必须记录并可读回、先注册成功才落盘",
    pitfalls: ["先注销再注册 = 新键被占用时两头空", "两条快捷键不许同键（后者必然失败且原因不直观）"],
  },
  {
    id: "theme",
    group: "界面与呈现",
    name: "主题与配色",
    purpose: "界面主题：新增一套配色 = 注册表加一行 + 一段 CSS 变量块；写死色值会在暗色下瞎掉。",
    where: ["src/lib/themes.ts", "src/styles/01-base-and-chrome.css"],
    steps: [
      "THEMES 加一行 { id, label, preview }",
      "01-base-and-chrome.css 加 :root[data-theme=\"<id>\"] { …变量块… }（照抄 dark 块改色值）",
      "暗色系新主题同步 theme:apply（标题栏与滚动条判定）",
      "新增/修改 CSS 变量时同步 DESIGN.md 的变量表",
    ],
    effect: "切换即时生效（data-theme + localStorage）。",
    guards: "【2】主题注册表由注册表渲染；【170】DESIGN.md 变量表真值对账",
    pitfalls: ["localStorage 脏值回落 light（normalizeThemeId），别绕过", "颜色只走主题变量（不写死十六进制）"],
  },
  {
    id: "style-section",
    group: "界面与呈现",
    name: "样式分节（CSS 与层级带）",
    purpose: "样式按域分节管理：新域加一个分节文件，顺序即级联优先级；浮层层级必须落在设计好的层级带里。",
    where: ["src/styles/<NN>-<域>.css", "src/styles.css（入口 @import，顺序=级联优先级）"],
    steps: [
      "src/styles/ 新增 NN-<域>.css（编号接末尾，别插队）",
      "styles.css 末尾追加 @import（顺序与文件名升序一致）",
      "选择器前缀用域 id；浮层按 DESIGN.md 的层级带取值（主界面 <30 / 画布 90 / 模态 400 / 轻浮层 1000 / toast 9999）",
      "设置页相关样式尽量复用 .settings-card / .settings-exp-card 一套壳",
    ],
    effect: "构建后生效。",
    guards: "【2】CSS 覆盖告警；【12af】CSS 层级棘轮；【198】层级带（严格排序 + 画布弹层不 portal）",
    pitfalls: [
      "⛔ 别在 styles.css 直接写选择器（@import 必须最前）",
      "⛔ 改顺序会改变级联优先级（同名类会互相盖）",
      "祖先 transform/backdrop-filter 会创建 containing block，fixed 浮层要 portal",
    ],
  },
  {
    id: "commands",
    group: "界面与呈现",
    name: "斜杠命令与命令面板",
    purpose: "输入框的 /命令 与命令面板条目。",
    where: ["src/features/app-view/helpers/catalogs.ts（builtinCommandCatalog / slashCommands）"],
    steps: [
      "builtinCommandCatalog 加条目（id / 展示名 / 说明 / 需要的处理）",
      "需要执行逻辑就在发送路径分支处理（保持纯前端可判定，不加隐藏通道）",
    ],
    effect: "构建后生效。",
    guards: "【101】相关（catalogs 导出面）",
    pitfalls: ["命令面板与斜杠命令是两份表，注意别只改一处"],
  },
  {
    id: "embedded-surfaces",
    group: "界面与呈现",
    name: "内嵌页面与独立浮窗（宠物 / 前端画布 / HTML 预览）",
    purpose: "除了设置页，还有几类整块界面：透明置顶浮窗（宠物、活动气泡）、应用内画布（前端开发）、右栏实时预览。它们各有协议与窗口约束。",
    where: [
      "electron/features/pet-window.ts（宠物浮窗）",
      "electron/features/pet-ipc.ts",
      "electron/features/pet-state.ts",
      "src/features/pet/",
      "electron/sketch-protocol.ts（前端开发画布 sketch://）",
      "scripts/sketch-bridge.js",
      "electron/features/html-preview-ipc.ts（HTML 实时预览）",
      "src/features/html-preview/",
      "src/features/dev-port/（本机测试端口自动开右栏）",
    ],
    steps: [
      "新协议：主进程 registerSchemesAsPrivileged 声明（standard/secure）、放行扩展名与可信根、另写 handler",
      "CSP 里**显式**加该 scheme（`*` 不覆盖自定义协议，img-src/frame-src 都要）",
      "浮窗：窗口 → 渲染层按 query 分流（main.tsx），⛔ 不进 App() 的条件 hook",
      "画布桥：postMessage 握手 + 回执；写回只走上游自己的导入通道（不直接改存储）",
      "同时跑 e2e 时把浮窗 target 排除（否则 CDP 会连错窗口）",
    ],
    effect: "协议/窗口改动需重启应用；页面内交互构建后生效。",
    guards: "【232】宠物（CSP 显式 scheme / 启动页不闪白 / 拖拽不挂 drag 区）、【283】前端画布、【12t】HTML 预览、【12ag】端口自动打开",
    pitfalls: [
      "⛔ CSP `*` 不覆盖 pet:/sketch:，漏写 = 静默空白（截图全透明、computed style 却正常）",
      "⛔ 浮窗必须在首帧前摘掉启动页，否则桌面闪白",
      "⛔ 宠物窗口不登记 window-bus，主窗关闭由 window-factory 显式关",
    ],
  },

  /* ── 智能体与能力 ───────────────────────────────────────────────────── */
  {
    id: "skills",
    group: "智能体与能力",
    name: "技能（方法论 / 脚本包 / 技能包）",
    purpose: "把可复用流程沉淀成技能，引擎原生发现并在需要时读取；第三方的成套技能走「精选技能包」一键装。",
    where: [
      "$CODEX_HOME/skills/<名>/SKILL.md（跨项目）",
      "<工作区>/.codex/skills/<名>/SKILL.md（项目级）",
      "electron/builtin-skills/（应用内置技能，启动时 ensureBuiltinSkills 落盘）",
      "electron/features/skill-packs-ipc.ts（精选技能包）",
      "electron/skill-packs-catalog.ts",
    ],
    steps: [
      "建目录并写 SKILL.md（frontmatter 必须有 name + description，否则不进技能列表）",
      "项目级优先（随项目走）；跨项目才放 $CODEX_HOME/skills",
      "内置技能改 electron/builtin-skills/<NN>-skill-<名>.ts",
      "技能包：catalog 加一条（repo / license / 配套），安装走国内镜像 → skills/ 子树 → 逐个 auditSkill → 归属凭据",
    ],
    effect: "引擎下一次读取技能清单时生效（新会话即可）；内置技能/技能包安装后需重启引擎。",
    guards: "【103】技能包装配、【113】【114】元技能与安装前审计、【12ai】技能包（审查/归属/卸载边界）、【12j】技能自动更新",
    pitfalls: [
      "⛔ 不要放 <工作区>/.codex-harness/skills —— 引擎不认那个目录",
      "技能包的每条 SKILL.md 必过 auditSkill；卸载只删带 .skill-pack.json 凭据的目录（内置/用户技能不许碰）",
      "技能被「使用」的常见形态是模型读 SKILL.md（一条命令），界面据此显示「使用技能 …」",
    ],
  },
  {
    id: "agent-dispatch",
    group: "智能体与能力",
    name: "专家 / 专家团 / 子智能体 / CLI 智能体派活",
    purpose: "把任务派给另一个会话执行：专家（单人）、专家团（主理人 + 成员）、子智能体、外部 CLI 共用同一条委派链。",
    where: [
      "electron/features/delegation.ts（runDelegatedTask：开独立会话 / 归属登记 / 产物回传）",
      "electron/features/dispatch-core.ts（dispatch 工具表与执行端）",
      "electron/features/expert-market-ipc.ts（专家包）",
      "electron/features/soul-market-ipc.ts（人格包）",
      "src/features/app-state/parts/part08/01-seg.tsx（dynamicTools 注册）",
      "src/features/app-state/parts/part05/event-router/02-request.tsx（item/tool/call 分发）",
    ],
    steps: [
      "新调度类型：在 dispatch-core 的工具表加 schema，执行端走 runDelegatedTask（与专家/CLI 同一闸）",
      "需要渲染层参与的工具：buildDynamicTools 注册 + part05 分发到 IPC",
      "归属：成员会话登记 teamId / 发起线程；被调度会话 restrictedThreadRole（不许再套娃调度）",
      "身份一律取引擎回传（params.threadId），不接受模型自报",
    ],
    effect: "工具面在 thread/start / resume 注入 ⇒ 新会话或切走再切回才出现；派活本身即时。",
    guards: "【11i】能力网关与身份、【12ah】CLI 智能体、团队归属相关守卫",
    pitfalls: [
      "⛔ 被调度会话再建调度 = 套娃，restrictedThreadRole 已闸住",
      "⛔ 同一能力不要挂两个工具名（模型只用最直白的那个，另一套被绕过）",
      "派活产生的临时会话要能归档（agent_archive_sessions），否则侧栏越用越乱",
    ],
  },
  {
    id: "dynamic-tools",
    group: "智能体与能力",
    name: "宿主 dynamicTools 与能力网关",
    purpose: "宿主自己提供的工具：小的直接注册成 dynamicTool，多的收进 harness_tools 网关（引擎 0.157+ 对 MCP 工具延迟暴露）。",
    where: [
      "src/features/app-state/parts/part08/01-seg.tsx（buildDynamicTools：名字/描述/参数 schema）",
      "src/features/app-state/parts/part05/event-router/02-request.tsx（item/tool/call 分发）",
      "electron/features/dispatch-core.ts（harness_tools 的能力表与执行端）",
    ],
    steps: [
      "专用工具：buildDynamicTools 加一条（描述里把适用/禁用场景写清，模型才知道何时用）",
      "分发：part05 的 item/tool/call 分支 → IPC → 主进程执行端；⛔ 不新增渲染层业务分支",
      "通用/冷门能力进 harness_tools：dispatch-core 的能力表加 { name, args schema }，执行端 dispatchRpcCall",
      "配套常驻指令一条（developer-instructions），否则模型不知道有这个工具",
      "上线后老会话需切走再切回（dynamicTools 只在 start/resume 注入）",
    ],
    effect: "新会话立即可见；老会话 resume 后可见。",
    guards: "【11i】网关（名单 / 分发 / 身份 / 网关唯一性）、【153】能力清单技能（harness-api 生成）",
    pitfalls: [
      "⛔ 网关只放「没有专用工具」的能力（agent_invoke / 生图已有专用名，别重复挂）",
      "⛔ 一次注入 19 份 schema 是常驻 token 成本 —— 用网关按需取参数说明",
      "描述里不许写不存在的工具名（模型会照做然后失败）",
    ],
  },
  {
    id: "tool-display",
    group: "智能体与能力",
    name: "工具与命令的展示映射（真实状态映射）",
    purpose: "把引擎原始事件翻译成人话：技能归属、命令意图、用途、行数、结束态；历史会话按新规则重算。",
    where: [
      "src/lib/tool-display.mjs（技能/插件识别、入参摘要、目标取舍）",
      "src/lib/command-display.mjs（意图词表、用途提炼、剥壳、路径归一、动作短语）",
      "src/lib/turn-fold.ts（折叠芯片与原子归类）",
    ],
    steps: [
      "新增技能特征：tool-display.mjs 的 SKILL_MATCHERS 加一行（认不出必须返回 null）",
      "新增命令动作/意图：command-display.mjs 的 ACTION_RULES / INTENT_ORDER / INTENT_VERB",
      "命令卡表头顺序固定：动作短语 → 用途 → 「已运行 + 剥壳原文」；⛔ 结束态一律 ✓（非零退出多为正常探测）",
      "改折叠文案：turn-fold.ts 的 DEFAULT_GROUP_TEXT（topic/noTopic/verb）",
      "卡片与芯片共用同一函数（不许各写一套）",
    ],
    effect: "构建后生效；历史会话同样按新规则显示（渲染时计算，不落盘）。",
    guards: "【127】意图/技能/插件/目标/摘要逐条钉住；【118】剥壳与命令映射真值表；守卫 07 组",
    pitfalls: [
      "只对工具类 item 判定（正文与思考不算证据）",
      "目标取舍（技能目录内 / 半截路径 / 纯点目录一律丢弃）与卡片芯片共用 skillTargetLabel",
      "⛔ 命令卡不许把非零退出画成失败（git config --get 未配置就是 exit 1）",
    ],
  },
  {
    id: "personalization",
    group: "智能体与能力",
    name: "个性化与指令注入（双轨）",
    purpose: "把用户偏好注入模型上下文：应用侧（个性化 / 项目约定）与助手侧是两套，互不同步。",
    where: [
      "<userData>/personalization.json → <codex-home>/AGENTS.md",
      "~/.workbuddy/app/app-config.json 的 personalization.customPrompt（助手侧）",
    ],
    steps: [
      "应用侧：设置 → 个性化 里改（落 personalization.json → applyPersonalizationToAgentsMd 写 AGENTS.md）",
      "项目约定：写进 <工作区>/AGENTS.md 或 .codex-harness/memory/project/MEMORY.md",
    ],
    effect: "引擎每请求动态读 AGENTS.md ⇒ 下一轮对话即生效。",
    guards: "【104】【106】记忆层与预算、项目记忆注入口径；【172】AGENTS.md 注入上限",
    pitfalls: ["两套个性化互不同步", "AGENTS.md 有注入字节上限，超了被静默截断（关键规则往前放）"],
  },

  /* ── 记忆与质量 ─────────────────────────────────────────────────────── */
  {
    id: "memory",
    group: "记忆与质量",
    name: "记忆层与分类（内置 / MCP / 云端）",
    purpose: "跨会话持久化：分层注入 + 分类 + 预算 + 蒸馏；后端三选一，任一时刻只有一个生效。",
    where: [
      "electron/memory-layers.ts（层表与预算）",
      "electron/memory-lessons.ts（classifyMemory 优先级）",
      "electron/memory-backend.ts（后端判定 effectiveMemoryBackend）",
      "<工作区>/.codex-harness/memory/**（落盘目录）",
    ],
    steps: [
      "加一层：memory-layers.ts 层表（预算 + 注入顺序）",
      "加一类：memory-lessons.ts 分类规则 + lessons/ 文件名映射",
      "换后端：设置 → 记忆 里三选一；判定一律走 effectiveMemoryBackend（mcp 起不来要回退内置）",
      "改完同步守卫与 AGENTS 描述",
    ],
    effect: "下一轮对话注入即生效。",
    guards: "【104】层表预算、【105】分类优先级、【106】预算与截断、【107】蒸馏链、【150】后端互斥与回退、【12q】云账号联动",
    pitfalls: [
      "注入预算超了会静默截断 ⇒ 长条目外置到附录并留指针",
      "⛔ memory-backend.ts 是叶子模块，不许进 runtime-refs（会成环）",
      "云端记忆没有读写接口（走对话上游注入），别指望在工具里 direct 调",
    ],
  },
  {
    id: "knowledge",
    group: "记忆与质量",
    name: "知识库（本地项目库 / 云端 weknora）",
    purpose: "长资料检索：本地按项目分块全文（可加语义档），云端每账号独立库；切换后端会同步连接器，两套库数据独立。",
    where: [
      "electron/features/knowledge-base-ipc.ts（kb:* 通道 + 后端开关）",
      "electron/knowledge-base.ts（分块与检索）",
      "electron/features/cloud-kb-ipc.ts（云端连接器云助手侧实现）",
      "src/features/knowledge-base/KnowledgeBaseSection.tsx（设置页）",
    ],
    steps: [
      "本地库：文档落 <工作区>/.codex-harness/knowledge/，导入后自动分块；语义档在「开发工具」按需装",
      "云端：kb:backend-set 切后端时会启用/停用 cloud-kb 连接器并失效工具缓存（⛔ 只改设置不接连接器 = 模型还在调旧工具）",
      "检索：本地走 kb:search；云端走 MCP 工具 cloud_kb__*（本地导入在云端模式下不生效，数据保留）",
      "界面：来源二选一 + 当前来源一句话说明；云端模式下本地检索/导入按钮显式禁用",
    ],
    effect: "切换即时生效；模型侧工具面变化在下一回合体现。",
    guards: "【kb】判据 8 条（docs/KNOWLEDGE-BASE.md §9）、【12q】云账号、知识库页统一版式【12ad】",
    pitfalls: [
      "⛔ 两套库数据独立，切换不迁移",
      "⛔ 云端未开通权益时连接器会被停用 —— 界面必须如实说「未接通」而不是「已切换」",
      "semantic 档装的是 ONNX 运行时 + 模型（约 110MB），走镜像下载，无 ffmpeg 依赖",
    ],
  },
  {
    id: "favorites",
    group: "记忆与质量",
    name: "收藏夹（用户素材集合）",
    purpose: "新增一类「可以攒起来复用」的素材（现在有片段 / 截图 / 文件 / 链接）：一种数据 + 多个消费面。",
    where: [
      "src/features/app-state/parts/part07/03-seg.tsx（镜像 + 插入/发送/加入记忆）",
      "src/features/settings-favorites/FavoritesSettingsSection.tsx（批量管理页）",
    ],
    steps: [
      "store.ts 的 FavoriteKind 加新类型 + normalizeKind 放行",
      "入口只调 addFavorite（主进程返回全量列表）⇒ 设置页与加号菜单自动同步",
      "「插入」「一键发送」复用同一对动作（insertFavorite/sendFavorite）",
      "要进记忆：走 favorites:to-memory 的 scope，单行限长 300 字",
    ],
    effect: "新增条目立即出现在设置页与加号菜单；发送后 useCount 递增。",
    guards: "【129】删除必须显式 id、记忆写入限长且只追加",
    pitfalls: [
      "渲染层另存一份（localStorage）= 两份真相源 ⇒ 删了又回来",
      "一键发送不能先 setPrompt 再 send（send 读的是上一次渲染的 prompt）",
    ],
  },
  {
    id: "cloud-account",
    group: "记忆与质量",
    name: "云账号与会话同步",
    purpose: "登录后自动配齐模型 / 知识库 / 记忆；会话可按行增量同步到云端并拉回。账号与设备配对是两条独立身份线。",
    where: [
      "electron/cloud-api.ts（账号接口与 safeStorage 令牌）",
      "electron/features/cloud-auth-ipc.ts（登录 / 登出 / 状态）",
      "src/lib/cloud-provision.mjs（登录即用：模型 → 知识库 → 记忆 → 生效位）",
      "src/features/settings-cloud/（云账号页）",
    ],
    steps: [
      "新增云端能力：先确认服务端接口，再在主进程加域（cloud-*），令牌只进 safeStorage",
      "「一键同步」顺序固定：先配模型，再知识库 / 记忆，最后切生效位（onlyIfEmpty 不抢用户已有供应商）",
      "同步类界面只展示服务端真实状态（未开通 / 未接通如实报）",
      "会话同步按行增量，冲突走 conflict/resolve（服务端可关闭该能力）",
    ],
    effect: "登录后即时生效；供应商切换会重启引擎。",
    guards: "【12q】云账号（多租户隔离 / 双证映射）、【12x】云端自愈、验收 `cloud-account` / `cloud-simple`",
    pitfalls: [
      "⛔ 不信任客户端自报身份（双证映射 + 租户隔离）",
      "⛔ 不在渲染层保存令牌明文",
      "限免开关与云供应商争同一席位时要互斥（cloudOwnsSeat）",
    ],
  },
  {
    id: "guard",
    group: "记忆与质量",
    name: "预检守卫与验收项",
    purpose: "把「想让它永远成立」的约束变成会红的断言；把「要真跑才知道」的行为变成验收项。",
    where: [
      "scripts/check-preflight.mjs（聚合入口 + EXPECTED_CHECKS）",
      "scripts/guards/NN-*.mjs（按域分组的断言）",
      "scripts/accept.mjs（CDP 验收项，ROUND_OF 轮次登记）",
    ],
    steps: [
      "加断言：对应域文件 scripts/guards/NN-*.mjs 追加（新编号先查占用）",
      "改完先 node --check <文件>（漏括号会让整份预检只报「断言未跑完」）",
      "断言写代码形态（剥注释后再判）；新断言要做一次变异测试（改坏必须报红）",
      "跑 npm run check 确认它真的出现且为绿；数量变化同步 EXPECTED_CHECKS / 棘轮",
      "需要真跑的行为：accept.mjs 加验收项并登记本轮次（默认只跑最新轮）",
    ],
    effect: "断言随 npm run check 立即生效；验收项按轮次跑。",
    guards: "守卫自检：编号唯一、断言必须打印、EXPECTED_CHECKS 下限、棘轮只缩不长",
    pitfalls: [
      "恒真的断言等于没有断言（写完自问：它能不能被违反）",
      "读文件断言必须递归聚合（漏新目录会假红，只读单文件会静默恒真）",
      "⛔ 大段删 CSS / 文件时按选择器逐条过，别按区间切（会夹带共用规则）",
    ],
  },
  {
    id: "logs-ledger",
    group: "记忆与质量",
    name: "结论档案与功能台账",
    purpose: "把「为什么这么定」与「这版改了什么」留下来：logs/ 记结论（可检索可校验），FEATURE-LEDGER 记功能流水（发布数据源）。",
    where: [
      "logs/README.md（条目规范与索引）",
      "scripts/logs.mjs（new / search / show / dedupe / verify / archive）",
      "docs/FEATURE-LEDGER.md（六列表格，最新在最上）",
    ],
    steps: [
      "定方案 / 修非显性 bug / 发版 / 改用户可感知行为 ⇒ node scripts/logs.mjs new --kind … --title …",
      "每次功能改动同轮在 docs/FEATURE-LEDGER.md 追加一行（日期 / 名称 / 类型 / 范围 / 描述 / 提交）",
      "补录或迁移后跑 node scripts/logs.mjs reindex（sha256 与文件字节绑定，别直接拷索引）",
      "改结论用 supersedes 新开一条，不改旧条目；删除必须写墓碑（delete --confirm --reason）",
    ],
    effect: "文件落盘即生效；索引可随时重建。",
    guards: "【158】日志库（规范 / 索引 / 查重 / 墓碑）；台账规则写进 AGENTS.md",
    pitfalls: [
      "⛔ 同一段正文只许一份（日报留一行指针，logs/ 记结论，不互相抄）",
      "⛔ 补丁式覆盖旧结论 = 断链；用 supersedes",
      "条目必须是 .md（.gitignore 有 *.log）",
    ],
  },
];
