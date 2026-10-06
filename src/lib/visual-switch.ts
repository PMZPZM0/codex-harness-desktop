/**
 * 主题 / 代码高亮切换的「过渡 + 完成提示」（10-07 用户要求）
 *
 * 需求原文：「主题切换（如明暗模式）和代码高亮切换目前缺少过渡动画和切换完成后的通知提示，
 *           请为它们补上平滑的过渡效果与即时反馈」。
 *
 * ⛔⛔ 为什么做成「临时挂类」而不是常驻 transition：
 *   主题切换要过渡的是**全站颜色**（背景/文字/边框/图标），常驻 `* { transition: … }` 会把
 *   所有 hover/点击反馈一起拖慢，且大面积重绘影响滚动性能。
 *   ⇒ 只在切换的 ~240ms 内给 `<html>` 挂 `fx-theme`（CSS 里那条规则才生效），切完摘掉。
 *
 * ⛔⛔ 为什么提示放在**切换动画结束之后**（而不是点击瞬间）：
 *   用户的口径是"切换完成后的通知提示" —— 先给"已经变了"再给"变成什么"，顺序才对得上；
 *   瞬间同时发会让人分不清提示说的是切换前还是切换后。
 *
 * ⛔ 无障碍：动效时长由 CSS 变量 `--dur-theme` 控制，且 `prefers-reduced-motion: reduce`
 *   下被既有的全局兜底（`02-sidebar-threads.css` 末尾那条）压到 0.001ms；
 *   这里的 JS 只是**按时摘类**，不参与"要不要动"的判断 —— 动静归 CSS，时序归 JS。
 *
 * 拓展接口：新增一类"全站颜色切换"（比如将来加主题色/强调色）⇒ 只调 `runVisualSwitch()`，
 *   传自己的 `kind` 与 `label` 即可，不用再复制一份挂类/摘类/发提示的代码。
 */
import { THEMES, normalizeThemeId } from "./themes";
import { codeThemes } from "./code-themes";

/** 过渡类名（CSS 里 `html.fx-theme` 那条规则靠它生效）。⛔ 改名必须同步 CSS 与守卫【11w】。 */
export const VISUAL_FX_CLASS = "fx-theme";
/** 过渡时长（ms）—— 必须与 CSS 的 `--dur-theme` **同源**：这里只是 JS 侧摘类的时点。 */
export const VISUAL_FX_MS = 240;

/** 界面主题的显示名（取不到就用 id，别返回空串 —— 提示里会出现「已切换到「」」）。 */
export function themeLabelOf(id: string): string {
  const hit = THEMES.find((entry) => entry.id === normalizeThemeId(id));
  return hit?.label ?? id;
}

/** 代码高亮主题的显示名 */
export function codeThemeLabelOf(id: string): string {
  return codeThemes.find((entry) => entry.id === id)?.label ?? id;
}

let timer = 0;

/**
 * 执行一次「全站颜色切换」：挂过渡 → 应用 → 动画结束后摘过渡并给回执。
 *
 * @param kind  提示里的类别词（"主题" / "代码高亮"），决定文案措辞
 * @param label 切换后的显示名
 * @param apply 真正改状态的那一步（⚠️ 必须**同步可观测**：不要在这里塞异步持久化，
 *              否则过渡已经结束、颜色还没变，看起来就是"提示说切了但没切"）
 * @param onNotice 回执通道（设置页传 `setNotice`，侧栏传 `showToast`；缺省 = 静默，不报错）
 */
export function runVisualSwitch(
  kind: "主题" | "代码高亮",
  label: string,
  apply: () => void,
  onNotice?: (text: string) => void,
): void {
  const root = document.documentElement;
  root.classList.add(VISUAL_FX_CLASS);
  apply();
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    root.classList.remove(VISUAL_FX_CLASS);
    onNotice?.(kind === "主题" ? `已切换到「${label}」主题` : `代码高亮已切换到「${label}」`);
  }, VISUAL_FX_MS);
}
