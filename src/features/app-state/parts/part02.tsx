/**
 * usePart02 —— **组合根**（09-22：原 2,139 行 / 690 条体内语句按序切成 parts/part02/ 4 个子 hook）。
 * ⛔ 顺序即契约：子 hook 内含 hook 调用，调用顺序 == 原体语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ 子模块各自 `return` 自己的绑定，这里展开合并；`bag` 只是跨 part 的旁路，不是段间通道。
 */
import { usePart02a } from "./part02/01-mcp-teams-plan";
import { usePart02b } from "./part02/02-goal-browser-notice";
import { usePart02c } from "./part02/03-thread-switch-update";
import { usePart02d } from "./part02/04-runtime-commands-account";
import type { Bag } from "./bag-types";

export function usePart02(bag: Bag) {
  const a = usePart02a(bag);
  const b = usePart02b(bag);
  const c = usePart02c(bag);
  const d = usePart02d(bag);

  return { ...a, ...b, ...c, ...d };
}
