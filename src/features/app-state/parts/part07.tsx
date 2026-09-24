/**
 * usePart07 —— **组合根**（09-22：原 1,290 行 / 124 条体内语句按序切成 parts/part07/ 3 个子 hook）。
 * ⛔ 顺序即契约：子 hook 内含 hook 调用，调用顺序 == 原体语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ 段间**零入参**：子 hook 只收 `bag`（同一次渲染内要用别段/别 part 的值一律走 bag），不传 return 对象。
 * ⛔ 子模块各自 `return` 自己的绑定，这里展开合并；`bag` 只是跨 part 的旁路，不是段间通道。
 */
import { usePart07a } from "./part07/01-seg";
import { usePart07b } from "./part07/02-seg";
import { usePart07c } from "./part07/03-seg";
import type { Bag } from "./bag-types";

export function usePart07(bag: Bag) {
  const a = usePart07a(bag);
  const b = usePart07b(bag);
  const c = usePart07c(bag);

  return { ...a, ...b, ...c };
}
