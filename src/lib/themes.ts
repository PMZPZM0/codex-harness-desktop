/**
 * 主题注册表 —— 界面主题的**唯一清单**（09-24，参照 WorkBuddy 的"集中注册 + 注册表驱动 UI"）。
 *
 * 为什么需要：此前 light/dark 以字面量散在设置页 JSX、bag 类型与 CSS 里，
 * 新增第三主题要改 4+ 处；现在 UI 由这份表渲染，新增主题 = 这里加一行 + styles 里加一段
 * `:root[data-theme="<id>"]` 变量块（照抄 dark 块改色值），其余零改动。
 *
 * ⛔ 配色本体不在这里 —— CSS 变量才是配色真相源（styles/01-base-and-chrome.css），
 *    这张表只管「有哪些主题、叫什么、预览卡怎么画」。
 * ⛔ id 同时是 `document.documentElement.dataset.theme` 的值与 localStorage "theme" 的值，
 *    主进程 `theme:apply`（main.ts）用它判暗色 —— 新主题若不是"暗色系"，记得同步那边。
 */
export type ThemeId = string;

export interface ThemeDef {
  /** 存进 localStorage / data-theme 的标识（CSS 选择器用它） */
  id: ThemeId;
  /** 设置页显示名 */
  label: string;
  /** 预览卡的配色 class（styles 里已定义 tpw-light / tpw-dark） */
  preview: string;
}

export const THEMES: readonly ThemeDef[] = [
  { id: "light", label: "白天", preview: "tpw-light" },
  { id: "dark", label: "黑夜", preview: "tpw-dark" },
] as const;

/** 兜底：未知 id（旧 localStorage 脏值）回退到 light，避免 data-theme 落到无变量块的值。 */
export function normalizeThemeId(value: unknown): ThemeId {
  return THEMES.some((t) => t.id === value) ? (value as ThemeId) : "light";
}
