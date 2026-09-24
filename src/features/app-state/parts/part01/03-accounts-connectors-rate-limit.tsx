/**
 * usePart01c —— **组合根**（09-22：原 564 行 / 体内 130 条语句按序切成 2 段）。
 * 域：账号与连接器与技能 · 限流重试与中断/乐观输入
 * ⛔ 顺序即契约：子段内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ bag 只是跨 part 的旁路，不是段间通道（段间走 `return` + 入参）。
 */
import { usePart01c1 } from "./03-accounts-connectors-rate-limit/01-accounts-connectors-skills";
import { usePart01c2 } from "./03-accounts-connectors-rate-limit/02-rate-limit-retry-optimistic";
import type { Bag } from "../bag-types";

export function usePart01c(bag: Bag) {
  const a = usePart01c1(bag);
  const b = usePart01c2(bag);

  return { ...a, ...b };
}
