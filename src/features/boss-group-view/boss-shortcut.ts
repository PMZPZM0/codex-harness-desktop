/**
 * BOSS 会话快捷键（**单一真相源**，10-25 立）。
 *
 * ⛔ 为什么单独放一个文件：键位同时出现在三处 ——
 *   ① 侧栏「BOSS 会话」按钮行尾的 kbd 徽标；
 *   ② BOSS 欢迎界面里的快捷键提示；
 *   ③ 设置里的快捷键清单。
 *   三处各写一份字面量 ⇒ 改键位必漏一处（历史教训：普通会话的 Ctrl+N 就是这么散在三处的）。
 *   ⇒ 这里收成一份，其余地方一律 import 本文件。
 *
 * 键位选择（10-25 用户实测后定的）：
 *   · Win/Linux = **Ctrl+M**
 *   · mac = **Cmd+Shift+B**（mac 的 Cmd+M 是系统「最小化窗口」，抢它会跟系统行为打架）
 *   ⇒ 展示层再走 hk() 把 Ctrl/Cmd 转成平台符号（⌘⇧B）。
 */
import { hk } from "../../lib/hk";
import { isMacPlatform } from "../../lib/is-mac-platform";

/** 平台相关的原始键位标签（展示前请走 hk()）。 */
export const BOSS_SHORTCUT_LABEL = isMacPlatform() ? "Ctrl+Shift+B" : "Ctrl+M";

/** 展示用：mac 上把 Ctrl+ 显示成 ⌘、Shift+ 显示成 ⇧。 */
export function bossShortcutLabel(): string {
  return hk(BOSS_SHORTCUT_LABEL);
}
