/** 3D 预览目标（右栏「3D 预览」页与引擎推送共用，见 store.mjs 头注）。 */
export type ModelViewerTarget = { path: string; title: string };
/** 设置当前预览目标（null 清空）。 */
export function setModelViewerTarget(target: ModelViewerTarget | null): void;
/** 读当前预览目标。 */
export function getModelViewerTarget(): ModelViewerTarget | null;
/** 订阅目标变化；返回取消函数。 */
export function subscribeModelViewerTarget(fn: (target: ModelViewerTarget | null) => void): () => void;
