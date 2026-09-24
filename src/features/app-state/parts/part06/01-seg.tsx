/**
 * usePart06a —— **组合根**（09-22：原 442 行 / 体内 92 条语句按序切成 2 段）。
 * 域：设置内容就绪/搜索防抖/流时间戳/基调 — 运行态与派发 · 委托记录 · 角色
 * ⛔ 顺序即契约：子段内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ bag 只是跨 part 的旁路，不是段间通道（段间走 `return` + 入参）。
 */
import { usePart06a1 } from "./01-seg/01-ui-ready-mood-refs";
import { usePart06a2 } from "./01-seg/02-runtime-dispatch-roles";
import type { Bag } from "../bag-types";

import "@xterm/xterm/css/xterm.css";

export function usePart06a(bag: Bag) {
  const a = usePart06a1(bag);
  const b = usePart06a2(bag);

  return { ...a, ...b };
}
