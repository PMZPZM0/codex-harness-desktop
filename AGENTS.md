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

- **长会话分页加载**（09-06）：引擎弃用长线程全量水合后，宿主 resume 大线程若返回空 turns 会自动用 `thread/turns/list { threadId, limit, sortDirection:"asc", itemsView:"full", cursor }` 分页拉齐（上限 40 页×200 回合）。引擎侧行为无需配合，但引擎对长线程发出的 `deprecationNotice` 通知宿主已静默处理，不要再向用户转述。
- **插件安装走引擎链路**（09-06）：技能市场之外的插件市场安装 = 下载文件到 `codex-home/plugins/codex-market/<slug>` + 维护 marketplace 根 `.claude-plugin/marketplace.json` 清单 + 调 `plugin/install { pluginName, marketplacePath: <manifest 文件路径> }`。要点：marketplacePath 必须是 manifest **文件**路径（传目录报 os error 5）；本地 marketplace 根缺受支持 manifest（`.claude-plugin/`、`.agents/plugins/`、`.cursor-plugin/` 下的 marketplace.json）时引擎 plugin/list 静默返回空。
- **模型配置约束**（09-06）：模型编辑器对 上下文窗口>256K / 最大输出>128K 显示中文预警——这些值原样传供应商，虚标会被拒或长挂。引擎侧照常使用用户配置的 contextWindow。
- **GPU 渲染策略**（09-06 二次调整）：保持 Chromium 默认（健康显卡自动硬件加速）。曾强推 `ignore-gpu-blocklist` 等四开关，用户实测点击延迟明显变高，已全部回退——不要再加。启动日志 `[gpu] feature status` 可诊断 GPU 状态。
- **文件预览 → 内置浏览器**（09-06）：文件预览弹窗对 HTML 文件提供「浏览器打开」按钮，宿主切到右栏浏览器标签并以 `file:///` URL 开新 webview 标签渲染本地页面（BrowserPane `pendingOpen` 请求通道，seq 区分连续打开）。
- **引擎提示中文化**（09-06）：宿主弹卡对引擎英文提示（项目级配置被忽略/限流/断流重连等）做中文翻译后展示；引擎继续发原文即可，宿主负责翻译。
