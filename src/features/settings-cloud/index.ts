/**
 * 云账号板块的渲染层对外面（barrel）。
 *
 * ⛔ 别的板块（如输入框的 `02-composer-form`）要用这里的东西，**只经这个 barrel**，
 *   不许深链内部文件（`docs/ARCHITECTURE-RULES.md` §1.1 的分层契约）。
 */
export { CloudAccountSection } from "./CloudAccountSection";
export { CloudPointsBadge } from "./CloudPointsBadge";
