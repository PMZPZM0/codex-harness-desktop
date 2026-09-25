/**
 * 拓展接口目录 —— 应用内「设置 → 拓展接口」页的数据真相源（09-24）。
 *
 * 为什么单独立一个纯函数库（而不是写在页面组件里）：
 *   ① 页面只负责渲染，数据可被预检守卫**直接断言**（如「列出的通道数必须等于 manifest 实际条数」，
 *      数字写在别处必然过期 —— 本轮刚修过 docs 里「251 个通道」的陈旧数字）；
 *   ② 新同事/AI 接手时，这一份就是"哪些地方可以扩展、怎么扩、扩完怎么生效"的准绳。
 *
 * ⛔ 每条都必须给全五要素：用途 / 扩展位置 / 扩展方式（可照做） / 生效方式 / 配套与坑。
 *    缺任何一项都视为"没写"（守卫会查字段非空）。
 * ⛔ 这里的 paths 必须真实存在（守卫【2】会逐个 existsSync），不要写"计划中"的路径。
 */

/** 分组顺序即页面展示顺序 */
export const EXTENSIBILITY_GROUPS = ["接口与契约", "界面与呈现", "智能体与能力", "记忆与质量"];

/**
 * IPC 通道数（页面统计用）。
 * ⛔ 这个数字**由守卫【2】保证与 manifest 实际条数一致**（写死在别处必然过期 —— docs 里
 *    曾长期写着「251 个通道」，迁移到 315 后没人同步）。改 manifest 后若忘了改这里，预检会红。
 */
export const IPC_CHANNEL_COUNT = 331;

export const EXTENSIBILITY_ENTRIES = [
  {
    id: "ipc-invoke",
    group: "接口与契约",
    name: "IPC 请求接口（渲染层 ↔ 主进程）",
    purpose: "渲染层调用主进程能力的唯一通道。加一个方法 = 三处自动同步，不再手写多处。",
    where: [
      "electron/ipc-channels.manifest.json",
      "electron/ipc-registry.ts",
      "electron/features/<域>.ts",
      "src/lib/ipc-error.mjs",
    ],
    steps: [
      "在 manifest 加一条：name / channel / paramsImpl / paramsDecl / returns / invokeArgs",
      "跑 npm run gen:ipc —— 自动同步 manifest.count、重生成 preload.ts 与 vite-env.d.ts 的 gen 段、并打印未登记的账本条目",
      "按打印出来的片段补 electron/ipc-registry.ts（prefix / count / status / file / channels）",
      "在 main 或 electron/features/<域>.ts 里实现 ipcMain.handle(channel, …) 并返回结果",
    ],
    effect: "生成物即时生效（渲染层下次构建即可用）；主进程新 handler 需重启应用才注册。",
    guards: "【2】22 条：生成段逐字节一致、所有 invoke 走 __ipc、账本全登记、手写面收敛",
    pitfalls: [
      "gen 段禁手改（守卫逐字节比对会红）",
      "沙箱 preload 不许 require 相对模块（生成物必须内联）",
      "渲染层不要读 error.code —— 跨 contextBridge 会丢，用 ipcErrorCodeOf(e) 解析消息前缀",
    ],
  },
  {
    id: "ipc-event",
    group: "接口与契约",
    name: "IPC 事件通道（主进程 → 渲染层推送）",
    purpose: "流式输出、进度、状态变化等单向推送。订阅必须可退订，且不能误伤别人的监听。",
    where: ["electron/preload.ts（手写区）", "src/vite-env.d.ts（手写声明区）"],
    steps: [
      "主进程用 win.webContents.send(\"<域>:<事件>\", payload) 发送",
      "preload 手写区加 onXxx: (listener) => __on(\"<域>:<事件>\", listener, (l) => (_e, payload) => l(payload))",
      "vite-env.d.ts 手写区补 onXxx(listener: (payload: T) => void): () => void",
      "消费侧在 useEffect 里订阅并返回退订函数",
    ],
    effect: "重启应用后生效（preload 改动需重新加载窗口）。",
    guards: "【2】：__on 幂等订阅存在、preload 不许出现 removeAllListeners（会清掉同通道他人订阅）",
    pitfalls: [
      "同一监听函数重复订阅只会生效一次（__on 按引用去重）",
      "退订要精确到本次注册，别用 removeAllListeners",
    ],
  },
  {
    id: "capability",
    group: "接口与契约",
    name: "MCP 服务器 / 连接器 / 插件能力",
    purpose: "外部能力接入：MCP 工具、连接器市场、插件（动态工具）各自有注册与开关表。",
    where: [
      "electron/capability-registry.ts",
      "electron/features/builtin-skills-ipc/03-plugins-market.ts",
      "src/features/settings-mcp/",
    ],
    steps: [
      "内置能力：在 capability-registry.ts 登记（id / label / 说明），渲染层用 capabilityRows 展示",
      "MCP 服务器：走 mcp-servers:* 通道的覆盖表（启用/禁用），权限档位用 mcp-servers:set-tool-permission",
      "市场插件：走 plugins:market-* 通道安装，安装后由引擎作为动态工具暴露",
    ],
    effect: "能力开关改动会重启引擎才生效（界面上有「改动已保存，任务结束后生效」提示）。",
    guards: "【2】账本登记 + 通道三件套一致",
    pitfalls: ["dynamicTools 只在 thread/start 注入 —— 覆盖老会话要走 MCP，不能靠 dynamicTools"],
  },
  {
    id: "settings-page",
    group: "界面与呈现",
    name: "设置页（一行一页）",
    purpose: "设置面板的每个页面：加一页 = 注册表一条 + 导航一项，派发由注册表统一完成。",
    where: [
      "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/00-settings-registry.tsx",
      "src/features/app-view/helpers/catalogs.ts（settingsNav）",
      "src/features/app-view/types.ts（SettingsPage 联合类型）",
      "src/features/settings-<域>/",
    ],
    steps: [
      "types.ts 的 SettingsPage 加 id",
      "新建 src/features/settings-<域>/index.ts + 页面组件（收 props，不用全局单例）",
      "注册表 settingsPagesOf 里加一条（lazy import 页面）",
      "catalogs.ts 的 settingsNav 对应分组加 [\"<id>\", \"名称\", 图标]",
      "若是一级页之外的二级页（从别处进入），补 back 元数据",
    ],
    effect: "构建后即时可见（纯渲染层改动，无需重启主进程）。",
    guards: "【101】：id 无重复、注册表覆盖 settingsNav 全部 id、content 无硬编码分支、二级页有 back",
    pitfalls: ["导航与注册表必须同时改，缺一个就红（【101】）", "页面内不要写 settingsPage 分支逻辑"],
  },
  {
    id: "global-shortcut",
    group: "界面与呈现",
    name: "全局快捷键（系统级）",
    purpose: "加一条不受焦点限制的系统快捷键（截图 / 语音已各有一组）：纯函数净化 + 注册表 + 设置页录入。",
    where: [
      "electron/accelerator.ts（sanitizeAccelerator / acceleratorLabel，主进程唯净化入口）",
      "electron/screenshot.ts（createHotkeyRegistry：先注册成功才注销旧键）",
      "electron/features/screenshot-favorites-ipc.ts（启动时按设置注册一次 + 设置变更即时重挂）",
      "src/features/settings-screenshot/ScreenshotSettingsSection.tsx（录入控件）",
    ],
    steps: [
      "新键位先进 sanitizeAccelerator（≥1 个修饰键，主键只收 字母/数字/F1-12/Space）",
      "注册走 createHotkeyRegistry.apply：**新键注册成功后才注销旧键**；失败保留原设置并回传 error",
      "设置变更后立刻重挂（不然「改完要重启」）",
      "设置页用 keydown 捕获录入，主键优先取 e.code（e.key 会把 Ctrl+Shift+1 的 ! 丢掉）",
      "mac 与 Windows 的差异交给 acceleratorLabel / hk() 做展示，存储一律 Electron accelerator 原文",
    ],
    effect: "保存后立即生效（无需重启）；被别的程序占用时设置页会显示冲突原因。",
    guards: "【129】：注册失败必须记录并可读回、先注册成功才落盘、覆盖层 preload 不许有相对 import",
    pitfalls: [
      "先注销再注册 = 新键被占用时两头空（快捷键直接失联）",
      "设了未注册的 AUMID 会顶掉窗口图标（壳层经验，见 AGENTS.md 图标一条）",
      "两条快捷键不许同键：后者注册必然失败且原因不直观",
    ],
  },
  {
    id: "theme",
    group: "界面与呈现",
    name: "主题与配色",
    purpose: "界面主题：新增一套配色 = 注册表加一行 + 一段 CSS 变量块。",
    where: ["src/lib/themes.ts", "src/styles/01-base-and-chrome.css"],
    steps: [
      "src/lib/themes.ts 的 THEMES 加一行 { id, label, preview }（preview 用现有 tpw-light/tpw-dark 预览皮肤）",
      "在 styles/01-base-and-chrome.css 里加 :root[data-theme=\"<id>\"] { …变量块… }（照抄 dark 块改色值）",
      "若是暗色系新主题，同步 electron/main.ts 的 theme:apply（标题栏与滚动条判定）",
    ],
    effect: "切换即时生效（data-theme 属性 + localStorage 持久化），无需重启。",
    guards: "【2】：主题注册表存在、外观页按钮由注册表渲染（不许再手写 light/dark 两份）、初始化过 normalizeThemeId",
    pitfalls: ["localStorage 脏值会回落 light（normalizeThemeId），别绕过它读 localStorage"],
  },
  {
    id: "style-section",
    group: "界面与呈现",
    name: "样式分节（CSS）",
    purpose: "样式按域分节管理：新域加一个分节文件，顺序即级联优先级。",
    where: ["src/styles/<NN>-<域>.css", "src/styles.css（入口 @import，顺序=级联优先级）"],
    steps: [
      "在 src/styles/ 新增 NN-<域>.css（编号接在末尾，别插队）",
      "在 src/styles.css 末尾追加 @import（顺序必须与文件名升序一致）",
      "选择器前缀用域 id，避免与既有分节抢同名类",
    ],
    effect: "构建后生效。",
    guards: "【2】CSS 覆盖告警（有类无样式 / 有样式无类）",
    pitfalls: ["别在 styles.css 里直接写选择器（@import 必须在最前）", "改顺序会改变级联优先级（构建产物会变）"],
  },
  {
    id: "commands",
    group: "界面与呈现",
    name: "斜杠命令与命令面板",
    purpose: "输入框的 /命令 与命令面板条目。",
    where: ["src/features/app-view/helpers/catalogs.ts（builtinCommandCatalog / slashCommands）"],
    steps: [
      "在 builtinCommandCatalog 里加条目（id / 展示名 / 说明 / 需要的处理）",
      "若需执行逻辑，在发送路径里分支处理（保持纯前端可判定，不要新增隐藏通道）",
    ],
    effect: "构建后生效。",
    guards: "【101】相关（catalogs 导出面）",
    pitfalls: ["命令面板与斜杠命令是两份表，注意别只改一处"],
  },
  {
    id: "skills",
    group: "智能体与能力",
    name: "技能（方法论 / 脚本包）",
    purpose: "把可复用流程沉淀成技能，引擎原生发现并在需要时读取。",
    where: [
      "$CODEX_HOME/skills/<名>/SKILL.md（跨项目）",
      "<工作区>/.codex/skills/<名>/SKILL.md（项目级，默认）",
      "electron/builtin-skills/*.ts（应用内置技能）",
    ],
    steps: [
      "建目录并写 SKILL.md（frontmatter 必须有 name + description，否则不进技能列表）",
      "项目级优先（随项目走）；跨项目才放 $CODEX_HOME/skills",
      "内置技能改 electron/builtin-skills/<NN>-skill-<名>.ts（应用启动时 ensureBuiltinSkills 落盘）",
    ],
    effect: "引擎下一次读取技能清单时生效（新会话即可）；内置技能改动需要重启应用。",
    guards: "【103】技能包装配、【113】【114】元技能与安装前审计",
    pitfalls: [
      "⛔ 不要放 <工作区>/.codex-harness/skills —— 引擎不认那个目录",
      "技能被「使用」的常见形态是模型读 SKILL.md（一条命令），界面据此显示「使用技能 …」",
    ],
  },
  {
    id: "tool-display",
    group: "智能体与能力",
    name: "工具与命令的展示映射（真实状态映射）",
    purpose: "把引擎的原始事件翻译成人看得懂的一句话：技能归属、命令意图、用途、行数。",
    where: [
      "src/lib/tool-display.mjs（技能/插件识别、入参摘要、目标取舍）",
      "src/lib/command-display.mjs（命令意图词表、用途提炼、剥壳与路径归一）",
      "src/lib/turn-fold.ts（折叠芯片词表与原子归类）",
    ],
    steps: [
      "新增技能特征：在 tool-display.mjs 的 SKILL_MATCHERS 加一行 { skill, label, re }（认不出必须返回 null，不许硬贴标签）",
      "新增命令意图：在 command-display.mjs 的 INTENT_ORDER 词表加档位，并在 INTENT_VERB 补中文动词",
      "改折叠芯片文案：turn-fold.ts 的 DEFAULT_GROUP_TEXT（topic/noTopic/verb 三件）",
      "两侧共用同一函数（卡片与芯片不许各写一套）",
    ],
    effect: "构建后生效，历史会话同样按新规则显示（映射是渲染时算的，不落盘）。",
    guards: "【127】：意图/技能/插件/目标取舍/摘要文案逐条钉住",
    pitfalls: [
      "只对工具类 item 判定（正文与思考不算证据 —— 模型自己说「用了 X」不能当已使用）",
      "目标取舍规则（技能目录内/半截路径/纯点目录一律丢弃）与卡片芯片共用 skillTargetLabel",
    ],
  },
  {
    id: "personalization",
    group: "智能体与能力",
    name: "个性化与指令注入（双轨）",
    purpose: "把用户偏好注入到模型上下文：应用侧与助手侧是两套，互不同步。",
    where: [
      "%APPDATA%/Codex Harness Desktop/personalization.json → codex-home/AGENTS.md",
      "~/.workbuddy/app/app-config.json 的 personalization.customPrompt（助手侧）",
    ],
    steps: [
      "应用侧：设置 → 个性化 里改（落盘 personalization.json，再经 applyPersonalizationToAgentsMd 写进 AGENTS.md）",
      "项目约定：写进 <工作区>/AGENTS.md 或 .codex-harness/memory/project/MEMORY.md",
    ],
    effect: "引擎每个请求动态读取 AGENTS.md ⇒ 下一轮对话即生效。",
    guards: "【104】【106】记忆层与预算、项目记忆注入口径",
    pitfalls: ["两套个性化互不同步；改一边不会同步另一边"],
  },
  {
    id: "memory",
    group: "记忆与质量",
    name: "记忆层与分类",
    purpose: "跨会话持久化：分层注入 + 分类（纠错/坑/偏好/约定）+ 预算控制 + 自动蒸馏。",
    where: [
      "electron/memory-layers.ts（层表与预算）",
      "electron/memory-lessons.ts（classifyMemory 分类优先级）",
      "<工作区>/.codex-harness/memory/**（实际落盘目录）",
    ],
    steps: [
      "加一层：改 memory-layers.ts 的层表（含预算与注入顺序）",
      "加一类：改 memory-lessons.ts 的分类规则 + lessons/ 下的文件名映射",
      "改完同步守卫断言与 AGENTS 描述",
    ],
    effect: "下一轮对话注入即生效（注入在每次请求前组装）。",
    guards: "【104】层表预算、【105】分类优先级、【106】预算与截断标记、【107】蒸馏链",
    pitfalls: ["注入预算超了会被静默截断 ⇒ 长条目要外置到附录并留指针"],
  },
  {
    id: "favorites",
    group: "记忆与质量",
    name: "收藏夹（用户素材集合）",
    purpose: "新增一类「用户可以攒起来复用」的素材（现在是 片段/截图/文件/链接）：一种数据 + 三个消费面。",
    where: [
      "electron/favorites.ts（读盘归一化 / 原子写 / 批量删除只认显式 id）",
      "electron/features/screenshot-favorites-ipc.ts（favorites:* 通道）",
      "src/features/app-state/parts/part07/03-seg.tsx（镜像 + 插入/发送/加入记忆）",
      "src/features/settings-favorites/FavoritesSettingsSection.tsx（批量管理页）",
      "src/features/app-view/AppView/02-main-stage/03-composer/02-composer-form.tsx（加号菜单子面板）",
    ],
    steps: [
      "electron/favorites.ts 的 FavoriteKind 加新类型 + normalizeKind 放行",
      "新增入口时只调 addFavorite（主进程返回全量列表）⇒ 设置页/加号菜单自动同步",
      "渲染层「插入」「一键发送」复用 app 层同一对动作（insertFavorite/sendFavorite），不要各写一份",
      "要在会话里能发出去：把内容编码成输入框 token（文本直发 / 图片 imageToken / 文件 fileToken）",
      "要进记忆：走 favorites:to-memory 的 scope（user/project/background/lessons），单行限长 300 字",
    ],
    effect: "新增条目立即出现在设置页与加号菜单（同一份镜像）；发送后 useCount 递增，列表可据此排常用。",
    guards: "【129】：删除必须是显式 id 列表、记忆写入必须限长且先读后写（只追加不覆盖）",
    pitfalls: [
      "渲染层另存一份（localStorage）= 两份真相源 ⇒ 删了又回来",
      "一键发送不能先 setPrompt 再 send：send() 读的是上一次渲染的 bag.prompt，会发错内容",
      "把整条长文塞进记忆层会挤占注入预算（收藏可无限追加，所以必须限长）",
    ],
  },
  {
    id: "guard",
    group: "记忆与质量",
    name: "预检守卫与验收项",
    purpose: "把「想让它永远成立」的约束变成会红的断言；把「要真跑才知道」的行为变成验收项。",
    where: [
      "scripts/check-preflight.mjs（聚合入口）",
      "scripts/guards/NN-*.mjs（按域分组的断言）",
      "scripts/accept.mjs（CDP 验收项，含 ROUND_OF 轮次登记）",
    ],
    steps: [
      "加断言：找到对应域文件 scripts/guards/NN-*.mjs 追加（⛔ 新编号先查占用，号跨文件复用）",
      "改完先 node --check <文件>（漏括号会让整份预检只报「断言未跑完」）",
      "断言要写在代码上而不是注释上（剥离注释后再判定）",
      "跑 npm run check 确认它真的出现且为绿（避免 cond ? ok : fail(\"…\") 这种静默漏检写法）",
      "需要真跑的行为：在 accept.mjs 加验收项并登记本轮次",
    ],
    effect: "断言随 npm run check 立即生效；验收项按轮次跑（默认只跑最新轮）。",
    guards: "守卫自身：编号唯一性、断言必须打印",
    pitfalls: [
      "恒真的断言等于没有断言（写完自问：它能不能被违反）",
      "读文件断言要递归（漏新目录会假红）",
    ],
  },
];
