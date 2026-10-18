/** 工作区外授权的**应用内询问**通道（pub/sub + Promise）。 */
export type FileTrustAsk = { dir: string; path?: string };

/** 注册渲染器（<FileTrustDialog /> 挂载时调用），返回反注册。 */
export function onFileTrustAsk(handler: (payload: FileTrustAsk) => void): () => void;
/** 发起一次询问；无弹窗挂载时返回 false（宁可不放行，也不静默授权）。 */
export function askFileTrust(payload: FileTrustAsk): Promise<boolean>;
/** 弹窗回包：true = 允许并预览。 */
export function respondFileTrust(allowed: boolean): void;
