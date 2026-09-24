/** bufferedReasoningRevealStarts（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export const bufferedReasoningRevealStarts = new Map<string, string>();
// 思考出字进度表（模块级）：同 revealProgressStore，防「运行中切会话再切回重播出字」
