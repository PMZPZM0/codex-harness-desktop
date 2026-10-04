/**
 * 自动化能力策略：**两个总闸 → nuphus 工具掩码**的唯一来源。
 *
 * 背景（09-20 扫出的短板）：
 *  ① 注册条件原先只有 `desktopAuto`（nuphus 是同一个 MCP 服务器，桌面 + 浏览器共用一个进程）
 *     ⇒ 关掉桌面自动化会把 `browser_*` 一起带走：「只给浏览器自动化、不给真实键鼠控制」**做不到** ——
 *     这是一个安全边界缺陷（用户无法在保留浏览器能力的同时，拒绝 agent 碰他的鼠标键盘）。
 *  ② 反过来，`browserAuto=false` 时 `browser_*` **仍然全量注册**，只是 developer_instructions 叫模型别用
 *     ⇒ 浏览器总闸只是**提示词级**控制，不是硬控制（模型可以视而不见）。
 *
 * 现在：注册条件放宽为「两个总闸任一开启」，然后按开关用 `disabled_tools` 把**关闭的那一组整体摘掉**
 * （`disabled_tools` 会让工具从引擎工具表消失 ⇒ 真阻断，机制已实证）。
 *
 * ⛔ 两个不变量，改这里时必须同时满足：
 *  1. **UI 与配置同源**：`mcp-servers:permissions` 的返回值也要过 `effectiveToolPermissions`，
 *     否则出现「界面显示未设权限、配置里却被禁用」（本项目修过的同类 bug：显示侧与保存侧必须同源）。
 *  2. **掩码是 deny（硬）**，优先于用户显式规则 —— 总闸关着时，用户把某个工具设成 allow 也不生效。
 */

/** nuphus 0.2.3 的桌面组工具（15 个，实测枚举，非文档推测）。 */
export const NUPHUS_DESKTOP_TOOLS: readonly string[] = [
  "desktop_screen_size",
  "desktop_screenshot",
  "desktop_windows_list",
  "desktop_window_activate",
  "desktop_window_screenshot",
  "desktop_window_move",
  "desktop_window_resize",
  "desktop_window_info",
  "desktop_vision",
  "desktop_perceive",
  "desktop_mouse",
  "desktop_mouse_drag",
  "desktop_input",
  "desktop_clipboard_clean",
  "desktop_clipboard_write",
];

/** nuphus 0.2.3 的浏览器组工具（23 个，实测枚举）。 */
export const NUPHUS_BROWSER_TOOLS: readonly string[] = [
  "browser_navigate",
  "browser_snapshot",
  "browser_exec",
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_scroll",
  "browser_extract",
  "browser_screenshot",
  "browser_close",
  "browser_evaluate",
  "browser_back",
  "browser_forward",
  "browser_wait_for",
  "browser_cookies_get",
  "browser_cookies_set",
  "browser_import_cookies",
  "browser_upload",
  "browser_drag_files",
  "browser_list_downloads",
  "browser_new_tab",
  "browser_list_tabs",
  "browser_switch_tab",
];

/** nuphus 注册用的服务器名（与 config.toml 的 `[mcp_servers.nuphus]` 一致）。 */
export const NUPHUS_MCP_SERVER = "nuphus";

/** 两个总闸的当前状态。 */
export type AutomationSwitches = { desktop: boolean; browser: boolean };

/**
 * 该被**硬禁用**的 nuphus 工具：关闭的那一组整体摘掉。
 * 返回空数组表示不需要掩码（两个都开着）。
 */
export function nuphusDisabledTools(switches: AutomationSwitches): string[] {
  const disabled: string[] = [];
  if (!switches.desktop) disabled.push(...NUPHUS_DESKTOP_TOOLS);
  if (!switches.browser) disabled.push(...NUPHUS_BROWSER_TOOLS);
  return disabled;
}

/**
 * nuphus 是否应当被注册：
 * **两个总闸任一开启**即可（原先只看桌面，导致浏览器能力被桌面开关绑架）。
 * 两个都关时才整段不写 —— 此时 `browser_*`/`desktop_*` 一个都不该暴露。
 */
export function shouldRegisterNuphus(switches: AutomationSwitches): boolean {
  return switches.desktop || switches.browser;
}

/**
 * Windows 原生控件清单通道（`resources/tools/harness-uia.mjs` + `desktop-uia.ps1`）。
 *
 * 为什么要它：nuphus 的定位是「截屏 → 本地 OCR → 像素坐标」，坐标在窗口挪动 / DPI 缩放 /
 * 自绘界面上会失手；Windows 自己有一份控件清单（UI Automation），拿到就能按序号操作。
 * 为什么是**另一个 MCP 服务器**而不是往 nuphus 里加：nuphus 是第三方预编译二进制，我们改不了它的工具面。
 *
 * ⛔ 注册判据 = win32 + 桌面总闸开启 + 随包脚本齐备。**关掉就是不写这一段**（工具从引擎表里
 *    干净消失），不复用 nuphus 的 `disabled_tools` 掩码 —— 那套掩码是为「同一服务器混装
 *    desktop_* 与 browser_*」准备的（见上方 09-20 说明），这里没那个约束，别拿过来用。
 */
export const HARNESS_UIA_MCP_SERVER = "harness-uia";

/** harness-uia 的四个工具（与 `harness-uia.mjs` 里的 TOOLS 名单同源；守卫【273】逐字比对）。 */
export const HARNESS_UIA_TOOLS: readonly string[] = [
  "desktop_ui_windows",
  "desktop_ui_snapshot",
  "desktop_ui_invoke",
  "desktop_ui_set_value",
];

/** UIA 是 Windows 专属能力（macOS 的对应物是 Accessibility，属另一个后端）。 */
export function uiaDesktopSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32";
}

/** 注册判据（binaryReady 由 `toolchain.harnessUiaServer()` 给：两个随包文件都在才算齐）。 */
export function shouldRegisterUia(input: { desktop: boolean; binaryReady: boolean; platform?: NodeJS.Platform }): boolean {
  return uiaDesktopSupported(input.platform) && input.desktop === true && input.binaryReady === true;
}

/**
 * 工具在「总闸 + 用户显式规则」下的**最终档位** —— UI 与 config.toml 必须都走这里。
 * 掩码（总闸关掉的组）恒为 `deny`，压过用户的 allow/ask。
 */
export function effectiveNuphusPermission(
  tool: string,
  explicit: "deny" | "ask" | "allow" | undefined,
  switches: AutomationSwitches,
): "deny" | "ask" | "allow" | undefined {
  if (nuphusDisabledTools(switches).includes(tool)) return "deny";
  return explicit;
}

/** 把掩码写进「服务器名 → 工具 → 档位」的视图（UI 用），保留其它服务器的原样。 */
export function withNuphusMasks<T extends Record<string, Record<string, "deny" | "ask" | "allow">>>(
  byServer: T,
  switches: AutomationSwitches,
  allNuphusTools: readonly string[] = [...NUPHUS_DESKTOP_TOOLS, ...NUPHUS_BROWSER_TOOLS],
): Record<string, Record<string, "deny" | "ask" | "allow">> {
  const masked = nuphusDisabledTools(switches);
  if (!masked.length) return byServer;
  const current = { ...(byServer[NUPHUS_MCP_SERVER] ?? {}) };
  for (const tool of masked) {
    // 只对真实存在的工具写掩码（allNuphusTools 做白名单，避免脏数据进 UI/config）
    if (allNuphusTools.includes(tool)) current[tool] = "deny";
  }
  return { ...byServer, [NUPHUS_MCP_SERVER]: current };
}

/**
 * 把掩码并进 **config.toml 用的**规则表（`{deny,ask,allow}` 三段式，交给 injectMcpToolRules）。
 * ⛔ 被掩码的工具必须**同时从 ask/allow 里摘掉**：否则会写出「同一个工具既进 disabled_tools、
 *    又带 `[mcp_servers.nuphus.tools.X] approval_mode`」的自相矛盾配置 —— 引擎侧行为未定义。
 */
export function withNuphusMasksForRules<T extends Record<string, { deny: string[]; ask: string[]; allow: string[] }>>(
  rules: T,
  switches: AutomationSwitches,
): T {
  const masked = nuphusDisabledTools(switches);
  if (!masked.length) return rules;
  const current = rules[NUPHUS_MCP_SERVER] ?? { deny: [], ask: [], allow: [] };
  const deny = [...new Set([...current.deny, ...masked])];
  const keep = (list: string[]) => list.filter((tool) => !masked.includes(tool));
  return { ...rules, [NUPHUS_MCP_SERVER]: { deny, ask: keep(current.ask), allow: keep(current.allow) } } as T;
}
