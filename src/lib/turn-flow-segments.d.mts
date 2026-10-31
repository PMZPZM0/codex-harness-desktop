/** src/lib/turn-flow-segments.mjs 的类型声明（.mjs 无声明会让 tsc 报 TS7016，守卫【87】也要求配套）。 */

export type FlowSegment = { user: any; items: any[] };

export function splitFlowSegments(
  items: ReadonlyArray<{ type?: string; [key: string]: unknown }> | null | undefined,
  opts?: {
    isCompaction?: (item: any) => boolean;
    isGroupEvent?: (text: string) => boolean;
    textOf?: (item: any) => string;
  },
): FlowSegment[];

export function shouldFlowSegment(segs: ReadonlyArray<FlowSegment> | null | undefined): boolean;

export function headSegmentIndex(segs: ReadonlyArray<FlowSegment> | null | undefined): number;
