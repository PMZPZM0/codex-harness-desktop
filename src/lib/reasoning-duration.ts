/** reasoningDuration（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export const reasoningDuration = new Map<string, number>();
// 某些中转不转发 agentMessage delta，只在 completed 时一次性交付全文。
// 记录这种"从短文本突然跳到全文"的 item，渲染层用快速增量揭示兜底。
