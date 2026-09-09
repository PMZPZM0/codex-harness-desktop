# Codex Harness Desktop — 工具链手册（TOOLCHAIN）

应用把 Codex 引擎需要的工具链分成两层：**随包内置的基础运行时** 与 **按需下载的拓展工具**。
引擎/用户在本机跑 Codex 时，按本手册确认「有什么、缺什么、怎么装、怎么调」。

所有工具装在应用 `resources/tools/` 下（安装版 = `<安装目录>/resources/tools/`），
**不修改系统 PATH / 注册表**；应用启动时把该目录注入引擎子进程的 PATH 与 NODE_PATH。

---

## 一、随包内置（离线可用）

| 工具 | 路径（tools/ 下） | 典型用途 |
|---|---|---|
| Node.js + npm | `node/` | JS/TS 项目、npm 工具、引擎脚本 |
| Python 3（含 Tkinter、requests/httpx/flask/fastapi/playwright） | `python/` | 数据处理、GUI、Python MCP |
| Git | `git/` | diff/分支/提交/克隆 |
| PowerShell 7 | `pwsh/`（`pwsh-headless/` 为无窗口桥） | 现代 shell 脚本 |
| VS Code CLI | `vscode-cli/` | `code` 命令打开文件/工作区 |
| ripgrep | `rg/` | 极速代码搜索（Codex 主力） |
| uv | `uv/` | Python 包/venv 管理 |
| CMake | `cmake/` | C/C++ 构建生成器 |
| Ninja | `ninja/` | 高速构建 |
| 7-Zip | `sevenzip/` | 归档（注意：`7z.exe` 无 `7z.dll` 不能独立解压，解压请用内置 python） |
| jq | `jq/` | JSON 查询 |
| cloudflared | `cloudflared.exe` | Cloudflare Tunnel（远程接入） |

## 二、按需安装的拓展工具

统一入口：应用「设置 → 开发工具」页，或 IPC `runtime:install`。

### 1. 桌面与浏览器自动化（zip 解压即用）

- 内容：`nuphus-mcp`（桌面自动化 MCP）+ `@playwright/cli` + `cloakbrowser` + `playwright-core`
- 安装：开发工具页「下载」→ 应用解压随包 `tools/automation-tools.zip` 到 `tools/` →
  得到 `tools/npm-global/` → 自动激活「桌面自动化」「浏览器自动化」联动开关 → 引擎重启生效。
- 手动解压（引擎自装时）：
  ```bash
  python -c "import zipfile; zipfile.ZipFile('<tools>/automation-tools.zip').extractall('<tools>')"
  ```
- 校验：`tools/npm-global/node_modules/@nuphus/nuphus-mcp/package.json` 存在即成功。

调用方式：
- **桌面自动化**：引擎 config.toml 注册 `[mcp_servers.nuphus]`，工具前缀 `desktop_*`（截图/窗口/键鼠/剪贴板/OCR）+ `browser_*`（Chrome CDP）。操作前先 `desktop_window_activate`。
- **浏览器自动化**：命令行 `playwright-cli open|snapshot|click|type|screenshot`。
- **指纹浏览器**：`node -e "import('cloakbrowser').then(m=>...)"`（Playwright API 兼容，反检测 + humanize）。

### 2. Playwright 浏览器内核（~170MB，联网下载）

- 安装：开发工具页「下载」（**先装自动化包**，它提供 playwright CLI）。
- 底层命令：`node <tools>/npm-global/node_modules/@playwright/cli/node_modules/playwright/cli.js install chromium`
- 落地：`tools/pw-browsers/`。未装时 `playwright-cli open` 会提示缺内核。

### 3. Cloak 指纹浏览器内核（~200MB，联网下载）

- 安装：开发工具页「下载」（**先装自动化包**）。
- 底层命令：`node <tools>/npm-global/node_modules/cloakbrowser/dist/cli.js install`（CLOAKBROWSER_CACHE_DIR=tools/cloak-cache）。
- 落地：`tools/cloak-cache/`。用于 Cloudflare/reCAPTCHA/风控站。

### 4. ponytail 写代码模式插件（随包安装源）

- 安装：开发工具页「下载」→ 从 `tools/ponytail-plugin/` 种到引擎：
  - `codex-home/plugins/cache/ponytail/ponytail/4.9.0/`（插件落点，hooks/技能都从这出）
  - config.toml 追加 `[marketplaces.ponytail]`(local) + `[plugins."ponytail@ponytail"]`(enabled) + 钩子 trusted_hash
- 生效：会话启动钩子注入精简工程规则；6 个技能 `ponytail-*` 出现在 `skills/list`。
- 注：**不要**把插件 skills/ 拷到全局 skills/（会导致技能列表重复）。

### 5. 其他按需下载（开发工具页）

FFmpeg（音视频）、yt-dlp（下载）、Miniconda（conda 环境）、MinGW-w64（gcc/g++/make）。
系统级安装：Docker Desktop、OpenSSL（开发工具页打开官网）。

## 三、引擎自助安装（runtime:install）

应用内 IPC：`runtime:install { id }`，合法 id 与效果：

| id | 效果 |
|---|---|
| `automation` | 解压 automation-tools.zip → npm-global，激活联动开关 |
| `playwright-browsers` | playwright install chromium → pw-browsers |
| `cloak-browsers` | cloakbrowser install → cloak-cache |
| `ponytail` | 种 ponytail 插件到引擎 |
| `ffmpeg` / `yt-dlp` / `conda` / `mingw` | 联网下载对应运行时 |
| `docker` / `openssl` | 打开官网（系统级） |

装完引擎自动重启（等待活动任务结束后），从 `plugin/list` / `skills/list` / `hooks/list` 回读状态确认。

## 四、故障排查

- **nuphus MCP 显示 0 工具**：未装自动化包或刚装完没重启。装包 → 重选一次供应商（触发 config 重写）→ 等回填。
- **playwright-cli 提示缺内核**：装「Playwright 浏览器内核」。
- **cloakbrowser 打不开**：装「Cloak 指纹浏览器内核」。
- **7z 解压失败 "Cannot open the file as archive"**：`7z.exe` 缺 `7z.dll`，用内置 python zipfile 解压。
- **官方插件装不了**（`openai-api-curated` 市场）：需 ChatGPT 账号登录，API Key 方式不可用——该市场已在插件页隐藏，不要尝试安装。
- **技能列表重复（ponytail-* 两遍）**：全局 skills/ 里残留了插件技能副本，删掉全局那份即可（引擎会从插件 cache 列）。
