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
description: 浏览器自动化技能（browse-skills）：装了 Ego Lite 就优先走 ego-browser（每会话一个 TaskSpace、多会话并行）；没装则回落 nuphus-call browser_* 调用默认浏览器。⛔ 不再使用 Playwright / CloakBrowser。
---

# 浏览器自动化（Ego Lite）

## 0. 通道优先级

1. **首选 \`ego-browser\`（ego lite）**：真实 Chromium、保留登录态；每个 Codex 会话一个独立 TaskSpace。
2. **未装 Ego Lite → \`nuphus-call browser_*\`（默认浏览器回落）**：调用 nuphus 的浏览器自动化工具，操作本机默认浏览器；见第 5 节。
3. **用户自己看页面** → 应用右栏内置浏览器面板（不是自动化通道）。
4. 完整 ego API / 故障排查：运行 \`ego-browser skill\`，按它打印的**当前版本**指南执行；本技能补充宿主策略（每会话 Space / 复用 / 回收）。

⛔ 不要再用 \`playwright-cli\`（已从应用移除）、CloakBrowser（已移除），也不要直接调用 nuphus 的 MCP \`browser_*\`（当前引擎必返 unsupported call）；回落一律走 **\`nuphus-call browser_*\` CLI**。

## 1. 一会话一 Space（硬规则）

1. 先取本会话 ID：
   - Windows PowerShell：\`$env:CODEX_THREAD_ID\`
   - macOS / Bash：\`$CODEX_THREAD_ID\`
2. Space 名固定为 \`codex-<会话ID>\`。第一轮 \`const task = await taskSpace("codex-<id>")\` 创建/续用；打印 \`task.spaceId\`。
3. **同一会话的后续轮次必须用同一个名字续用**，不要再建新 Space；一个目标一个 Space，整个会话保持。
4. 多个 Codex 会话同时跑时，各自 ID 不同 ⇒ 各自 Space，互不抢标签页。⛔ 不要 \`claimTaskSpace\` 别人的 \`codex-*\` Space。
5. **不要每轮 \`finish()\`**：Space 里的标签页和登录态要留给后续轮次；只有用户明确说「清理 / 关闭浏览器工作区」时才 \`finish({ keep: [] })\`。会话归档时应用会自动回收。
6. 用户自己拥有的 Space（\`ownership: "user"\`）不要碰；需要接管先问用户。

## 2. 双平台运行脚本

ego 的 Node **不继承 shell 环境变量** ⇒ 会话 ID 要以字面量写进脚本；先 echo 出来再写文件。

**Windows / PowerShell**（推荐 .mjs + ASCII-only 入口）：

\`\`\`powershell
$env:CODEX_THREAD_ID
# 用文件工具写 round-01.mjs，内容里写死 const TID = "<上一步的 ID>";
ego-browser nodejs -e "await import('file:///C:/绝对路径/round-01.mjs')"
\`\`\`

不要用 PowerShell heredoc（不存在），也不要用 \`Get-Content\` 管道（UTF-8 会被按 ANSI 读坏）。

**macOS / Linux / Git Bash**：

\`\`\`bash
ego-browser nodejs < /绝对路径/round-01.mjs
\`\`\`

或 heredoc（Bash/Zsh）：

\`\`\`bash
ego-browser nodejs <<'EOF'
...
EOF
\`\`\`

每轮写新的完整文件（round-01.mjs、round-02.mjs…）；不要把上一轮的文件改一改重跑（会重放旧动作）。

## 3. 最小 API 速查

\`\`\`js
const task = await taskSpace("codex-<会话ID>");
const page = task.page("p1");              // 新 Space 自带 p1；不要每步开新页
await page.goto("https://example.com");
const snap = await page.snapshot();        // 可交互元素 + ref/text
await page.click("@12");                   // 或 loc=role:button[name='...']
await page.fill("@21", "hello");
await page.waitForSelector("loc=css:#done", { state: "visible" });
console.log(await page.snapshot());        // 每轮最后打印一次，作为下一轮起点
\`\`\`

- 页面操作：\`goto / snapshot / click / fill / press / selectOption / waitForSelector / waitForURL / evaluate / screenshot / url / title\`
- 多页：\`await task.pages()\`、\`task.page("p2")\`、\`await task.newPage()\`；用完 \`page.close()\`。
- 需要完整签名 / 不常用选项：\`help()\` 或 \`help("page.click")\`（ego 会自己打印，别包 console.log）。
- 没有的 API 用 \`page.evaluate\` 或 \`page.cdp\`，不要猜其他自动化框架的方法。

## 4. 一轮怎么做

观察 → 动作 → 验证：

- 先用 \`snapshot()\` 看可交互元素；同一页的多步动作在一次脚本里做完，最后再 snapshot 复核。
- 能用语义选择器就不要用坐标；页面一变就重新 snapshot。
- SPA 抓数据优先 \`page.evaluate\` 取结构化数据，别整页 dump HTML。
- 每轮把截图 / JSON 写到工作区绝对路径，不要把大段内容贴进对话。

## 5. ego 未安装时：browse-skills 默认浏览器回落

如果 \`ego-browser\` 不存在或连不上，改用 **\`nuphus-call browser_*\`**（nuphus 的浏览器自动化 CLI，操作本机默认浏览器；\`nuphus-call\` 已在 PATH）：

\`\`\`bash
nuphus-call browser_navigate url="https://example.com"
nuphus-call browser_snapshot
nuphus-call browser_click ref="@12"
nuphus-call browser_type ref="@21" text="hello"
nuphus-call browser_press key="Enter"
nuphus-call browser_close
\`\`\`

- 一次一个动作，动作后 \`browser_snapshot\` 复核；多步可用 \`browser_exec\` 合并。
- 需要复用登录态：\`nuphus-call browser_import_cookies\`（用户知情时）。
- 这条回落**不按 Codex 会话隔离 Space**；能装 Ego Lite 时优先 ego（每会话独立 Space）。
- 不要自己安装 ego lite、不要跑第三方安装脚本、不要换回 Playwright 等其他通道；告诉用户到「设置 → 开发工具 → Ego Lite 浏览器自动化」安装，并附上原始报错。

## 6. 边界

- 登录 / 支付 / 删除 / 发布等不可逆动作先问用户。
- 同一站点连续失败 2 次就停下报告，别反复重试（可能触发风控）。
- 不用浏览器自动化绕过付费墙、验证码或违反站点条款。
- 用户没明确要求时不要操作 / 接管用户自己的 Space 或标签页。
`;
