/**
 * usePart02c —— **组合根**（09-22：原 421 行 / 体内 185 条语句按序切成 2 段）。
 * 域：会话切换与戳记 · 系统事件 · 欢迎目录 — 更新检查 · UI 语言与缩放 · 设置页
 * ⛔ 顺序即契约：子段内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ bag 只是跨 part 的旁路，不是段间通道（段间走 `return` + 入参）。
 */
import { usePart02c1 } from "./03-thread-switch-update/01-thread-switch-system-events";
import { usePart02c2 } from "./03-thread-switch-update/02-update-ui-settings";
import type { Bag } from "../bag-types";

import "@xterm/xterm/css/xterm.css";

export function usePart02c(bag: Bag) {
  const a = usePart02c1(bag);
  const b = usePart02c2(bag);

  return { ...a, ...b };
}
