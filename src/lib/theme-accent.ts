/**
 * 主题色（强调色）定制 —— 白天 / 黑夜 各 5 套（11-09 用户令：「主题色现在太少了，白天和黑夜定制都定制各 5 套」）。
 *
 * ⛔ 配色本体在 CSS（01-base-and-chrome.css 的 `:root[data-theme-mode][data-accent]` 块），
 *    这里只管「有哪些档位 / 存哪个 / 把 data-accent 挂上」，与 themes.ts 同一分工。
 * ⛔ `default` 档不写 CSS 块 ⇒ 落到主题本身的 --accent（白天蓝 / 黑夜蓝 / 曜石金），即"恢复默认"。
 * ⛔ 选择按模式各存一份（localStorage `accent-light` / `accent-dark`）：白天选玫瑰、黑夜选紫罗兰，
 *    切换明暗时各用各的，互不覆盖。
 */
export type AccentMode = "light" | "dark";

export interface AccentPreset {
  id: string;
  label: string;
  /** 预览圆点色（仅 UI 展示；真实生效值在 CSS） */
  swatch: string;
}

export const ACCENT_PRESETS: Record<AccentMode, readonly AccentPreset[]> = {
  light: [
    { id: "default", label: "默认蓝", swatch: "#2f6bdd" },
    { id: "rose", label: "玫瑰", swatch: "#d5487a" },
    { id: "green", label: "松绿", swatch: "#1a7f37" },
    { id: "violet", label: "紫罗兰", swatch: "#7c4dcc" },
    { id: "amber", label: "琥珀", swatch: "#b45309" },
  ],
  dark: [
    { id: "default", label: "默认蓝", swatch: "#7cabf8" },
    { id: "rose", label: "玫瑰", swatch: "#f08bab" },
    { id: "green", label: "松绿", swatch: "#4ec27a" },
    { id: "violet", label: "紫罗兰", swatch: "#a78bfa" },
    { id: "amber", label: "琥珀", swatch: "#f0a35c" },
  ],
};

/** 归一档位 id：脏值/越界一律回 default（⛔ 别让 localStorage 脏值把 data-accent 落到无 CSS 块的值）。 */
export function normalizeAccentId(mode: AccentMode, value: unknown): string {
  const list = ACCENT_PRESETS[mode] ?? ACCENT_PRESETS.light;
  return list.some((p) => p.id === value) ? String(value) : "default";
}

/** 读某模式已存的主题色档位（隐私模式/无存储回 default）。 */
export function readThemeAccent(mode: AccentMode): string {
  try { return normalizeAccentId(mode, localStorage.getItem(`accent-${mode}`)); } catch { return "default"; }
}

/** 把当前模式的档位挂到 <html data-accent>（CSS 块据此换 --accent/--link/--accent-soft）。 */
export function applyThemeAccent(mode: AccentMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.accent = readThemeAccent(mode);
}

/** 选档：存盘 + 若正是当前模式立即生效。返回落盘后的 id。 */
export function setThemeAccent(mode: AccentMode, id: string): string {
  const next = normalizeAccentId(mode, id);
  try { localStorage.setItem(`accent-${mode}`, next); } catch { /* 隐私模式只影响下次 */ }
  if (typeof document !== "undefined" && document.documentElement.dataset.themeMode === mode) {
    document.documentElement.dataset.accent = next;
  }
  return next;
}
