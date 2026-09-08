# AGENTS.md — Codex Harness Desktop 项目环境速览

本文件供 Codex 引擎读取：进到本项目（Codex Harness Desktop 桌面应用的源码 / 或本机运行环境）时，先读这里就知道「环境里有什么、缺什么怎么装、怎么调用」。保持简洁，详细手册见 `docs/TOOLCHAIN.md`（若存在）。

## 这是什么

一个 Electron 桌面应用，把 OpenAI Codex 引擎（`@openai/codex` app-server，stdio JSON-RPC）封装成可用的桌面工作台：多会话、插件/技能、自动化工具、连接器（MCP）、记忆分层。

## 内置能力（引擎可直接用，无需额外安装）

| 能力 | 入口 | 说明 |
|---|---|---|
| 引擎本体 | `app-server --listen stdio://` | 会话、工具、插件、钩子、技能全部走它 |
| 基础运行时 | `resources/tools/{node,python,git,pwsh,vscode-cli,rg,uv,cmake,ninja,sevenzip,jq}` | 已内置随包，**不要**再联网装 |
| 桌面自动化 MCP | `tools/npm-global` 里的 `nuphus`（MCP 服务器名） | 需先装「自动化工具包」，工具前缀 `desktop_*` / `browser_*` |
| 浏览器自动化 CLI | `tools/npm-global/playwright-cli` | 需先装「自动化工具包」，首次 open 会提示装内核 |
| 指纹浏览器 | `require("cloakbrowser")` / `tools/npm-global/cloakbrowser` | 需先装「自动化工具包」+「Cloak 内核」 |
| 内置技能 | `codex-home/skills/` 的 `desktop-automation`、`browser-automation` | 随应用写入，引导引擎调自动化工具 |

## 会话动态工具（thread/start 已注册，可直接调用）

| 工具 | 用途 |
|---|---|
| memory_recall / memory_save | 查询/保存分层记忆（用户偏好/项目背景/工作流/任务经验）；发送前应用会自动注入相关记忆 |
| generate_image / describe_image | 生图与视觉识图（需在 设置→插件→内置插件 配置，未配置时调用会返回指引） |
| rpa_save / rpa_run | 保存自动化流程为 RPA 配方 / 列出并执行已存配方（逐步复现） |
| task_add / task_update | 维护用户任务清单（新增/改状态/列出/删除） |
| agent_ask | 向用户展示选项卡等待选择（第一项为推荐），用于关键决策确认 |

## 工具链清单

**随包内置（离线可用，勿重复下载）**：Node、Python（含 Tkinter/requests/flask/fastapi/playwright）、Git、PowerShell 7、VS Code CLI、ripgrep、uv、CMake、Ninja、7-Zip、jq。

**按需安装（应用内「开发工具」页 或 手动）**：

| 工具 | 大小 | 安装方式 | 装完效果 |
|---|---|---|---|
| 桌面与浏览器自动化（nuphus + playwright-cli + cloakbrowser 包体） | zip 18MB | 开发工具页点「下载」→ 自动解压 zip 到 `tools/npm-global/` → 自动激活桌面/浏览器自动化联动开关 → 引擎重启生效 | nuphus MCP 注册 35+ 工具；playwright-cli / cloakbrowser 可用 |
| Playwright 浏览器内核 | ~170MB | 开发工具页「下载」（需先装自动化包） | playwright-cli 首次 open 不再提示缺内核 |
| Cloak 指纹浏览器内核 | ~200MB | 开发工具页「下载」（需先装自动化包） | cloakbrowser 可开反检测窗口 |
| ponytail 写代码模式插件 | 随包 2MB | 开发工具页「下载」→ 种到引擎插件 cache + 注册段 | 会话钩子 + 6 个 ponytail-* 技能 |
| FFmpeg / yt-dlp / Miniconda / MinGW | 各 20~300MB | 开发工具页「下载」（联网） | 对应命令可用 |
| Docker Desktop / OpenSSL | — | 系统级安装（开发工具页打开官网） | 系统命令 |

## 安装操作（引擎缺工具时怎么自助装）

1. **优先看 `tools/` 目录**：`resources/tools/npm-global` 存在 = 自动化工具已装；`tools/{node,python,git,...}` 存在 = 基础运行时已装。
2. **缺自动化工具包**：调用应用内 `runtime:install`（id=`automation`），或手动：
   - 解压随包 `tools/automation-tools.zip` 到 `tools/`（内置 python：`python -c "import zipfile; zipfile.ZipFile('automation-tools.zip').extractall('tools')"`），结果得到 `tools/npm-global/`。
   - 重启引擎（或重选一次供应商触发 `applyCustomModel`）→ nuphus MCP 段写入 config.toml。
3. **缺 Playwright / Cloak 内核**：`runtime:install`（id=`playwright-browsers` / `cloak-browsers`），会分别调 `playwright install chromium` 与 `cloakbrowser install`。
4. **缺 ponytail 插件**：`runtime:install`（id=`ponytail`），随包安装源 `tools/ponytail-plugin` 种到 `codex-home/plugins/cache` + 写 `[marketplaces.ponytail]` / `[plugins."ponytail@ponytail"]` / 钩子信任。
5. **装完统一**：重启引擎生效；插件/技能/钩子状态从 `plugin/list`、`skills/list`、`hooks/list` 读。

## 引擎初始化原则（2026-09 定）

- **初始化回归原生**：不预写 marketplace 段、不首启自动种插件/技能。
- **一切可下载的拓展都按需安装**（自动化包、浏览器内核、ponytail、ffmpeg 等），`runtime:install` 统一入口。
- 官方精选市场（`openai-api-curated`）需 ChatGPT 账号登录才能装，API Key 方式装不了——插件页已隐藏，不要尝试 `plugin/install` 该市场。

## 应用 UI 速览（引擎了解宿主能力用）

- **内置浏览器在右侧面板**（不在中央主区，聊天不受影响）：右栏「浏览器」标签 = Electron `<webview>`（宿主窗口 `webPreferences.webviewTag: true`），guest 与宿主隔离、无 node API。组件 `src/components/BrowserPane.tsx`（`variant="panel"` 适配右栏宽度）。右栏四个标签（变更/终端/浏览器/项目树）常驻直达，无「打开标签页」选择器。标题栏行高 44px 与 titleBarOverlay 原生窗口钮对齐。
- **指纹内核（cloak-browsers）仅用于自动化场景**（模型经 `cloakbrowser` CLI 调用）；浏览器视图的「隐身浏览」按钮为预留位，尚未接入 CDP 嵌入。

## 近期功能性变更（宿主行为，引擎交互相关）

- **超长上下文 / 重负载优化（重度用户向）**（09-08）：①时间线渲染：每个回合外层 `.turn-group` 加 `content-visibility: auto` + `contain-intrinsic-size: auto 300px`，视口外的回合跳过布局/绘制——这台机器是 `gpu_compositing: disabled_software`（纯 CPU 软件渲染），几个 G 的会话历史（回合全量挂载进 React state + 全量渲染 DOM）原本会直接卡死，此优化让重历史也能流畅滚动。注意：`resumeThreadWithTurns` 仍分页拉齐全部 turns（上限 40 页×200=8000 回合），真正的「按需懒加载旧回合」是下一步可选优化，当前靠 content-visibility 兜底渲染成本。②上下文环预警：`ContextRing` 在占用 ≥80% 加 `.warn`（橙）、≥95% 加 `.danger`（红）；`ContextUsageBadge` 在 ≥70% 时弹出「压缩上下文」按钮（调 `thread/compact/start`）。③新增设置页 **数据管理**（`settingsPage="storage"`，导航在「数据与统计」组）：`StorageSection` 调新增 IPC `app:storage-info`（统计 rollout 原档 / 图片缩略图 / 引擎日志占用）+ `app:storage-clear`（仅安全目标 `engine-log`/`images`，**绝不删会话历史**）；另提供「清理会话恢复缓存」（清空渲染层 `threadCacheRef` 内存 Map + `refreshThreads`，长会话切换后释放内存）与「打开数据目录」。IPC 实现在 electron/main.ts，桥接在 electron/preload.ts（+ vite-env.d.ts 类型）。
- **设置页按需加载 + 骨架先行**（09-08）：用户机器无 GPU 加速（`gpu_compositing: disabled_software`，VM/远程会话典型），设置市场页同步全量挂载 + 引擎 RPC 造成「点击卡顿没反应」。三层修复：①点击设置入口先画弹窗骨架（`settingsContentReady` 双 rAF 后挂载分区内容并拉数据）；②`mcpServerStatus/list {detail:"toolsAndAuthOnly"}` 会拉起全部 MCP 服务枚举工具（CPU 大户），只在进入 settingsPage="mcp" 时请求（`mcpDetailLoadedRef` 会话内沿用）；③SkillHub/插件市场网络请求原是全局 effect 挂载即打（启动全量加载 + 搜索每键一次），改为仅对应市场页可见时请求 + 搜索 350ms 防抖；长页分区 `content-visibility: auto`。注意引擎交互不变，只是宿主侧请求时机变了——依赖 `settingsResources` 的功能（技能子菜单/ponytail 检测等）在设置页打开前拿到的仍是空列表（与旧行为一致，旧行为也是 settingsOpen 才拉）。**用户实测首要根因：开系统代理（Clash 系）时全部网络请求被拖慢/挂起 → 切页卡；关代理秒切。以后排查卡顿先问代理状态。**
- **长会话分页加载**（09-06）：引擎弃用长线程全量水合后，宿主 resume 大线程若返回空 turns 会自动用 `thread/turns/list { threadId, limit, sortDirection:"asc", itemsView:"full", cursor }` 分页拉齐（上限 40 页×200 回合）。引擎侧行为无需配合，但引擎对长线程发出的 `deprecationNotice` 通知宿主已静默处理，不要再向用户转述。
- **插件安装走引擎链路**（09-06）：技能市场之外的插件市场安装 = 下载文件到 `codex-home/plugins/codex-market/<slug>` + 维护 marketplace 根 `.claude-plugin/marketplace.json` 清单 + 调 `plugin/install { pluginName, marketplacePath: <manifest 文件路径> }`。要点：marketplacePath 必须是 manifest **文件**路径（传目录报 os error 5）；本地 marketplace 根缺受支持 manifest（`.claude-plugin/`、`.agents/plugins/`、`.cursor-plugin/` 下的 marketplace.json）时引擎 plugin/list 静默返回空。
- **模型配置约束**（09-06）：模型编辑器对 上下文窗口>256K / 最大输出>128K 显示中文预警——这些值原样传供应商，虚标会被拒或长挂。引擎侧照常使用用户配置的 contextWindow。
- **模型列表保存=全量覆盖**（09-08 修复）：`custom-model:save` 的 models **以前端传入完整列表为权威**，不再与磁盘旧列表合并——前端保存时总是带全量 models（设置页/中转站/官方订阅/登录页一致），列表里没有的模型即视为用户删除，合并回来会让删除「保存后复活」。仅当调用方完全没传 `models` 字段时才回退磁盘旧列表兜底（老调用方兼容）。删除当前生效模型时前端（App.tsx 删除按钮）已同步把 `model` 回落剩余第一个，`withModels`/`normalizeProvider` 不会把它补回。
- **GPU 渲染策略**（09-06 二次调整）：保持 Chromium 默认（健康显卡自动硬件加速）。曾强推 `ignore-gpu-blocklist` 等四开关，用户实测点击延迟明显变高，已全部回退——不要再加。启动日志 `[gpu] feature status` 可诊断 GPU 状态。
- **中转站中心（sub2api 兼容，独立设置页 settingsPage="relay"）**（09-07）：宿主设置 → 账户 → 中转站 + 启动登录界面「中转站账户」tab。协议：POST /api/v1/auth/login、GET /api/v1/user/profile（balance=USD 余额）、GET /api/v1/subscriptions/summary（套餐绑定 group_id）、GET/POST /api/v1/keys（key 明文）。用户选「余额」或「套餐」= 选定 API key（套餐 key 绑对应 group_id，余额 key 无分组）→ 自动生成供应商（{site}/v1，OpenAI 兼容）并选中。**多账号**：userData/relay-store.json {activeId, accounts[]}（id=base|email，老 relay-account.json 首读自动迁移）；IPC relay:accounts/switch-account/remove-account；logout=移除当前账号；登录/切换后宿主自动重配模型（**首套餐优先→无订阅走余额**，无可复用 key 自动新建，逐模型 matchModelSpec 同步规格表）。**注意：部分站点（pptoken）强制 key 必须绑分组，无分组 key 网关 403——宿主自动改绑第一个订阅分组重试。** 侧栏账号区 RelayQuotaChip 与输入框 RelayBalanceBadge 显示当前生效套餐余量/余额（5 分钟轮询）。密码 safeStorage 加密，401 自动重登。公共逻辑在 src/lib/relay.ts。**切换账号强同步（09-08 修复）**：relay-active 增加 `switchedAt` 时间戳 + `email` 字段；RelayBalanceBadge 改为按 `provider|apiKey|mode|groupId|switchedAt` 指纹刷新——同网关不同账号复用同一 provider 字符串时也能立即重拉余额，不再卡在旧账号；displayName 含邮箱便于区分；OpenAI 官方面板切号时通过 `onActiveChange` 把当前账号 email 传给输入框徽标（accountKey），同样立即刷新额度。
- **OpenAI 官方订阅（openai-official 伪供应商）**（09-07）：设置 → 模型 页 OpenaiOfficialCard + 独立页 settingsPage="openai"（OpenaiSubscriptionPage，多账号批量管理）。设备码登录 = 引擎原生 `codex login --device-auth`（spawn 时注入系统代理：HTTPS_PROXY env 优先，否则 session.resolveProxy）。登录成功写 CODEX_HOME/auth.json → **openai:capture-login 收进 vault**（userData/openai-accounts.json，按 email 去重）→ applyCustomModel 对 provider="openai-official" 特判：**不写 model_provider**、写 `preferred_auth_method = "chatgpt"`、不写 model_catalog（引擎内置模型目录）。多账号切换 = openai:account-switch（vault tokens 写回 auth.json + 引擎重启）。额度走 GET chatgpt.com/backend-api/wham/usage（Bearer access_token + chatgpt-account-id，支持按 email 指定 vault 账号）。OpenAI 有区域限制：无代理网络登录会 403（直连 auth.openai.com 403 实证）。登录成功即自动启用（account-switch 写回 auth.json+重启引擎+重配模型，登录完可直接对话）；输入框 OpenaiBalanceBadge 5 分钟轮询 wham/usage 同步官方额度（宽松匹配 percent/ratio 字段）。中转站管理页 = 账号卡片网格 + 二级弹窗（管理面板/登录表单），密钥列表扁平化只显示本账号。

**OpenAI 官方链路铁律（09-07 全链路实证，勿回退）**：
1. **thread/start 绝不传 modelProvider="openai-official"、不内联任何 provider 定义**（渲染层 App.tsx providerConfig 与主进程 newThread 都已特判省略）——引擎按 provider 名校验 env_key，内联即报 Missing CODEX_HARNESS_API_KEY 或 401 api_key_not_supported，流无限重连。
2. **官方供应商存档绝不能有 encryptedKey**：custom-model:save 的「apiKey 留空沿用上一供应商」逻辑会把中转站 sk- key 带进官方条目 → 引擎拿 API Key 调 chatgpt 后端被 401 拒；applyCustomModel/boot 对官方强制 setApiKey("") 并自动清档。
3. **代理必须在引擎 spawn 前注入**（boot 时序：resolveLiveProxy → setExternalEnv → server.start；spawn 后 setExternalEnv 对运行中进程无效）。resolveLiveProxy 会 TCP 探测配置端口，死了自动扫 7897/7890/10808 等常见端口（用户常记错端口，实证 7897 是 Clash Verge 默认）。
4. **官方模型目录接口按 client_version 门控**：GET chatgpt.com/backend-api/codex/models?client_version=1.14.3（陌生版本返回 {"models":[]}）；响应结构 {models:[{slug,visibility:"list",priority,...}]}；请求头要 originator+User-Agent。当前真实模型：gpt-6-astra/gpt-5.6-sol/terra/luna/gpt-5.5/gpt-5.4-mini。
5. **额度接口** GET chatgpt.com/backend-api/wham/usage（Bearer access_token + chatgpt-account-id）：结构 rate_limit.primary_window/secondary_window{used_percent,limit_window_seconds}（18000=5h 窗口、604800=周窗口）。官方请求统一走 openaiFetch（session partition 代理注入 + 剥 ANSI）。
6. **诊断工具**：codex login --device-auth 的控制台输出带 ANSI 转义码（污染 URL/验证码解析，捕获后必须剥掉）；引擎黑匣子日志 userData/engine-debug.log（spawn env 快照/stderr/错误通知，2MB 轮转）；协议复现脚本 .workbuddy/repro-appserver.js（与宿主一致的 initialize/thread/start/turn/start，定位引擎问题的最短路径——注意渲染层 thread/start 有独立内联 providerConfig 隐形链路，别只测主进程）。
- **文件预览 → 内置浏览器**（09-06）：文件预览弹窗对 HTML 文件提供「浏览器打开」按钮，宿主切到右栏浏览器标签并以 `file:///` URL 开新 webview 标签渲染本地页面（BrowserPane `pendingOpen` 请求通道，seq 区分连续打开）。
- **引擎提示中文化**（09-06）：宿主弹卡对引擎英文提示（项目级配置被忽略/限流/断流重连等）做中文翻译后展示；引擎继续发原文即可，宿主负责翻译。
