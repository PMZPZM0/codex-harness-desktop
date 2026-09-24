/**
 * constants —— **barrel**：全部声明已按域分到同目录 constants/（09-22 结构改造）。
 * ⛔ 顺序即契约（若含 hook / 副作用注册，调用顺序 == 原文件顺序）⇒ 只能按文件名前缀顺序 import。
 */
import "@xterm/xterm/css/xterm.css";
import "./constants/01-notices-labels";
import "./constants/02-identity-onboarding";
import "./constants/03-ui-options";
import "./constants/04-run-phrases-thresholds";

export { NOTICE_TTL_MS, NOTICE_MAX, HOOK_EVENT_LABELS, CJK_TEXT_RE, SKILL_ZH_NOTES } from "./constants/01-notices-labels";
export { IDENTITY_ONBOARD_INSTRUCTIONS, IDENTITY_ONBOARD_TOOL, EXPERT_CATEGORY_LABELS, EXPERT_CATEGORY_DEFS, MEMORY_CATEGORIES, MEMBER_LABELS } from "./constants/02-identity-onboarding";
export { LOCAL_MODEL_PRESETS, SHORTCUT_GROUPS, QUICK_SITES, RRULE_DAY_NAMES, CHANNEL_STATUS_KEY, SANDBOX_MODES, APPROVAL_MODES, COMPOSER_FILE_CHIP_ICON } from "./constants/03-ui-options";
export { RUN_PHRASES, RUN_PHRASES_BY_ACTIVITY, DIFF_VIRTUAL_THRESHOLD, DELEGATE_RAIL_LINGER_MS } from "./constants/04-run-phrases-thresholds";
