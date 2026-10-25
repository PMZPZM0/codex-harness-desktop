/**
 * 悬浮球的互动小逻辑（10-26 用户：「能不能做点互动啊，比如眼睛跟着鼠标走，打字有键盘出来」）。
 *
 * ⛔ 纯函数、不碰 DOM / React ⇒ 守卫 11z 可直接 import 跑真值表。
 * ⛔ 眼睛是「胶囊眼」没有瞳孔，所以追踪靠**整体平移眼球**（范围 2~3px），
 *    不是画一个跟着跑的瞳孔 —— 那会变成另一套风格。
 */

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * 鼠标位置 → 眼球位移（px）。
 * @param {number} clientX 指针视口坐标
 * @param {number} clientY
 * @param {{left:number,top:number,width:number,height:number}} rect 球的矩形
 * @param {{x:number,y:number}} [range] 最大位移；减动效时传 0
 */
export function gazeOffsets(clientX, clientY, rect, range = { x: 3, y: 2.2 }) {
  if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 };
  const nx = clamp((clientX - (rect.left + rect.width / 2)) / (rect.width / 2), -1, 1);
  const ny = clamp((clientY - (rect.top + rect.height / 2)) / (rect.height / 2), -1, 1);
  return { x: round2(nx * range.x), y: round2(ny * range.y) };
}

/**
 * 指针移动速度 → 眼睛（瞳孔）放大倍数。
 * 慢移也有一点反应（1.04x），快速划过最多 1.18x；停下由 CSS transition 回落到 1。
 * @param {number} speed px/ms
 */
export function pupilScale(speed) {
  if (!Number.isFinite(speed) || speed <= 0) return 1;
  return round2(1 + Math.min(0.18, 0.04 + speed * 0.035));
}

/** 只有输入框 / 多行输入 / 可编辑区域里的敲键才算「用户在打字」。 */
export function isTypingTarget(tagName, isContentEditable = false) {
  if (isContentEditable) return true;
  const tag = String(tagName || "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA";
}

/**
 * 这次按键是否值得弹小键盘：
 * 单个字符（含空格）、退格/回车/删除算打字；Ctrl/⌘/Alt 组合键与方向键/Shift 等不算。
 */
export function isTypingKey(key, mods = {}) {
  if (!key) return false;
  if (mods.ctrlKey || mods.metaKey || mods.altKey) return false;
  if (typeof key === "string" && [...key].length === 1) return true;
  return key === "Backspace" || key === "Enter" || key === "Delete";
}
