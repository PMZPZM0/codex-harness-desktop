/**
 * usePart02d —— **组合根**（09-22：原 507 行 / 体内 159 条语句按序切成 2 段）。
 * 域：开发运行时与能力快照 · 命令/钩子/项目账户
 * ⛔ 顺序即契约：子段内含 hook 调用，调用顺序 == 原语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ bag 只是跨 part 的旁路，不是段间通道（段间走 `return` + 入参）。
 */
import { usePart02d1 } from "./04-runtime-commands-account/01-dev-runtimes-capability";
import { usePart02d2 } from "./04-runtime-commands-account/02-commands-hooks-account";
import type { Bag } from "../bag-types";

export function usePart02d(bag: Bag) {
  const a = usePart02d1(bag);
  const b = usePart02d2(bag);

  return { ...a, ...b };
}
