// 内置技能：桌面自动化 + 浏览器自动化（Codex 通过技能学习如何调用本地自动化工具链）。
// 应用启动时写入 codexHome/skills/，与市场技能同构。
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

const DESKTOP_SKILL = `---
name: desktop-automation
description: 用 nuphus-mcp 的 desktop_* 工具操控本机桌面：截屏、列窗口、激活窗口、定位界面元素、鼠标点击、键盘输入。当任务需要操作真实屏幕、窗口或原生应用时使用。
---

# 桌面自动化

本机已内置 Nuphus 桌面自动化 MCP（服务器名 \`nuphus\`），工具已直接注册在你的工具列表中（\`desktop_*\` 前缀），**直接调用即可，无需写脚本**。

## 0. 三段循环：先看 → 再做 → 再验

| 段 | 工具 | 要点 |
|---|---|---|
| 观察 | \`desktop_windows_list\` → \`desktop_window_activate\` → \`desktop_screenshot\` / \`desktop_perceive\` | 先拿 hwnd 再激活；**不激活，键鼠会打到别的窗口** |
| 动作 | \`desktop_mouse\` / \`desktop_input\` / \`desktop_mouse_drag\` | 写操作必须带 \`confirm=true\` |
| 验证 | 动作后**再截屏确认结果** | 不要假定成功 |

## 1. 定位元素：\`desktop_perceive\` 优先，别用 \`desktop_vision\` 的坐标

- **\`desktop_perceive\`** —— 本地 OCR + 可选 YOLO，**在本机跑、零 API 成本**，返回精确元素坐标。**要点击，就用它拿坐标。**
- **\`desktop_vision\`** —— 调视觉模型（BYOK）描述画面。它的工具描述里明确写着 *"Coords imprecise — never click with them"* ⇒ **绝不能拿它给的坐标去点**，只用来「看懂画面 / 读文字」。

⚠️ **Intel Mac 上本地 OCR 不可用**（上游 ONNX Runtime 已放弃 osx-x64，非本应用问题）：
\`desktop_perceive\` 会失败。这**不是故障**、不要上报为 bug —— 改用 \`desktop_vision\`（需先配视觉模型），或截图后请用户确认坐标。

## 2. 常用工具

| 工具 | 用途 | 关键参数 |
|---|---|---|
| \`desktop_windows_list\` | 列出所有可见窗口（拿 hwnd） | 无 |
| \`desktop_window_activate\` | 目标窗口置前（**操作前必做**） | hwnd |
| \`desktop_window_info\` | 窗口详情（标题/可见性/状态/矩形/进程/类名） | hwnd |
| \`desktop_screenshot\` | 截全屏或区域 | region:{x,y,width,height}（可选） |
| \`desktop_window_screenshot\` | 按 hwnd 或标题截单个窗口 | hwnd 或 title |
| \`desktop_perceive\` | 本地 OCR 定位界面元素 → 精确坐标（见第 1 节） | 无 |
| \`desktop_mouse\` | 点击/双击/悬停/滚动/移动 | action, x, y, confirm=true |
| \`desktop_mouse_drag\` | 拖拽 | 起点与终点坐标, confirm=true |
| \`desktop_input\` | 输入文本或按组合键 | mode=type/hotkey, hwnd, text/keys, confirm=true |
| \`desktop_clipboard_write\` | 长文本（>500 字）写剪贴板 | 配合 Ctrl+V 粘贴 |
| \`desktop_clipboard_clean\` | 清空剪贴板 | 会丢用户原有剪贴板内容 |
| \`desktop_screen_size\` | 屏幕分辨率 | 无 |

## 3. 硬约束

- **不可逆动作先问用户**：发送、支付、删除、发布、覆盖保存 —— 先说清你要点什么、然后等确认。
- **别赖在用户的键鼠上**：只在任务确实需要时激活窗口操作，做完把焦点还回去。
- **大段文本走剪贴板**：\`desktop_clipboard_write\` + 粘贴快捷键比逐字输入快且稳（中文尤其可靠）。
  ⛔ 按键**按平台写**：Windows 是 \`Ctrl+V\`，macOS 是 \`Cmd+V\` —— 别写死一个平台（写错就是「粘贴没反应」）。
- **UAC / 提权窗口无法自动化**（系统安全边界）：遇到就停下，让用户自己点。
- **窗口动过就要重新定位**：移动/改尺寸后坐标全部失效，重新截屏或 \`desktop_perceive\`。
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
    const activeFile = path.join(dir, "SKILL.md");
    const disabledFile = path.join(dir, "SKILL.md.disabled");
    try {
      // ⛔ 必须尊重用户的停用状态（09-20 修）：能力总闸停用技能时是把 SKILL.md 改名成
      //    SKILL.md.disabled，而这里原先无条件写回 SKILL.md ⇒ **用户关掉的技能每次启动都被静默
      //    重新启用**，总闸形同虚设；症状还特别隐蔽（界面显示「已停用」，引擎却照常加载）。
      //    两个文件名与 main.ts 的 skills:local-list / set-skill-enabled 保持同源。
      const target = existsSync(activeFile)
        ? activeFile
        : existsSync(disabledFile) ? disabledFile : activeFile;
      const existing = await fs.readFile(target, "utf8").catch(() => "");
      // 比对前归一化行尾：停用/启用会把文件重写成 LF，与常量里的行尾不同，
      // 逐字比会每次启动都重写一遍（无意义写盘，且让「内容未变就别动」的判据失效）。
      if (existing.replace(/\r\n/g, "\n") !== content.replace(/\r\n/g, "\n")) {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(target, content, "utf8");
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
