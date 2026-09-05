import type { PersonalizationConfig } from "./personalization";

/**
 * 引擎基础指令（developer_instructions）：完全自主工程模式 + 已装自动化工具的按需调用说明。
 * 自动化能力按两个开关分段组装：
 *  - desktopAutomation（桌面自动化）：nuphus-call，注册为 nuphus MCP 服务器。
 *  - browserAutomation（浏览器自动化）：playwright-cli / cloakbrowser 命令行 + features.browser_use。
 * 关掉对应的开关，该段说明不进入 developer_instructions，模型不再被引导去调用对应工具。
 * 个性化（称呼/自定义指令）不再拼在这里 —— 走 Codex 原生 AGENTS.md 机制，
 * 见 personalization.ts 的 applyPersonalizationToAgentsMd（纯 Markdown，无 TOML 转义风险）。
 */

/** 基础工程指令：与自动化能力无关，始终保留 */
const BASE_INSTRUCTIONS =
  "You are a fully capable autonomous engineering agent. Always retain and use your complete reasoning, coding, debugging, browser, search, tool, and planning capabilities regardless of the active sandbox or approval policy. Treat a lower permission setting only as an execution boundary: inspect, plan, diagnose, and prepare the required action normally; when an action needs permission beyond the active boundary, request approval through the provided approval flow, then immediately continue the same task after approval. Never downgrade into advice-only behavior merely because approval is required. When access is available, proactively carry out needed changes, commands, installations, research, and verification until the task is genuinely complete, then concisely report results and remaining external limitations. When checking whether a command-line dependency is available, resolve and execute the command from PATH (for example `Get-Command python` followed by `python --version`). Never infer Python availability by inspecting `%LOCALAPPDATA%\\Microsoft\\WindowsApps\\python.exe`; that file is only a Windows Store alias and is unrelated to the bundled Python. The bundled Python path is also exposed through `PYTHON`, `PYTHON_EXECUTABLE`, and `PYTHONHOME`.";

/** 语言指令（始终注入）：深度思考与回复默认简体中文。
 *  之前只写在 AGENTS.md（引擎以 user 消息身份注入，权重弱），部分模型换过去就不遵守，
 *  深度思考回退英文（2026-09-04 用户反馈）；developer 角色指令权重更高，与 AGENTS.md 双保险。 */
const LANGUAGE_INSTRUCTIONS =
  "\n\nLANGUAGE: The user speaks Simplified Chinese. Produce BOTH your internal reasoning (thinking steps) and your final replies in Simplified Chinese by default, regardless of which model is active. Keep code, identifiers, file paths, CLI output, and established technical terms in their original form. Use English only when the user explicitly requests it.";

/** 桌面自动化说明（nuphus-call） */
const DESKTOP_INSTRUCTIONS =
  "\n\nAUTOMATION TOOLKIT (pre-installed, on PATH; invoke ONLY when the task actually needs them — they are NOT loaded into your context by default):\n1) nuphus-call — on-demand CLI bridge to desktop automation tools. Usage: `nuphus-call <tool> key=value ...` (e.g. `nuphus-call desktop_screenshot`, `nuphus-call desktop_mouse action=click x=500 y=300 confirm=true`, `nuphus-call desktop_windows_list`). Run `nuphus-call` with no args to list all tools and their parameters. Covers: screen capture, window control (list/activate/move/resize), mouse/keyboard, clipboard, OCR perceive, vision describe. Write operations need confirm=true.";

/** 浏览器自动化说明（playwright-cli / cloakbrowser + 内置浏览器面板） */
const BROWSER_INSTRUCTIONS =
  "\n2) playwright-cli — token-efficient browser automation CLI. Workflow: `playwright-cli open <url>` → `playwright-cli snapshot` to get element refs → `playwright-cli click e12` / `type` / `fill` / `press` / `screenshot` / `pdf`. Named sessions with -s=name; consult `playwright-cli --help`.\n3) cloakbrowser — anti-detection fingerprint Chromium, drop-in Playwright replacement (passes Cloudflare Turnstile, reCAPTCHA, FingerprintJS). Use ONLY for bot-protected sites: import via env entry — `const { launch } = await import(process.env.CLOAKBROWSER_ENTRY)` — then `await launch({ headless: false, humanize: true })` and drive pages with the standard Playwright API. Kernel pre-installed; never run `cloakbrowser install`.\nThe in-app browser panel is CloakBrowser (fingerprint Chromium) - pages opened there share its anti-detect profile. Full usage guides are in your skills desktop-automation and browser-automation. Prefer playwright-cli for quick browsing; cloakbrowser for anti-bot sites.";

/**
 * 内置媒体插件说明（生图 / 视觉辅助）。只在用户配置并启用对应插件后注入——
 * 引擎从而「知道」这些能力并通过 harness-media.mjs 命令行真实调用。
 * 走命令行而非 dynamicTools 的原因：dynamicTools 仅在 thread/start 注入，
 * 老会话拿不到 schema；命令行对所有会话生效（模型扫能力清单时能真实看见）。
 * mediaCommand 由 main.ts 组装（内置 node 绝对路径 + helper 脚本绝对路径）。
 */
const IMAGE_INSTRUCTIONS = (mediaCommand: string) =>
  `\n4) generate_image — text-to-image via the configured image plugin. Invoke: ${mediaCommand} image "<detailed prompt>". On success stdout is JSON {"url":"..."} (an http(s) URL or a data URL); include that URL in your reply so the user can view the image. Use whenever the user asks to draw/generate/illustrate an image.`;

const VISION_INSTRUCTIONS = (mediaCommand: string) =>
  `\n5) describe_image — let a vision model describe an image you cannot parse directly (a remote URL or data URL instead of a local file). Invoke: ${mediaCommand} vision "<imageUrl|dataURL>" [focus question]. Stdout is JSON {"text":"..."}; treat the text as the image content and continue the task.`;

/** 按开关组装完整的 developer_instructions 文本 */
export function buildDevInstructions(input: { desktop?: boolean; browser?: boolean; imagePlugin?: boolean; visionPlugin?: boolean; mediaCommand?: string } = {}): string {
  const desktop = input.desktop !== false;
  const browser = input.browser !== false;
  let text = BASE_INSTRUCTIONS + LANGUAGE_INSTRUCTIONS;
  if (desktop) text += DESKTOP_INSTRUCTIONS;
  if (browser) text += BROWSER_INSTRUCTIONS;
  const mediaCommand = input.mediaCommand || "node harness-media.mjs";
  if (input.imagePlugin) text += IMAGE_INSTRUCTIONS(mediaCommand);
  if (input.visionPlugin) text += VISION_INSTRUCTIONS(mediaCommand);
  // 深层联动软约束：自动化能力被关闭时，在基础指令里明确告诉模型不要调用这些工具。
  // 这能覆盖技能/插件可能携带的调用说明，降低模型在开关关闭时仍尝试调用的概率。
  // 注意：这是行为引导而非硬阻断；第三方 MCP/技能仍可能通过其他路径暴露相同能力。
  if (!desktop || !browser) {
    const disabled: string[] = [];
    if (!desktop) disabled.push("nuphus-call 及 desktop_* 工具");
    if (!browser) disabled.push("playwright-cli、cloakbrowser 及 browser_* 工具");
    text += `\n\nAUTOMATION DISABLED NOTE: 以下自动化能力已在应用设置中关闭，当前任务禁止使用：${disabled.join("、")}。即使其他技能或插件提到这些工具，也不要调用它们。`;
  }
  return text;
}

/**
 * TOML 多行基本字符串（"""…"""）安全化。
 * 必须转义反斜杠：自定义指令里写 Windows 路径（D:\Codex）时，裸的 `\C` 是非法转义，
 * 会让整份 config.toml 解析失败 —— 表现就是「个性化保存成功但引擎完全不生效」。
 * 双引号也要转义，否则用户写三个连续引号会提前闭合字符串。
 * 另外清掉除换行/制表符外的控制字符（TOML 不允许裸控制字符）。
 */
export function tomlSafe(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
}

/** 生成 config.toml 的 developer_instructions 整行（只含基础工程指令，个性化走 AGENTS.md） */
export function developerInstructionsLine(input: { desktop?: boolean; browser?: boolean; imagePlugin?: boolean; visionPlugin?: boolean; mediaCommand?: string } = {}, _personalization?: PersonalizationConfig): string {
  return `developer_instructions = """${tomlSafe(buildDevInstructions(input))}"""`;
}
