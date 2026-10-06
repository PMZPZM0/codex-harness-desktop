/**
 * whats-new 域 · 公开面（barrel）。别的域只许从这里 import（架构规则 §1）。
 *
 * ⭐ 只出这一个组件是有意的：判定（该不该弹 / 弹什么 / 看过没有）全在主进程，
 *   渲染层没有第二个入口 —— 因此本域**不需要** Registry 式的拓展面。
 *   要让弹窗支持"按版本分组 / 更多动作"，加的是 `electron/whats-new-notes.ts` 的字段，
 *   通道契约（whatsnew:state / whatsnew:ack）保持不变。
 */
export { WhatsNewDialog } from "./WhatsNewDialog";
