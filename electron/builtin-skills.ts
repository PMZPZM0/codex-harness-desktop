// 内置技能：桌面自动化 + 浏览器自动化（Codex 通过技能学习如何调用本地自动化工具链）。
// 应用启动时写入 codexHome/skills/，与市场技能同构。
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

const DESKTOP_SKILL = `---
name: desktop-automation
description: 用 nuphus-mcp 的 desktop_* 工具操控本机桌面：截屏、列窗口、激活窗口、鼠标点击、键盘输入。当任务需要操作真实屏幕、窗口或原生应用时使用。
---

# 桌面自动化

本机已内置 Nuphus 桌面自动化 MCP（服务器名 \`nuphus\`），工具已直接注册在你的工具列表中（\`desktop_*\` 前缀），**直接调用即可，无需写脚本**。

## 核心工具

| 工具 | 用途 | 关键参数 |
|---|---|---|
| \`desktop_windows_list\` | 列出所有可见窗口（拿 hwnd） | 无 |
| \`desktop_window_activate\` | 把目标窗口置前（**操作前必做**） | hwnd |
| \`desktop_screenshot\` | 截全屏或区域 | region:{x,y,width,height}（可选） |
| \`desktop_mouse\` | 点击/双击/悬停/滚动 | action, x, y, confirm=true（写操作） |
| \`desktop_input\` | 输入文本或按组合键 | mode=type/hotkey, hwnd, text/keys, confirm=true |
| \`desktop_screen_size\` | 屏幕分辨率 | 无 |

## 标准操作序列

1. \`desktop_windows_list\` 找到目标窗口的 hwnd
2. \`desktop_window_activate\` 激活它（不激活键鼠会打到别的窗口）
3. \`desktop_screenshot\` 看当前画面定位坐标
4. \`desktop_mouse\` / \`desktop_input\` 执行操作（写操作记得 \`confirm=true\`）

## 注意

- 点击坐标来自截图推算，操作后建议再截屏确认结果
- 大段文本（>500 字）用 \`desktop_clipboard_write\` + Ctrl+V，比逐字输入快且稳
- 中文输入用 clipboard 粘贴方式最可靠
`;

// 已退役的内置技能原文（09-19 用 browser-skill 替换）：
// ⛔ 保留它只为**退役清理**做指纹比对 —— 用户磁盘上的同名目录内容与它逐字相同时才删，
//    用户自己改过/自建的目录一律不碰。
const RETIRED_BROWSER_SKILL = `---
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

const BROWSER_SKILL = `---
name: browser-skill
description: 浏览器自动化技能：用 playwright-cli 完成导航、元素定位与交互、表单、多标签、上传下载、网络抓包、控制台调试、登录态复用、失败排查；含通道选型与 CloakBrowser 反爬升级。任务需要打开网页、抓数据、填表或做端到端验证时使用。
---

# 浏览器自动化（playwright-cli）

> ⛔ 只用 \`playwright-cli\` 命令行，**不要** \`require("playwright")\` —— 内核与版本由应用管，绕过它必踩坑。

## 0. 五条铁律

1. **先看再动**：每个操作后 \`snapshot\` 或读输出复核，别凭记忆连点。
2. **引用会失效**：\`snapshot\` 给的 \`e12\` 只在当次快照有效；页面一变就重新 snapshot。
3. **等条件、不等时间**：不要 sleep 猜时间；轮询等具体元素 / URL / 文本出现。
4. **省 token**：优先 \`snapshot\`（文本）而不是 \`screenshot\`（图）；批量输出加 \`--raw\`。
5. **收尾必关**：结束用 \`close\`；残留会话占内存且拖慢下次 open；卡死用 \`kill-all\` 清僵尸。

## 1. 标准工作流

\`\`\`bash
playwright-cli open https://example.com   # 打开（-s=名字 可开独立会话）
playwright-cli snapshot                    # 拿可交互元素引用 e12 / e5 …
playwright-cli click e12                   # 操作
playwright-cli snapshot                    # 复核：真变了才算成功
playwright-cli close                       # 收尾
\`\`\`

浏览器内核需在本应用「开发工具」页下载（国内镜像）；未下载时首次 \`open\` 会提示。

## 2. 命令速查（按用途）

**导航**：\`open [url]\` · \`goto <url>\` · \`go-back\` · \`go-forward\` · \`reload\` · \`resize <w> <h>\` · \`network-state-set online|offline\`

**定位与交互**：\`snapshot [target]\` · \`find <text>\` · \`click <target>\` · \`dblclick\` · \`fill <target> <text>\` · \`type\` ·
\`press <key>\` · \`keydown/keyup\` · \`select <target> <val>\` · \`check/uncheck\` · \`hover\` · \`drag <start> <end>\` · \`drop\` ·
\`upload <files...>\` · \`eval <func> [target]\` · \`dialog-accept/dismiss\` · \`mousemove/mousedown/mouseup/mousewheel\`

**读取与提取**：\`find <text>\`（在页面里搜文本，比整页 snapshot 省得多）；\`eval\` 跑 JS 取结构化数据，例如
\`playwright-cli eval "() => [...document.querySelectorAll('h2')].map(h => h.textContent)"\`

**网络（抓接口数据，SPA 必用）**：\`requests\` 列出页面加载以来的请求（带编号）→ \`request <i>\` 看详情 →
\`response-body <i>\` 拿响应体（文本内联、二进制存文件并给路径）；\`request-headers/body\`、\`response-headers\`；
mock 用 \`route <pattern>\` / \`route-list\` / \`unroute\`

**调试**：\`console [min-level]\` 看页面日志 · \`tracing-start|tracing-stop\` · \`video-start|video-stop\` ·
\`show\` 打开 dashboard · \`highlight [target]\` · \`generate-locator <target>\` · \`pause-at\` / \`resume\` / \`step-over\`

**多标签**：\`tab-list\` · \`tab-new [url]\` · \`tab-select <index>\` · \`tab-close [index]\`

**登录态与存储**：\`state-save [file]\` / \`state-load <file>\`（复用登录，免重复登录）· \`cookie-*\` · \`localstorage-*\` · \`sessionstorage-*\` · \`delete-data\`

**会话**：\`-s=<name>\` 多会话隔离 · \`list\` · \`close-all\` · \`kill-all\`（强杀僵尸）

**全局选项**：\`--json\`（结构化输出） · \`--raw\`（只输出结果值，最省 token） · \`--help [command]\`（单命令帮助）

## 3. 常见失败与对策（照这个查，别瞎试）

| 症状 | 对策 |
|---|---|
| 点不到元素 / 引用失效 | 重新 \`snapshot\`（页面变了）；或 \`find <文本>\` 定位 |
| 页面里看不到目标元素 | 可能在 iframe / shadow DOM / 另一个标签页 → \`tab-list\` 看看有没有新页 |
| 页面弹了 cookie 横幅 / 登录墙 | 先 \`snapshot\` 看**真实**状态，处理干扰项再操作原目标 |
| 抓不到数据（SPA/无限滚动） | 别解析 DOM：\`requests\` 找 XHR → \`response-body <i>\` 直接拿 JSON |
| 需要登录才能继续 | 有存过的登录态就 \`state-load\`；否则先让用户人工登一次再 \`state-save\` 复用 |
| 被反爬 / 验证码 | 换 CloakBrowser（见第 6 节），**不要**硬刚或反复重试 |
| 命令卡住 / 超时 | \`kill-all\` 清僵尸会话后重来；必要时 \`close-all\` |
| 输出太长塞满上下文 | 加 \`--raw\`；或先 \`find\` 缩小范围 |
| 不知道某个命令的参数 | \`playwright-cli --help <command>\` |

## 4. 产出规范

- 抓到的数据**写到工作区文件**（JSON / CSV），不要把大段内容贴进对话
- 截图存到工作区，并把**路径**给用户（不要只贴 base64）
- 汇报写清：访问了哪个 URL、做了什么、拿到什么、哪一步没成

## 5. 边界（硬约束）

- 登录 / 支付 / 删除 / 发布这类**不可逆动作，先问用户**再点
- 同一站点连续失败 2 次就停下来报告，不反复重试（可能触发风控）
- 不用浏览器自动化绕过付费墙、验证码或做违反站点条款的事

## 6. 通道选型（哪个场景用哪个）

| 场景 | 用什么 |
|---|---|
| 打开网页 / 抓内容 / 填表单（**默认**） | 本文的 \`playwright-cli\` |
| 需要用户**看着**打开的页面 | 应用右栏的**内置浏览器面板**（Chromium，随应用内置） |
| Cloudflare / 验证码 / 登录墙等风控站 | **CloakBrowser**（可选增强，见第 7 节） |
| 操作用户**已打开的真实 Chrome** 窗口 | nuphus 的 \`browser_*\` 工具（桌面自动化那套） |

## 7. CloakBrowser（可选增强：反检测指纹浏览器）

**按需下载项，可能未安装**（「设置 → 开发工具 → CloakBrowser 指纹浏览器」，约 4 MB；内核另需下载）。
先探 \`process.env.CLOAKBROWSER_ENTRY\`：为空说明没装 → **直接改用 playwright-cli**，
不要自己跑安装命令，也不要把它当故障上报（可以把下载入口告诉用户）。装了之后写 Node 脚本：

\`\`\`javascript
// bot-check.mjs —— node bot-check.mjs 运行
const { launch } = await import(process.env.CLOAKBROWSER_ENTRY);
const browser = await launch({ headless: false, humanize: true });  // 有头 + 拟人化
const page = await browser.newPage();
await page.goto("https://target-site.com");
// 之后用标准 Playwright API：page.click / page.fill / page.$$
await browser.close();
\`\`\`

- \`headless: true\` 也能过大部分检测；需要人机交互时用 false
- 内核缓存目录是 \`CLOAKBROWSER_CACHE_DIR\`；内核由应用「开发工具」页负责下载，**不要**自己跑 \`cloakbrowser install\`
- 它是**独立窗口**，和应用内置浏览器面板（右栏）是两回事
`;


/** 已退役的内置技能：磁盘上的内容仍是**我们当初写的那份**时，随升级清掉目录 ——
 *  否则引擎会同时加载两套浏览器说明（新的实操手册 + 旧的通道说明），模型读到自相矛盾的指引。
 *  ⛔ 只认逐字一致的指纹：用户改过、或自己建的目录**一律不碰**（不越界删用户文件）。
 *    被总闸禁用的技能文件名是 `SKILL.md.disabled`，两个名字都要比。 */
const RETIRED_SKILLS: [string, string][] = [["browser-automation", RETIRED_BROWSER_SKILL]];

export async function ensureBuiltinSkills(skillsDir: string) {
  const entries: [string, string][] = [
    ["desktop-automation", DESKTOP_SKILL],
    ["browser-skill", BROWSER_SKILL],
  ];
  for (const [name, content] of entries) {
    const dir = path.join(skillsDir, name);
    const file = path.join(dir, "SKILL.md");
    try {
      const existing = await fs.readFile(file, "utf8").catch(() => "");
      if (existing !== content) {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(file, content, "utf8");
      }
    } catch { /* 写不进不阻塞启动 */ }
  }

  // 退役清理：只删「内容仍是我们写的那份」的旧内置技能目录（browser-automation → browser-skill）。
  //  ⛔ 内建写入是只增不删的：不清理的话，老用户磁盘上那份旧技能会继续被引擎加载，
  //    模型同时读到两套浏览器说明（自相矛盾的指引）。
  //  ⛔ 只认逐字一致的指纹：用户改过、或自己建的目录一律不碰（不越界删用户文件）。
  //    被总闸禁用的技能文件名是 SKILL.md.disabled，两个名字都要比。
  for (const [name, original] of RETIRED_SKILLS) {
    const dir = path.join(skillsDir, name);
    try {
      for (const fn of ["SKILL.md", "SKILL.md.disabled"]) {
        const existing = await fs.readFile(path.join(dir, fn), "utf8").catch(() => null);
        // ⛔ 比对必须归一化行尾：技能被总闸停用/启用过一次后，文件可能被重写成 LF，
        //    而常量是 CRLF —— 只用 trim() 会比出「被改过」而跳过清理（09-19 实测踩到：
        //    验收里旧技能目录一直留着，根因就是这个）。行尾不是「内容」的一部分。
        if (existing === null) continue;
        if (existing.replace(/\r\n/g, "\n").trim() !== original.replace(/\r\n/g, "\n").trim()) {
          // ⛔ 不删，但**必须留痕**：静默跳过会让「两套浏览器说明同时被加载」这种问题
          //    完全查不出（09-19 实测：指纹差 1 个字符，清理静默失效，只有真机验收才发现）。
          console.warn(`[skills] 退役技能 ${name} 的内容已被改动（非我们写的那份），保留不动`);
          continue;
        }
        await fs.rm(dir, { recursive: true, force: true });
        console.log(`[skills] 已退役内置技能 ${name}（目录已清理）`);
        break;
      }
    } catch { /* 删不掉不阻塞启动 */ }
  }
}

/**
 * 专家技能市场（09-13）：cheat-on-content / ppt-master 随包静态分发在
 * resources/expert-skills/（含 .claude-plugin/marketplace.json 清单），**原位不动、零拷贝**——
 * 只在 config.toml 幂等注册 [marketplaces.expert-skills]（source_type=local 指向该目录），
 * 引擎 plugin/list 直接从原目录发现技能，装好即用。
 * 该段不在 HARNESS_CONFIG_SECTIONS，harness 整份重写 config 时由 preserveUserConfig 原样保留。
 */
export async function ensureExpertSkillsMarketplace(codexHome: string): Promise<void> {
  const marketDir = expertSkillsSourceDir();
  const configPath = path.join(codexHome, "config.toml");
  try {
    const existing = await fs.readFile(configPath, "utf8").catch(() => "");
    if (!/\[marketplaces\.expert-skills\]/.test(existing)) {
      const section = [
        "[marketplaces.expert-skills]",
        'source_type = "local"',
        `source = "${marketDir.replaceAll("\\", "/")}"`,
        "",
      ].join("\n");
      const next = existing.trim() ? existing.trimEnd() + "\n\n" + section + "\n" : section + "\n";
      await fs.writeFile(configPath, next, "utf8");
    }
  } catch (error) {
    console.warn("seed expert-skills marketplace section failed:", error);
  }
}

/** 专家技能包源目录：开发版用项目 resources/，打包版用 process.resourcesPath（与 voicePresetsDir 同规则）。
 *  ⚠️ 导出给 expert-teams 用：内置专家要把「技能包绝对路径」写进 systemPrompt 做兜底 ——
 *  `[marketplaces.expert-skills]` 只是让技能**可被发现**，用户没装就不可用
 *  （实测 codex-home/plugins/cache 下没有 expert-skills 条目）。路径写死进提示词，
 *  专家才能用文件工具直接读到规则集，闭环不依赖「用户是否去技能中心装过」。 */
export function expertSkillsSourceDir(): string {
  const dev = path.join(process.cwd(), "resources", "expert-skills");
  if (existsSync(dev)) return dev;
  return path.join(process.resourcesPath ?? process.cwd(), "expert-skills");
}
