/** 右栏「媒体」页的目标（见 panel-store.mjs 头注）。 */
import type { MediaPreviewTarget } from "../../lib/ui-channels";
/** 设置当前预览目标（null 清空）。 */
export function setMediaPanelTarget(target: MediaPreviewTarget | null): void;
/** 读当前预览目标。 */
export function getMediaPanelTarget(): MediaPreviewTarget | null;
/** 订阅目标变化；返回取消函数。 */
export function subscribeMediaPanelTarget(fn: (target: MediaPreviewTarget | null) => void): () => void;
