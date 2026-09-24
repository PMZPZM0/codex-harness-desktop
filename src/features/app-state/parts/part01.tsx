/**
 * usePart01 —— **组合根**（09-22：原 1,995 行 / 630 条体内语句按序切成 parts/part01/ 6 个子 hook）。
 * ⛔ 顺序即契约：子 hook 内含 hook 调用，调用顺序 == 原体语句顺序 ⇒ 只能按文件名前缀顺序 import / 调用 / 展开。
 * ⛔ 子模块各自 `return` 自己的绑定，这里展开合并；`bag` 是**跨 part** 的旁路（惰性属性读写 ⇒ 读到的是最新值），不是段间通道。
 * ⛔ 段间**零入参**：体内每条语句只引用自己的局部声明与 bag（前向引用 0 / 非镜像跨语句裸引用 0，切分时逐条断言过）。
 */
import { usePart01a } from "./part01/01-session-drafts-voice";
import { usePart01b } from "./part01/02-composer-attachments-marketplace";
import { usePart01c } from "./part01/03-accounts-connectors-rate-limit";
import { usePart01d } from "./part01/04-optimistic-turn-approval-e2e";
import { usePart01e } from "./part01/05-engine-ssh-connectors";
import { usePart01f } from "./part01/06-goals-palette-commands";
import type { Bag } from "./bag-types";

export function usePart01(bag: Bag) {
  const a = usePart01a(bag);
  const b = usePart01b(bag);
  const c = usePart01c(bag);
  const d = usePart01d(bag);
  const e = usePart01e(bag);
  const f = usePart01f(bag);

  return { ...a, ...b, ...c, ...d, ...e, ...f };
}
