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

/** 桌面自动化说明（nuphus MCP 的 desktop_* 工具；nuphus-call 是等价命令行兜底）
 *  ⛔ 这里的文案要**与事实一致**（09-20 修）：desktop_* 是通过 [mcp_servers.nuphus] 注册的
 *  MCP 工具，**已经在模型工具列表里**，直接调用即可 —— 旧文案只提 nuphus-call 命令行，
 *  把「直接调用」这条路藏起来了（模型被迫走 CLI，每步多一次进程往返）。
 *  细节留在技能里（渐进披露），这里只给优先级与判据，避免每轮多花几百 token。 */
const DESKTOP_INSTRUCTIONS =
  "\n\nAUTOMATION TOOLKIT (pre-installed; use ONLY when the task actually needs it — the tools themselves are NOT described in your context by default):\n1) Desktop automation — IF `desktop_windows_list` is in your tool list, the nuphus MCP desktop tools are already registered; call them directly, no script needed. Loop: `desktop_windows_list` → `desktop_window_activate` → observe (`desktop_screenshot` / `desktop_perceive`) → act (`desktop_mouse` / `desktop_input`, pass confirm=true) → verify with another screenshot. Take click coordinates from `desktop_perceive` (runs locally, free); `desktop_vision` coordinates are explicitly unreliable — never click with them. For long text (>500 chars) write the clipboard first and paste (Ctrl+V on Windows, Cmd+V on macOS — never hardcode one platform). `nuphus-call` (on PATH) is the equivalent CLI fallback: `nuphus-call <tool> key=value ...`; run it with no args to list every tool. IF the tools are NOT in your list, desktop automation is switched off (the tools are hard-removed, not broken): do not call `desktop_*`, do not fall back to `nuphus-call` to bypass the switch, and just tell the user it is disabled in Settings → Automation. Never automate a UAC / privilege-elevation prompt — stop and ask the user.";

/**
 * 浏览器自动化说明。
 * ⛔ 09-20 修正通道优先级（此前把慢的那条说成"默认"）：
 *  - 首选 = nuphus MCP 的 `browser_*` 工具。它们**本来就注册在模型工具列表里**
 *    （[mcp_servers.nuphus] 全量注册 24 个），但旧文案一次都没提它们、反而 20 多次指引
 *    playwright-cli ⇒ 24 个工具的 schema 白占上下文，而模型每步都要起一次 CLI 进程。
 *    实测定量：`browser_exec` 能把多步合并成单次 CDP 往返、`browser_snapshot` 只回 AX 树。
 *  - **判据是「工具列表里有没有 browser_navigate」**，不是「我们建议用哪个」——
 *    nuphus 只在桌面自动化总闸开启时才注册（mcp_servers.nuphus 段缺失就没有这些工具），
 *    所以必须写成条件式，否则模型会去调不存在的工具、把「没开」误判成「坏了」。
 *  - playwright-cli 降级为**兜底**通道（nuphus 不可用时仍能干活）。
 *  - cloakbrowser 仍是可选增强，可能根本没装 —— 必须先看环境变量再决定。
 */
const BROWSER_INSTRUCTIONS =
  "\n2) Browser automation — two channels; pick by what is ACTUALLY in your tool list:\n   a) PREFERRED — the nuphus MCP browser tools (prefix `browser_`). If `browser_navigate` appears in your tool list, use these: one call per action instead of a process spawn per action, `browser_snapshot` returns only the accessibility tree's interactive elements (token-cheap), `browser_exec` batches several steps into ONE round trip, `browser_import_cookies` can reuse the user's existing Chrome login (use only with their knowledge). Loop: snapshot → act → `browser_wait_for`/re-snapshot to verify.\n   b) FALLBACK — `playwright-cli` (on PATH), for when the `browser_*` tools are NOT present (e.g. desktop automation is switched off in app settings, so nuphus is not registered). Workflow: `playwright-cli open <url>` → `playwright-cli snapshot` for element refs → `click e12` / `type` / `fill` / `press` / `screenshot`; named sessions with -s=name; consult `playwright-cli --help`.\n3) cloakbrowser — OPTIONAL anti-detection fingerprint Chromium (drop-in Playwright replacement that passes Cloudflare Turnstile, reCAPTCHA, FingerprintJS). It is downloadable on demand and may NOT be installed: check `process.env.CLOAKBROWSER_ENTRY` first. If it is unset, cloakbrowser is not installed — do NOT try to install it and do NOT treat it as broken; use the channel from (2) instead and tell the user it can be downloaded from Settings → Developer Tools. When it is set: `const { launch } = await import(process.env.CLOAKBROWSER_ENTRY)` then `await launch({ headless: false, humanize: true })`, driven with the standard Playwright API. Use it ONLY for bot-protected sites.\nBROWSERS: default browsing surface is the app's BUILT-IN browser view (right-side Chromium panel); CloakBrowser only opens its own separate fingerprint window. Full usage guides live in your skills `desktop-automation` and `browser-skill`. Do NOT wrap `require(\"playwright\")` yourself — the CLI and MCP channels are the only supported entry points.";

/**
 * 内置媒体插件说明（生图 / 视觉辅助）。只在用户配置并启用对应插件后注入——
 * 引擎从而「知道」这些能力并通过 harness-media.mjs 命令行真实调用。
 * 走命令行而非 dynamicTools 的原因：dynamicTools 仅在 thread/start 注入，
 * 老会话拿不到 schema；命令行对所有会话生效（模型扫能力清单时能真实看见）。
 * mediaCommand 由 main.ts 组装（内置 node 绝对路径 + helper 脚本绝对路径）。
 */
const IMAGE_INSTRUCTIONS = (mediaCommand: string) =>
  `\n4) generate_image — text-to-image via the configured image plugin. Invoke: ${mediaCommand} image "<detailed prompt>". On success stdout is JSON {"path":"<local file>","url":"<gateway-hosted URL>"}: path is the DURABLE local copy — prefer it (view it with view_image(path), or reference the path); url is a temporary gateway-hosted link that may expire within hours (observed: dead next day), so NEVER present url as a permanent link to the user. Use whenever the user asks to draw/generate/illustrate an image.`;

const VISION_INSTRUCTIONS = (mediaCommand: string) =>
  `\n5) describe_image — let a vision model describe an image you cannot parse directly. Invoke: ${mediaCommand} vision "<image>" [focus question] where <image> can be a LOCAL FILE PATH (fastest — pass it as-is, the helper reads and encodes it for you), a remote http(s) URL, or a data URL. Do NOT base64-encode local files yourself before calling — pass the path directly. Stdout is JSON {"text":"..."}; treat the text as the image content and continue the task.`;

/** 新鲜上下文复审（09-21）：写的人不审自己。
 *  为什么要写进指令：模型不会自发想到"派一个看不到本次对话历史的自己去复审"。
 *  ⛔ 必须写成**条件式**（与 BROWSER_INSTRUCTIONS 同一纪律）：调度是**会话级**开关，而这里是
 *     全局指令 —— 直接命令"用 agent_invoke"会让没开调度的会话去调不存在的工具，把「没开」
 *     误判成「坏了」。所以先让模型看自己的工具表。
 *  对应的执行者是随应用种入的内置子智能体（electron/builtin-agents.ts，id=fresh-review）。 */
const REVIEW_INSTRUCTIONS =
  "\n6) fresh-context review — when you are about to hand over a non-trivial result (a code change, a plan, a document), prefer having it reviewed by a NEW session that cannot see this conversation.\n   IF `agent_invoke` is in your tool list (scheduling is on for this session): dispatch the built-in subagent named \"评审（新鲜上下文）\" with kind=subagent. It judges only the material you hand it — which is the point: your own review is contaminated by the detour you just took.\n   How to write the query (the reviewer sees NOTHING else, so it must be self-contained): (a) what the material is and where it lives — file paths, or the full text if short; (b) what the goal was; (c) what you are unsure about. Do NOT paste this conversation, and do NOT narrate your reasoning.\n   IF `agent_invoke` is NOT in your tool list: scheduling is off for this session — do not try to work around it; review the material yourself and say explicitly that it was a self-review.\n   Skip this entirely for trivial edits, or when the user asked for speed.";

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
  // 复审指引无条件下发（内容自带条件式判断：先看 agent_invoke 在不在工具表里）
  text += REVIEW_INSTRUCTIONS;
  // 深层联动软约束：自动化能力被关闭时，在基础指令里明确告诉模型不要调用这些工具。
  // 09-20：MCP 工具（`desktop_*` / `browser_*`）现在会被 disabled_tools **硬移除**，所以这里
  // 重点变成「别用命令行兜底绕过总闸」—— nuphus-call / playwright-cli 仍在 PATH 上，
  // 那是提示词管得住、配置管不到的一层。
  if (!desktop || !browser) {
    const notes: string[] = [];
    if (!desktop) notes.push("桌面自动化：`desktop_*` MCP 工具已被硬移除，且不得用 `nuphus-call` 从命令行绕过");
    if (!browser) notes.push("浏览器自动化：`browser_*` MCP 工具已被硬移除，且不得用 `playwright-cli` / `cloakbrowser` 绕过");
    text += `\n\nAUTOMATION DISABLED NOTE: 以下能力已在应用设置中关闭，当前任务禁止使用：${notes.join("；")}。即使其他技能或插件提到这些工具，也不要调用它们。`;
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
