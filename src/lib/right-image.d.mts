export type RightImageRequest = { path: string; name: string; at: number };
/** 请求在右栏「图片」页打开某个文件（图片芯片 / 文件卡调用；面板未挂载时先记下）。 */
export function requestRightImage(path: string, name?: string): void;
/** 取走并清空（面板首次挂载时消费，同一张图不会处理两次）。 */
export function takeRightImage(): RightImageRequest | null;
/** 订阅（面板存活期间）；返回取消函数。 */
export function subscribeRightImage(fn: (request: RightImageRequest) => void): () => void;
