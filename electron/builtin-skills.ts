// 内置技能：桌面自动化 + 浏览器自动化（Codex 通过技能学习如何调用本地自动化工具链）。
// 应用启动时写入 codexHome/skills/，与市场技能同构。
import fs from "node:fs/promises";
import path from "node:path";

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
description: 浏览器自动化工具链：playwright-cli（快速网页操作/抓取）与 CloakBrowser（反检测指纹浏览器，过 Cloudflare/reCAPTCHA 等）。任务需要打开网页、抓取、自动填表或对抗反爬时使用。
---

# 浏览器自动化

本机内置两套浏览器自动化，按目标网站防御强度选择：

## 1. playwright-cli（首选，快）

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

## 2. CloakBrowser（指纹浏览器，过反爬）

**本机内置的浏览器就是 CloakBrowser 指纹浏览器**（Chromium 146，源码级反检测补丁，可通过 Cloudflare Turnstile / reCAPTCHA / FingerprintJS）。应用内「浏览器」面板打开的网页也走它。

目标站有验证码/登录墙/反爬时，写 Node 脚本（应用子进程环境已配好 \`CLOAKBROWSER_ENTRY\`）：

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
- 内核已预装（CLOAKBROWSER_CACHE_DIR 已配好），**不要**运行 \`cloakbrowser install\`

## 选择规则

| 场景 | 用什么 |
|---|---|
| 打开网页/抓内容/填表单 | playwright-cli |
| Cloudflare/验证码/登录墙/风控站 | CloakBrowser |
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
