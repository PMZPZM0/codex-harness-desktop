/** 右栏缩放状态（放大＝覆盖主对话区 / 缩小＝回原宽）。 */
export function getPanelMaximized(): boolean;
export function defaultPanelWidth(): number;
export function setPanelMaximized(next: boolean): void;
export function subscribePanelMaximized(fn: (maximized: boolean) => void): () => void;
