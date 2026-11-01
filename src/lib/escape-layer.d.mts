/** escape-layer.mjs 的类型面（渲染层 tsc 要求 .mjs 配 .d.mts；与 src/lib/feishu-card.d.mts 同款）。 */

/** 把 Esc 处理器压入全局分层栈（后挂的在上），返回退栈函数（供 useEffect cleanup）。 */
export function pushEscapeLayer(handler: (event: KeyboardEvent) => boolean | void): () => void;
