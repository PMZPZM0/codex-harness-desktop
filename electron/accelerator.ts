/**
 * 快捷键（accelerator）净化与展示 —— 主进程侧。
 *
 * 为什么独立成模块：截图（两种模式）与语音（通话/听写）是**两条独立的注册链**，
 * 但「用户按了什么键 → 存成什么字符串」的规则必须完全一致，否则同一组键在两处
 * 表现为「能用/不能用」。渲染层的录入控件（VoiceSettingsSection）与此处的规则一一对应：
 *   ⌘ 在 mac 记 `Command`、Windows 记 `Super`；Ctrl → `Ctrl`；至少一个修饰键；
 *   主键只收 字母 / 数字 / F1–F12 / Space / Enter / Tab / Esc / 方向键。
 */

export const MODIFIER_ORDER = ["CommandOrControl", "Command", "Ctrl", "Alt", "Shift", "Super"] as const;

const KEY_ALLOWED = /^(F([1-9]|1[0-2])|[A-Z0-9]|Space|Enter|Tab|Esc|Escape|Up|Down|Left|Right)$/i;

/**
 * 把任意用户输入 / 脏配置归一成合法 accelerator；不合法则返回 fallback。
 * ⛔ 必须至少一个修饰键：单键全局快捷键会吞掉正常输入（全系统打不出那个字母）。
 */
export function sanitizeAccelerator(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const parts = raw.split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return fallback;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map((m) => {
    const lower = m.toLowerCase();
    if (lower === "ctrl" || lower === "control") return "Ctrl";
    if (lower === "cmdorctrl" || lower === "commandorcontrol") return "CommandOrControl";
    if (lower === "cmd" || lower === "command" || lower === "meta") return "Command";
    if (lower === "alt" || lower === "option") return "Alt";
    if (lower === "shift") return "Shift";
    if (lower === "super" || lower === "win") return "Super";
    return "";
  }).filter(Boolean);
  if (!mods.length) return fallback;
  let cleanKey = key;
  if (key.length === 1) cleanKey = key.toUpperCase();
  else if (/^escape$/i.test(key)) cleanKey = "Esc";
  else cleanKey = key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
  if (!KEY_ALLOWED.test(cleanKey)) return fallback;
  const ordered = [...new Set(mods)].sort((a, b) => MODIFIER_ORDER.indexOf(a as any) - MODIFIER_ORDER.indexOf(b as any));
  return [...ordered, cleanKey].join("+");
}

/** 人话展示：mac 下把 CommandOrControl/Command 显示成 ⌘、Shift 成 ⇧ …（设置页与提示文案共用）。 */
export function acceleratorLabel(accelerator: string, isMac: boolean): string {
  const parts = String(accelerator ?? "").split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return "";
  if (!isMac) {
    return parts.map((p) => (p === "CommandOrControl" ? "Ctrl" : p === "Command" ? "Win" : p === "Super" ? "Win" : p)).join("+");
  }
  const symbols: Record<string, string> = { CommandOrControl: "⌘", Command: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Super: "⌘" };
  const mods = parts.slice(0, -1).map((p) => symbols[p] ?? p);
  const key = parts[parts.length - 1];
  return [...mods, /^Esc$/.test(key) ? "esc" : key].join("");
}
