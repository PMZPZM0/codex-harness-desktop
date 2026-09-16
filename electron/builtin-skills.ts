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

const BROWSER_SKILL = `---
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

export async function ensureBuiltinSkills(skillsDir: string) {
  const entries: [string, string][] = [
    ["desktop-automation", DESKTOP_SKILL],
    ["browser-automation", BROWSER_SKILL],
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
