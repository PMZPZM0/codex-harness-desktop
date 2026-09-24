/**
 * usePart04c —— **组合根**（09-22：原 726 行 / 体内 70 条语句按序切成 2 段）。
 * 域：聊天搜索/文件树 · 内置浏览器/书签 · 队列调度 · 设置资源
 * ⛔ 顺序即契约：子段内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ bag 只是跨 part 的旁路，不是段间通道（段间走 `return` + 入参）。
 */
import { usePart04c1 } from "./03-seg/01-chat-search-file-tree";
import { usePart04c2 } from "./03-seg/02-browser-queue-settings";
import type { Bag } from "../bag-types";

export function usePart04c(bag: Bag) {
  const a = usePart04c1(bag);
  const b = usePart04c2(bag);

  return { ...a, ...b };
}
