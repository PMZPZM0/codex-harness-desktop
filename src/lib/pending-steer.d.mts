export function subscribePendingSteers(listener: () => void): () => boolean;
export function armPendingSteer(payload: { threadId?: string; id?: string; entry?: any }): boolean;
export function cancelPendingSteer(threadId: string, id: string): boolean;
export function isPendingSteer(threadId: string, id: string): boolean;
/** 仍可撤回（armed）的条目 id */
export function pendingSteerIds(threadId: string): string[];
/** 界面上已作为用户气泡现身的条目 id（armed + sending）⇒ 排队面板要隐藏这些 */
export function pendingSteerVisibleIds(threadId: string): string[];
export function pendingSteerEntries(threadId: string): any[];
/** 订阅版：排队面板要隐藏的 id 名单（armed + sending） */
export function usePendingSteerVisibleIds(threadId: string): string[];
export function hasPendingSteers(threadId: string): boolean;
/** armed 最久那条已等待的毫秒数（无 armed = 0）—— 派发硬兜底用 */
export function pendingSteerArmedAge(threadId: string): number;
export function takePendingSteers(threadId: string): any[];
export function settlePendingSteers(threadId: string, ids: string[]): void;
export function usePendingSteerEntries(threadId: string): any[];
/** useSyncExternalStore 的 getSnapshot：签名未变必须交还**同一引用** */
export function pendingSteerSnapshot(threadId: string): any[];
export function turnStepBusy(turn: any): boolean;
