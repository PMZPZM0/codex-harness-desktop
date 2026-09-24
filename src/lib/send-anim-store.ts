/** sendAnimStore（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { createSendAnimClaim } from "./send-anim.mjs";

export const sendAnimStore = createSendAnimClaim();

/** 发送时登记待认领的入场动画（存可见正文；引擎侧正文会额外拼记忆/技能/引用段）。 */
