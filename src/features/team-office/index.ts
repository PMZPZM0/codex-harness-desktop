/**
 * 像素办公室域 · 公开面（barrel）。别的域只许从这里 import（架构规则 §1）。
 */
export { TeamOfficePreview, type TeamOfficePreviewProps } from "./TeamOfficePreview";

/**
 * 普通会话打开办公室用的**哨兵 teamId**（10-04 引入）。
 *
 * ⛔ 不能用空串 —— 与「没打开浮层」不可区分（`TeamOfficePreview` 的显示门槛就是
 *   `if (!teamId) return null`）；普通会话模式靠 teamId 查不到 team 来区分两条路径。
 *
 * ⭐ 10-05 从 `AppView.tsx` 搬到这里：入口由「左下角浮动按钮」改成**右侧轨道节点**后，
 *   `02-main-stage/01-timeline.tsx` 也要用它 ⇒ 常量必须落在**两边都能 import 的域**里
 *   （AppView 反过来 import timeline，留在 AppView 会形成循环）。
 */
export const OFFICE_SESSION_TEAM_ID = "__office-session__";
