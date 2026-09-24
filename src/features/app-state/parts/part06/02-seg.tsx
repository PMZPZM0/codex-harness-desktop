/**
 * usePart06b —— **组合根**（09-22：原 711 行 / 体内 59 条语句按序切成 2 段）。
 * 域：回合运行态与运行时同步 · 模型选择与线程设置权限
 * ⛔ 顺序即契约：子段内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ bag 只是跨 part 的旁路，不是段间通道（段间走 `return` + 入参）。
 */
import { usePart06b1 } from "./02-seg/01-turn-runtime-activity";
import { usePart06b2 } from "./02-seg/02-model-thread-settings";
import type { Bag } from "../bag-types";

export function usePart06b(bag: Bag) {
  const a = usePart06b1(bag);
  const b = usePart06b2(bag);

  return { ...a, ...b };
}
