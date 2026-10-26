import type { GroupEventBlock } from "./group-event-text";

/** 这条块是否属于「用户要求不再展示」的通知（预算 80%/用尽、停滞看门狗、待审看门狗）。 */
export declare function isHiddenNoticeBlock(block: GroupEventBlock): boolean;

/** 群事件文本 → 实际会渲染的块；非群事件返回 null。空数组 = 一条都不展示。 */
export declare function visibleGroupBlocks(text: string): GroupEventBlock[] | null;
