/** bufferedAgentRevealStarts（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export const bufferedAgentRevealStarts = new Map<string, string>();
// reasoning 同理：完成快照一次性交付思考全文时，渐进揭示避免"瞬间冒出来"
