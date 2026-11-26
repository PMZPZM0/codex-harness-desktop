export type CanvasImageRequest = { path: string; name: string; at: number };
/** 请求把一张图片放到画布上（右键菜单调用；画布未挂载时先记下）。 */
export function requestCanvasImage(path: string, name?: string): void;
/** 取走并清空（画布首次挂载时消费，同一张图不会落两次）。 */
export function takeCanvasImage(): CanvasImageRequest | null;
/** 订阅（画布存活期间）；返回取消函数。 */
export function subscribeCanvasImage(fn: (request: CanvasImageRequest) => void): () => void;
