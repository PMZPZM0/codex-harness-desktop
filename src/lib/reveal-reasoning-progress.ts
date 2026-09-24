/** revealReasoningProgress（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export const revealReasoningProgress = new Map<string, string>();
// 命令/动态工具/文件编辑内容在 completed 快照里整包交付时，也从旧内容继续追字。

/** reasoning 的展示文本：summary + content 数组（兼容字符串与对象两种形态）拼成一段 */
