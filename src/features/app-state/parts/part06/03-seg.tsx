/**
 * usePart06c —— **组合根**（09-22：原 488 行 / 体内 52 条语句按序切成 2 段）。
 * 域：权限/沙箱/力度/人格 · 复制与引用 · 编辑重发 — 图片/上下文/技能引用 · 分叉 · 备份导入导出 · 新会话
 * ⛔ 顺序即契约：子段内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ bag 只是跨 part 的旁路，不是段间通道（段间走 `return` + 入参）。
 */
import { usePart06c1 } from "./03-seg/01-permission-effort-copy";
import { usePart06c2 } from "./03-seg/02-context-fork-backup";
import type { Bag } from "../bag-types";

import "@xterm/xterm/css/xterm.css";

export function usePart06c(bag: Bag) {
  const a = usePart06c1(bag);
  const b = usePart06c2(bag);

  return { ...a, ...b };
}
