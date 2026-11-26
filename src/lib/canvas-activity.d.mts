export type CanvasActivity = {
  at: number;
  /** activity = 模型读了/写了画布；writeback = 模型把产物写回某个节点 */
  type: "activity" | "writeback";
  /** activity 的动作：read / writeback */
  action?: string;
  canvas?: string;
  nodeId?: string;
  updates?: Record<string, string | number>;
};

export function noteCanvasActivity(payload: Omit<CanvasActivity, "at"> & { at?: number }): void;
export function setCanvasMounted(on: boolean): void;
export function takePendingWritebacks(): Array<{ nodeId: string; updates: Record<string, string | number> }>;
export function lastCanvasActivity(): CanvasActivity | null;
export function canvasLightMs(): number;
export function subscribeCanvasActivity(fn: (entry: CanvasActivity) => void): () => void;
