/** 刷新回执纯函数（`src/lib/refresh-receipt.mjs`）的类型声明。
 *  ⛔ 与 .mjs 同目录同基名：声明文件不参与打包，但 TS 编译需要它，
 *    否则 `import { refreshWithReceipt } from "../../lib/refresh-receipt.mjs"` 会退化成 any。 */

/** 回执三态：`正在{label}…` ⇒ `{label}完成` / `{label}失败：{原因}`。 */
export declare function refreshWithReceipt(
  notice: ((text: string) => void) | null | undefined,
  label: string,
  run: () => unknown,
): Promise<boolean>;
