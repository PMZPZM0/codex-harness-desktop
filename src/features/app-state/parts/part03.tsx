/**
 * usePart03 —— **组合根**（09-22：原 1,914 行 / 410 条体内语句按序切成 parts/part03/ 4 个子 hook）。
 * ⛔ 顺序即契约：子 hook 内含 hook 调用，调用顺序 == 原体语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ 子模块各自 `return` 自己的绑定，这里展开合并；`bag` 只是跨 part 的旁路，不是段间通道。
 * ⛔⚠️ **全仓唯一的段间入参例外就在本 part**：`usePart03c(bag, b)` 多收 b 段的 return 对象，只为取
 *    `providerModels`（旧文件里它声明在 c 段语句区之前、被 c 段 useMemo 读到；拆开后 b 段局部变量对
 *    c 段不可见）。该值来自**同一次渲染**内 b 段刚算出的 state ⇒ 与旧写法等价、行为不变；但「段间零入参」
 *    在本 part 不成立，保真分析的预期即含这 1 条插入语句（其余 409 条逐字一致、0 删除）。
 */
import { usePart03a } from "./part03/01-remote-bot-pin";
import { usePart03b } from "./part03/02-composer-memory-models";
import { usePart03c } from "./part03/03-restart-file-model-editor";
import { usePart03d } from "./part03/04-project-groups-cwd-names";
import type { Bag } from "./bag-types";

export function usePart03(bag: Bag) {
  const a = usePart03a(bag);
  const b = usePart03b(bag);
  const c = usePart03c(bag, b);
  const d = usePart03d(bag);

  return { ...a, ...b, ...c, ...d };
}
