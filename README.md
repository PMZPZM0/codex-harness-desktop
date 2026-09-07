# Codex Harness Desktop

独立桌面工作台，把 OpenAI Codex 引擎装进一个真正的桌面应用：多会话任务管理、可视化 diff 审阅、内置自动化工具、插件/技能/连接器生态、专家团队协作，开箱即用，无需命令行。

<p align="center">
  <img src="docs/screenshots/main-light.png" width="820" alt="Codex Harness Desktop 主界面" />
</p>

## ✨ 功能特性

### 🚀 任务与会话管理
- **多任务并行**：侧栏按分组/项目管理会话，支持置顶、归档、重命名、分支、批量操作
- **消息排队**：任务运行中继续输入，消息自动排队依次发送
- **会话备份与导出**：本地 Markdown 导出、跨设备恢复
- **移动远程接入**：手机扫码远程连接工作台，微信/飞书/Telegram/Lark/钉钉等 Bot 通道消息驱动任务

### 🎨 沉浸式对话体验
- **全宽顶行 + 独立面板（两段式布局）**：窗口第一行是横跨全宽的独立顶行——左侧任务名，右侧工作区选择/任务操作（⋯：压缩上下文/审查/撤销/消息队列等）/新建终端/右栏开关四钮紧贴系统原生窗口钮（titleBarOverlay），位置恒定；顶行以下才是侧栏/聊天/右栏三列，**拖面板分隔条只影响面板，顶行不动**；面板与顶行完全拆开（板块独立），聊天区随面板开合自适应；分隔条为 1px 细线（前后 3px 加宽热区），拖拽直写 DOM 样式流畅无卡顿；底部分隔线止于窗口钮左侧（原生 overlay 区域无法绘制）
- **内置浏览器（右侧面板）**：右侧面板「浏览器」标签即极简浏览器（多标签页 + 地址栏 + 收藏 + 空状态引导页），**聊天主区不受影响**，可边对话边浏览；渲染走 Electron 独立 webContents（与宿主隔离）；盾牌按钮「隐身浏览」调 cloak-browsers 指纹内核以独立窗口打开当前页（需在开发工具安装自动化包并下载内核），失败时提示原因；右侧面板四个标签（变更/终端/浏览器/项目树）常驻直达，右栏开关独立于标签（任意标签下均可一键收起/展开，Ctrl+B 同效）
- **流式平滑渲染**：正文/深度思考逐字平滑揭示，无跳字闪烁
- **长会话分页兜底**：引擎弃用长线程全量加载后，切会话 resume 拿不到回合时自动用 `thread/turns/list` 分页拉齐全部历史（修复「切会话回答消失」）；引擎协议迁移类提示（deprecationNotice）不再弹卡打扰
- **引擎提示中文化**：弹卡里的引擎英文提示（项目级配置被忽略/限流/断流重连等）按已知模式翻译成中文，未收录文案原样展示
- **GPU 渲染保持默认**：硬件加速交给 Chromium 自动管理（健康显卡默认启用）；启动时输出 GPU 功能状态日志，卡顿/掉帧时可诊断。曾试过强制 GPU 通道的四开关，实测点击延迟变高已回退
- **自动跟随与发送定位**：发送后新消息**平滑滚动到视口顶部对齐**（WorkBuddy 同款观感，smooth 滚动 + 上浮光斑入场动画）；Agent 流式回复期间自动滚动跟随，正在吐的字实时可见；用户向上滚动（滚轮/拖滚动条/翻页键）立即停止跟随，滚回底部后自动恢复
- **会话折叠**：工具调用、计划步骤自动折叠成卡片；深度思考块**输出完即自动折叠**，正文衔接不悬挂，长任务一眼看清结构
- **提示词增强**：输入框一键 AI 润色提示词（悬停预览、一键还原）
- **引用体系**：`@` 引用上下文、引用会话/文件、图片内联粘贴
- **项目树与文件预览**：右侧「项目树」标签浏览工程文件，点开即预览——**顶部多文件标签切换**（内容缓存秒切）、**行号常开**、语法高亮/主题/字号跟随代码显示设置，图片棋盘格底预览，支持直接编辑保存；**HTML 文件一键「浏览器打开」**——右侧内置浏览器新开标签渲染该页面（file:// 直载，改完可反复打开看效果）

### 🔌 能力生态
- **OpenAI 官方订阅（ChatGPT 登录）**：设置 → 模型 页「OpenAI 官方订阅」卡 + **独立管理页（设置 → 账户 → OpenAI 订阅）**——**设备码登录**（引擎原生 `codex login --device-auth`，自动打开浏览器并显示验证码，无需 API Key、无需本地回调端口），**多账号批量管理**：每账号独立保存在本机 vault，列表一键切换（写回 auth.json + 引擎重启生效）/删除/重新启用，每账号独立额度监控；启用后引擎走内置 openai 通道 + ChatGPT 订阅额度（配置写入 `preferred_auth_method = "chatgpt"`）；代理端口自动探测（配置端口连不通自动扫 7897/7890/10808 等常见端口）并透传引擎与官方接口（OpenAI 有区域限制，无代理网络不可用）；模型列表/订阅额度实时同步官方（额度面板：PLUS 档位、订阅有效期、5 小时/本周窗口用量进度条）；管理界面为账号卡片 + 二级弹窗。对话链路走引擎内置 openai 通道 + ChatGPT 登录凭据（不使用任何 API Key）。
- **中转站中心（sub2api 兼容，独立设置页）**：设置 → 账户 → 中转站：登录中转站站点（默认 PPtoken，任何 sub2api 网关均可）后展示**余额总览**与**套餐卡片**（用量进度条/上限/到期），点「使用此套餐 / 使用余额」一键生成命名好的供应商并切换生效；**多账号管理**：可添加多个中转站账号，列表一键**切换**（自动重配该账号的套餐/密钥并同步规格表）或删除；**API 密钥管理区**自选用哪把 key；**启动登录界面也有「中转站账户」tab**（登录即自动配好供应商直接进主界面）；模型设置页保留精简入口横幅；**输入框旁与侧栏账号区实时透出**当前套餐余量或余额（5 分钟自动刷新）；密钥 safeStorage 加密，401 自动重登
- **技能中心**：技能清单直连**腾讯 SkillHub** 市场 API（总排行=四榜单并集 280+ / 近期最热 / 最新上传 / 官方精选 + 10 大分类筛选 + 搜索），卡片显示真实图标（iconUrl，缺失走 emoji/图标映射），**点卡片弹出详情预览**（简介/分类/一键安装/来源直达），一键安装（zip 下载 → 安全审计 → 写入技能目录 → 重启引擎确认），来源清单按市场写 .skillhub.json
- **插件市场**：页内直连 **Codex Plugin Marketplace**（codex-marketplace.com，419+ 插件，含 OpenAI 官方 openai/plugins 仓库），卡片展示 + 中文简介，**点卡片弹出详情预览**；图标原地址优先、失败切 jsDelivr 镜像再回退首字母；**一键安装完整接通引擎**（GitHub 拉取文件（带重试）→ 本地 marketplace + `.claude-plugin/marketplace.json` 清单 → 引擎 `plugin/install` RPC 拷入 plugins/cache 置 installed → plugin/list 回读验证），无需 ChatGPT 登录；下方保留已安装插件启停管理（含随包 ponytail）
- **写代码模式插件**：ponytail（会话钩子 + 6 个技能）随包安装源，「开发工具」页一键安装，引擎初始化保持原生
- **连接器（MCP）**：飞书/钉钉/腾讯文档等 MCP 服务器可视化配置；新增 **MCP 市场**（SkillHub MCP 工具广场 27 个服务，分类/搜索/已接入标记，点卡片弹出详情预览，带接入模板的服务**一键写入连接器**——落盘→重启引擎→自动验证 MCP 状态，密钥可事后补充，其余直达官网详情页）；页头另有 AIbase 广场入口
- **专家团队**：可组建多角色专家团，成员一键直达会话协作

### 🛠 自动化工具箱（开发工具页按需下载）
- **桌面自动化**：截屏/键鼠/窗口控制/OCR 感知（Nuphus，压缩包解压即用）
- **浏览器自动化**：Playwright CLI + 反检测指纹浏览器（过 Cloudflare/reCAPTCHA），包体与浏览器内核分别下载
- **RPA 流程自动化**：跑通的自动化流程一键存为配方，随时复现；agent 自动询问沉淀配方；任务清单 agent 可自主维护
- **基础运行时**：Node/Python/Git/PowerShell/rg/uv/CMake/7-Zip/jq/Ninja 随应用内置，离线可用
- **终端**：xterm 内置终端，会话级持久化

### ⚙️ 工程化细节
- **权限分级**：只读/自动编辑/完全访问三档审批，敏感操作确认执行；**会话中途切换即时生效**（经引擎 thread/resume 通道下发 sandbox + 审批档位），切换后工作区外读写按所选档位放行
- **模型配置防误填**：模型编辑器对超常见的上下文窗口（>256K）/最大输出（>128K）值显示中文预警——虚标会导致长任务请求被供应商拒绝或无限等待
- **沙箱隔离**：Windows 沙箱执行，命令越界走审批流
- **多模型接入**：任意 OpenAI 兼容端点，多供应商多模型自由切换；内置 GPT 系/主流国模规格表（上下文/最大输出/思考档位/视觉模态按型号自动识别），填模型 ID 即自动填好全部参数；支持外部规格文件更新模型数据无需改代码；API 协议自动跟随上游（探测时 Responses/Chat 自动判定并落定）；Coding Plan 套餐网关（火山方舟/智谱/Kimi/MiniMax）不提供模型列表接口时自动加载内置推荐清单
- **记忆分层**：用户档案/项目记忆/会话日志三层记忆体系，自动沉淀
- **归档管理**：会话归档集中管理，恢复/永久删除，恢复后内容完整可直接续聊
- **账户中心**：头像昵称、使用统计一站式菜单；界面主题为一级菜单项，内置浅色/深色两个并排按钮一键切换，语言/缩放菜单项直达
- **应用内自更新**：内置版本发布中心对接，检查/下载/安装一体化

<p align="center">
  <img src="docs/screenshots/main-dark.png" width="410" alt="深色主题" />
  <img src="docs/screenshots/add-menu.png" width="410" alt="附件菜单" />
</p>

## 📦 下载安装

前往 [Releases](../../releases) 页面下载：

| 平台 | 文件 | 说明 |
|---|---|---|
| Windows 10/11 x64 | `Codex-Harness-Setup-<版本>.exe` | NSIS 安装向导，可选安装目录 |
| macOS Intel | `Codex Harness Desktop-<版本>-x64-mac.zip` | 解压后拖入「应用程序」 |
| macOS Apple Silicon (M1/M2/M3/M4) | `Codex Harness Desktop-<版本>-arm64-mac.zip` | 解压后拖入「应用程序」 |

> 基础运行时（Node/Python/Git/PowerShell/rg/uv 等）完整内置，安装即可离线使用；桌面/浏览器自动化工具与浏览器内核在「开发工具」页按需下载（压缩包解压即用），不再随包塞 1.2GB 内核。

**macOS 首次打开**（安装包未做开发者签名，Gatekeeper 会拦截）：

1. 解压后把 App 拖进「应用程序」
2. **右键 → 打开**（不要直接双击），弹窗中点「打开」
3. 若仍提示已损坏，终端执行：

```bash
xattr -cr "/Applications/Codex Harness Desktop.app"
```

## 🛠 从源码构建

```bash
git clone https://github.com/<YOUR_ACCOUNT>/codex-harness-desktop.git
cd codex-harness-desktop
npm install

# 开发模式
npm run dev

# 构建 Windows 安装包（NSIS）
npm run dist

# macOS 包：在 macOS 机器上执行，或用仓库内 GitHub Actions 云端构建
# （Actions → Build macOS → Run workflow，同时产出 arm64 与 x64 两个 zip）
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac zip --arm64   # 或 --x64
```

内置工具链随 extraResources 整目录打包。打包发布前先跑发布门槛验收（工具清单 / nuphus MCP 握手 / Playwright 浏览器启动，25 项全绿才可发布）：

```bash
node scripts/verify-package.mjs <win-unpacked 目录>
```

## 🏗 技术栈

- **Electron 43** + **React 19** + **Vite 8** + **TypeScript 5.9**
- 引擎通信：stdio JSON-RPC 对接 `@openai/codex` app-server
- 终端：`@lydell/node-pty` + `@xterm/xterm`
- 远程通道：SSH2 / Telegram / 微信 / 飞书 / 钉钉网关

## 📁 目录结构

```
├── AGENTS.md           # 项目环境速览（Codex 引擎自动读取：能力/工具清单/安装操作）
├── electron/          # 主进程（引擎 RPC、窗口、网关、更新）
├── src/               # 渲染层（React 界面、hooks、纯函数库）
├── scripts/           # 构建/运行时安装/打包脚本
├── docs/              # 文档（TOOLCHAIN.md：工具链清单与安装手册）
├── release-site/      # 配套版本发布中心（Node 服务端，可选部署）
├── build/             # 应用图标源文件
└── docs/screenshots/  # 界面截图
```

## 📚 项目文档体系与更新规则

| 文件 | 定位 | 谁读 / 何时读 | 更新时机 |
|---|---|---|---|
| `README.md` | 全量项目说明（功能/安装/构建/文档体系） | 人 + 引擎查阅 | **每个改动都同步更新** |
| `AGENTS.md` | 项目记录：环境速览（能力/工具清单/安装操作） | 存档型项目记录；Codex 引擎进本项目时按指令机制读取 | **重要功能**（新增能力/工具链/安装方式变化）才更新，不随会话重复注入 |
| `docs/TOOLCHAIN.md` | 工具链详查手册（调用命令/自助安装/故障排查） | 涉及工具/安装时查阅 | 工具链或安装方式变化时同步 |

> **读取机制澄清**：项目根 `AGENTS.md` 是存档型项目记录，**不是**每次会话动态注入的上下文。
> 真正每会话/每请求动态读取的是另两份：①应用内引擎读 `codex-home/AGENTS.md`（个性化 + 中文语言规范，每请求重读）；②WorkBuddy 助手读 `.workbuddy/memory/MEMORY.md`（工作记忆）。三者内容不同、互不干扰。

**功能更新流程铁律**（每轮改动固定顺序）：**① 改动同步更新 README.md → ② 重要功能额外更新 AGENTS.md → ③ 最后提交 git**。

## 💾 数据与更新

所有用户数据（供应商配置、会话记录、记忆、归档）均存放在 `%APPDATA%\Codex Harness Desktop\`（macOS 为 `~/Library/Application Support/`），**更新应用或引擎都不会丢失**。禁用供应商只是让它不再出现在模型下拉里，其配置会保留——用该供应商创建的历史会话依然可以打开和续聊。

## 📋 系统要求

- Windows 10 1809+ / macOS 12+（Intel 或 Apple Silicon）
- 需要能访问所配置的模型 API 端点

## 💬 反馈与交流

遇到 Bug 或有好想法，欢迎通过以下渠道告诉我们：

| 渠道 | 地址 | 说明 |
|---|---|---|
| 🐛 GitHub Issues | [提交 Bug / 建议](../../issues) | 带结构化表单，方便快速定位 |
| 💬 官网反馈页 | [www.jvszzp.ltd/feedback.html](https://www.jvszzp.ltd/feedback.html) | 支持截图上传，无需 GitHub 账号 |
| 📦 下载与更新 | [www.jvszzp.ltd](https://www.jvszzp.ltd) | 最新版本与更新日志 |

## ⚠️ 免责声明

本项目是对 OpenAI Codex CLI 的独立桌面封装，与 OpenAI 官方无隶属关系。使用本项目产生的 API 调用费用由用户自行承担。请遵守所在地区法律法规及 OpenAI 使用条款。

## 💝 赞助支持

如果你觉得这个项目有用，欢迎通过赞助商支持我们，助力持续开发：

<p align="center">
  <a href="https://api.pptoken.cc/register?aff=X82JSNVC3W3S" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#8b5cf6,#6366f1);color:#fff;border-radius:10px;font-size:15px;font-weight:600;text-decoration:none">💝 立即注册支持我们 →</a>
  <br><br>
  <em>https://api.pptoken.cc/register?aff=X82JSNVC3W3S</em>
</p>

## License

[MIT](LICENSE)
