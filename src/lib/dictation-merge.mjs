/**
 * 语音听写回填的合并逻辑（09-23 修「听写把手打的内容吞掉」）。
 *
 * 背景：听写是**流式**的 —— partial 结果每几百毫秒来一次，每次都是「当前整段字幕」而不是增量，
 * 所以回填只能**替换上一次写进去的那段**。原实现直接 `setPrompt(base + 字幕)` 整段覆盖输入框：
 * 听写期间用户手打的字（或删改）会被下一次 partial 无条件抹掉。
 * WorkBuddy 5.6.0 的对应条目是「语音输入实时反馈…**语音输入过程中不再打断手动编辑**」。
 *
 * 判据（也是本模块存在的原因）：**用户手打过就绝不再覆盖**。做法是比对
 * 「我们上次写下的结果」与「输入框现在的真实内容」：
 *   · 相等 ⇒ 期间没人动过 ⇒ 正常用新字幕替换（partial → partial 的流式更新）；
 *   · 不等 ⇒ 用户动过（打字/删除/粘贴/插图）⇒ 把他现在的内容**并入基准**，字幕接在其后。
 * ⛔ 这是**有损**的单向策略（宁可字幕接在后面，也不吞用户输入）；重复一次的极端情形
 *    （用户恰好把我们写的那段又打了一遍）远好过丢内容。
 *
 * 纯函数、无副作用 ⇒ 可被 check-preflight 直接 import 跑行为断言。
 */

/** 与既有的观感一致：基准与字幕之间用空格连接，空串不参与。 */
function join(base, extra) {
  return [String(base ?? "").trim(), String(extra ?? "").trim()].filter(Boolean).join(" ");
}

/**
 * @param {object} input
 * @param {string} input.base       本次听写开始时的输入框内容（可被用户编辑并入）
 * @param {string} input.written    我们上一次写进输入框的字幕
 * @param {string} input.current    输入框**现在**的真实内容
 * @param {string} input.dictation  本次回调带来的整段字幕
 * @returns {{ text: string, base: string, written: string, userEdited: boolean }}
 *          text    —— 要写回输入框的完整内容
 *          base    —— 更新后的基准（下次调用传回来）
 *          written —— 本次写下的字幕（下次调用传回来）
 */
export function mergeDictation(input) {
  const base = String(input?.base ?? "");
  const written = String(input?.written ?? "");
  const current = String(input?.current ?? "");
  const dictation = String(input?.dictation ?? "");
  // 「我们上次写下的结果」：用作"用户是否动过"的位标。
  const expected = join(base, written);
  const userEdited = current !== expected;
  const nextBase = userEdited ? current : base;
  return {
    text: join(nextBase, dictation),
    base: nextBase,
    written: dictation.trim(),
    userEdited,
  };
}

/** 听写开始时该记录的基准（就是当时的输入框内容），单列成函数是为了让调用点不各写一份。 */
export function dictationStartBase(current) {
  return String(current ?? "");
}
