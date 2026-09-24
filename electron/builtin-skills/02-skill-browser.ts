/**
 * builtin-skills 的「skill-browser」部分（09-22 从同目录 builtin-skills.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
// 已退役的内置技能原文（09-19 用 browser-skill 替换）：
// ⛔ 保留它只为**退役清理**做指纹比对 —— 用户磁盘上的同名目录内容与它逐字相同时才删，
//    用户自己改过/自建的目录一律不碰。
export const RETIRED_BROWSER_SKILL = `---
name: browser-automation
description: 浏览器自动化工具链：playwright-cli（默认通道，快速网页操作/抓取）与 CloakBrowser（可选的反检测指纹浏览器，过 Cloudflare/reCAPTCHA 等，按需下载）。任务需要打开网页、抓取、自动填表时使用。
---

# 浏览器自动化

## 0. 默认用内置浏览器（先读这条）

日常浏览/抓取**一律走内置通道**：应用内置的浏览器视图（右栏面板，Chromium）+ \`playwright-cli\`。
不要默认去用 CloakBrowser —— 它**不随应用内置**（需在「设置 → 开发工具」按需下载），
且只有过反爬站点时才需要。判断它装没装：\`process.env.CLOAKBROWSER_ENTRY\` 为空即未安装。

## 1. playwright-cli（默认，快）

命令行工具，已在 PATH。适合普通网站的操作与抓取：

\`\`\`bash
playwright-cli open https://example.com   # 打开页面（无头）
playwright-cli snapshot                    # 拿可交互元素引用（e12 之类）
playwright-cli click e12                   # 点击
playwright-cli type e5 "文本"              # 输入
playwright-cli screenshot page.png         # 截图
playwright-cli close                       # 关闭
\`\`\`

- 会话隔离：\`-s=名字\` 可同时开多个独立浏览器
- 页面快照是 token 友好的文本，优先用 snapshot 而不是截图
- 浏览器内核由用户在本应用「开发工具」页下载（国内镜像）；未下载时首次 open 会提示

## 2. CloakBrowser（可选增强：指纹浏览器，过反爬）

**按需下载项，可能未安装**（「设置 → 开发工具 → CloakBrowser 指纹浏览器」，约 4 MB；内核另需下载）。
先探 \`process.env.CLOAKBROWSER_ENTRY\`：为空说明没装，**直接改用 playwright-cli**，
不要自己跑安装命令，也不要把它当故障上报（可以把下载入口告诉用户）。装了之后写 Node 脚本：

\`\`\`javascript
// bot-check.mjs —— node bot-check.mjs 运行
const { launch } = await import(process.env.CLOAKBROWSER_ENTRY);
const browser = await launch({ headless: false, humanize: true });  // 有头+拟人化
const page = await browser.newPage();
await page.goto("https://target-site.com");
// 之后用标准 Playwright API：page.click / page.fill / page.$$
await browser.close();
\`\`\`

- \`headless: true\` 也能过大部分检测；需要人机交互时用 false
- 内核缓存目录是 CLOAKBROWSER_CACHE_DIR；内核由应用「开发工具」页负责下载，**不要**自己跑 \`cloakbrowser install\`
- 它是独立窗口，和应用内置浏览器视图（右栏面板）是两回事

## 选择规则

| 场景 | 用什么 |
|---|---|
| 打开网页/抓内容/填表单（默认） | 内置浏览器视图 / playwright-cli |
| 需要用户看着打开的页面 | 应用右栏内置浏览器面板 |
| Cloudflare/验证码/登录墙/风控站（且 CloakBrowser 已装） | CloakBrowser |
| 操作已打开的 Chrome 窗口 | nuphus 的 browser_* 工具 |
`;

export const BROWSER_SKILL = `---
name: browser-skill
description: 浏览器自动化技能：首选内置 nuphus 的 browser_* MCP 工具（元素快照、多步批处理、登录态复用），退化通道为 playwright-cli；含通道判存在、失败排查与 CloakBrowser 反爬升级。任务需要打开网页、抓数据、填表或做端到端验证时使用。
---

# 浏览器自动化

## 0. 通道选型：先判用哪条（第一步就要判对）

**① 首选：nuphus 的 \`browser_*\` MCP 工具** —— 已注册在你的工具列表里（前缀 \`browser_\`）。
为什么是它：**单次调用直达**（CLI 每个动作要起一次进程）、\`browser_snapshot\` 只回 AX 树上的可交互元素（**省 token**）、\`browser_exec\` 能把多步合并成**一次 CDP 往返**、可复用你已登录的浏览器。

**判存在**：工具列表里有 \`browser_navigate\` 就用它。
**没有**（用户在设置里关了自动化、或单独停了 nuphus）→ 落到 ②。

**② 退化通道：\`playwright-cli\`** —— 命令行工具，已在 PATH。仅在 nuphus 不可用时使用。

**③ 反爬增强：CloakBrowser** —— 指纹浏览器，**按需下载、可能未安装**，只有风控站才需要（见第 5 节）。

**④ 需要用户亲眼看页面** → 应用右栏的**内置浏览器面板**（Chromium，随应用内置）。

> ⛔ 不要 \`require("playwright")\` 裸写脚本 —— 内核与版本由应用管，绕过它必踩坑。
> 需要写脚本时，改用 nuphus 工具或 \`playwright-cli\`。

## 1. 三段循环：观察 → 动作 → 验证

| 段 | 首选工具 | 要点 |
|---|---|---|
| 观察 | \`browser_snapshot\`（AX 树文本）/ \`browser_extract\`（正文） | **只回元素与编号**，别去 dump 整页 HTML |
| 动作 | \`browser_exec\`（**多步合并，单次 CDP 往返**）/ \`browser_click\` / \`browser_type\` / \`browser_press\` | 能把「点开 → 填表 → 提交」一次发完，就别分三次调 |
| 验证 | \`browser_wait_for\`（等元素到某状态）→ 再 \`browser_snapshot\` 复核 | 等**条件**，不要 sleep 猜时间 |

## 2. nuphus \`browser_*\` 工具速查（24 个）

**导航**：\`browser_navigate\` · \`browser_back\` · \`browser_forward\`
**观察**：\`browser_snapshot\`（可交互元素 + 编号）· \`browser_extract\`（正文）· \`browser_screenshot\`
**交互**：\`browser_click\` · \`browser_type\` · \`browser_press\` · \`browser_scroll\` · \`browser_exec\`（批处理）
**等待**：\`browser_wait_for\`
**标签页**：\`browser_new_tab\` · \`browser_list_tabs\` · \`browser_switch_tab\`
**文件**：\`browser_upload\` · \`browser_drag_files\` · \`browser_list_downloads\`
**登录态**：\`browser_import_cookies\` · \`browser_cookies_get\` · \`browser_cookies_set\`
**其它**：\`browser_evaluate\`（页面内跑任意 JS）· \`browser_close\`

### 登录态复用（省掉重新登录，但有边界）

需要登录才能继续时，**先试 \`browser_import_cookies\`**：它把本机 Chrome 的 cookie 导进自动化会话。
- ⚠️ 这会把**该 Chrome profile 的站点凭证**交给自动化会话 —— 只在用户知情同意时用
- 若导入后仍被要求登录（站点认设备指纹、token 短效），退回「让用户人工登一次」

## 3. playwright-cli 速查（退化通道）

\`\`\`bash
playwright-cli open https://example.com   # 打开（-s=名字 可开独立会话）
playwright-cli snapshot                    # 拿可交互元素引用 e12 / e5 …
playwright-cli click e12                   # 操作
playwright-cli snapshot                    # 复核：真变了才算成功
playwright-cli close                       # 收尾
\`\`\`

**常用**：\`find <text>\`（页面内搜文本，比整页 snapshot 省得多）· \`eval <func>\`（取结构化数据）·
\`requests\` → \`response-body <i>\`（**SPA 别解析 DOM，直接抓 XHR 的 JSON**）·
\`state-save\` / \`state-load\`（复用登录）· \`tab-list\` / \`tab-new\` / \`tab-select\` ·
\`--raw\`（只输出结果值，最省 token）· \`kill-all\`（强杀僵尸会话）

**调试（排不动时用）**：\`console [min-level]\`（页面日志）· \`tracing-start\` / \`tracing-stop\` ·
\`highlight [target]\`（高亮元素）· \`generate-locator <target>\`（拿稳定选择器）· \`pause-at\` / \`resume\` / \`step-over\`（单步）

**失败对策（照这个查，别瞎试）**：

| 症状 | 对策 |
|---|---|
| 点不到 / 引用失效 | 重新 \`snapshot\`（页面变了）；或 \`find <文本>\` |
| 看不到目标元素 | 可能在 iframe / shadow DOM / 另一个标签页 → \`tab-list\` |
| cookie 横幅 / 登录墙 | 先 \`snapshot\` 看**真实**状态，处理干扰项再操作原目标 |
| 抓不到数据（SPA/无限滚动） | \`requests\` 找 XHR → \`response-body <i>\` 拿 JSON |
| 命令卡住 / 超时 | \`kill-all\` 清僵尸后重来 |
| 被反爬 / 验证码 | 换 CloakBrowser（见第 5 节），**不要**硬刚或反复重试 |

## 4. 元素引用 vs 坐标（别犯这个错）

- **引用只在当次快照有效**：页面一变就重新 \`snapshot\`。
- **不要用坐标点网页元素** —— 坐标会随滚动/布局漂移，用元素引用（\`@N\` / \`e12\`）。

## 5. CloakBrowser（可选增强：反检测指纹浏览器）

**按需下载项，可能未安装**（「设置 → 开发工具 → CloakBrowser 指纹浏览器」，约 4 MB；内核另需下载）。
先探 \`process.env.CLOAKBROWSER_ENTRY\`：为空说明没装 → **直接用 nuphus 工具或 playwright-cli**，
不要自己跑安装命令，也不要把它当故障上报（可以把下载入口告诉用户）。装了之后写 Node 脚本：

\`\`\`javascript
// bot-check.mjs —— node bot-check.mjs 运行
const { launch } = await import(process.env.CLOAKBROWSER_ENTRY);
const browser = await launch({ headless: false, humanize: true });  // 有头 + 拟人化
const page = await browser.newPage();
await page.goto("https://target-site.com");
await browser.close();
\`\`\`

- 内核缓存目录是 \`CLOAKBROWSER_CACHE_DIR\`；**不要**自己跑 \`cloakbrowser install\`
- 它是**独立窗口**，和应用右栏内置浏览器面板是两回事

## 6. 产出规范

- 抓到的数据**写到工作区文件**（JSON / CSV），不要把大段内容贴进对话
- 截图存到工作区，并把**路径**给用户（不要只贴 base64）
- 汇报写清：访问了哪个 URL、做了什么、拿到什么、哪一步没成

## 7. 边界（硬约束）

- 登录 / 支付 / 删除 / 发布这类**不可逆动作，先问用户**再点
- 同一站点连续失败 2 次就停下来报告，不反复重试（可能触发风控）
- 不用浏览器自动化绕过付费墙、验证码或做违反站点条款的事
`;
