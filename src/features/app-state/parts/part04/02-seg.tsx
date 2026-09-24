/**
 * usePart04b —— **组合根**（09-22：原 435 行 / 体内 44 条语句按序切成 2 段）。
 * 域：钩子事件回填/底部状态/resizeObserver — 聊天搜索与其历史
 * ⛔ 顺序即契约：子段内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ bag 只是跨 part 的旁路，不是段间通道（段间走 `return` + 入参）。
 */
import { usePart04b1 } from "./02-seg/01-hook-events-bottom-state";
import { usePart04b2 } from "./02-seg/02-chat-search-history";
import type { Bag } from "../bag-types";

import "@xterm/xterm/css/xterm.css";

export function usePart04b(bag: Bag) {
  const a = usePart04b1(bag);
  const b = usePart04b2(bag);

  return { ...a, ...b };
}
