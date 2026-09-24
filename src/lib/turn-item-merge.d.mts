/** turn-item-merge.mjs 的类型声明 */
import type { Turn } from "./turn";
import type { ThreadItem } from "./thread-item";

export function adoptUnknownTurn(turns: { id: string }[], turnId: string, item: ThreadItem | null | undefined): Turn | null;
