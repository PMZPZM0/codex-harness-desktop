/**
 * usePart08 —— **组合根**（09-22：原 1,696 行 / 54 条体内语句按序切成 parts/part08/ 3 个子 hook）。
 * ⛔ 顺序即契约：子 hook 内含 hook 调用，调用顺序 == 原体语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ 段间**零入参**：子 hook 只收 `bag`（同一次渲染内要用别段/别 part 的值一律走 bag），不传 return 对象。
 * ⛔ 子模块各自 `return` 自己的绑定，这里展开合并；`bag` 只是跨 part 的旁路，不是段间通道。
 */
import { usePart08a } from "./part08/01-seg";
import { usePart08b } from "./part08/02-seg";
import { usePart08c } from "./part08/03-seg";
import type { Bag } from "./bag-types";

export function usePart08(bag: Bag) {
  const a = usePart08a(bag);
  const b = usePart08b(bag);
  const c = usePart08c(bag);

  return { ...a, ...b, ...c };
}
