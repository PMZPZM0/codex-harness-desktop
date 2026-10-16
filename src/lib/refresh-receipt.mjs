/**
 * 刷新回执（2026-10-16，用户：「检查一下应用现在有的一些，刷新，现在很多刷新都没有弹窗反馈刷新状态」）
 *
 * 口径（与 10-06「拨动开关必须有回执」同源，守卫见 scripts/guards/11u-notice-feedback.mjs）：
 *   点刷新 ⇒ **立刻**一条「正在…」（点击当场有反应）⇒ 结束覆盖为「完成」/「失败：原因」。
 *   ⛔ 成功静默就是用户眼里的「点了没反应」—— 所以成功也要发；失败更要发，且带原因。
 *
 * ⛔ 为什么包在**按钮**上，而不是写进 refresh/load 函数里：
 *   这些函数**同时**被挂载时的首屏加载调用（useEffect）——在函数内部无条件发通知，
 *   就变成「每打开一个设置页弹一次」。回执只属于「用户点出来的那一次」。
 *
 * 契约：`run()` 失败时**返回失败原因**（字符串），成功返回任意 falsy（undefined/null/""/false）。
 *   —— 这些函数几乎都**吞掉异常**（catch 里自己报错、然后正常返回），包装器不看返回值
 *      就没有别的办法知道成败，会在失败之后照样报「完成」，把失败提示顶掉（10-06 同款坑）。
 *   少数不吞错的函数会抛异常，这里一并兜住按失败处理。
 *
 * ⛔ 纯函数：不 import 宿主 / React，可被预检直接真跑断言。
 */

/** 回执文案上限：错误可能是一整段 HTML 或堆栈，截断避免糊满浮层。 */
const MAX_REASON = 160;

function reasonOf(error) {
  const raw = String((error && error.message) || error || "未知错误");
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > MAX_REASON ? `${flat.slice(0, MAX_REASON)}…` : flat;
}

/**
 * 包一次「用户点出来的刷新」，给三态回执。
 *
 * @param {(text: string) => void} notice 回执通道（渲染层传 `setNotice` / `onNotice`）。
 *   缺省或不是函数 ⇒ 退化成直接调用 `run()`，不报错（回执是锦上添花，不能卡住刷新本身）。
 * @param {string} label 动作名（中文，如「刷新 MCP 状态」）：
 *   文案 = `正在{label}…` / `{label}完成` / `{label}失败：原因`
 * @param {() => any} run 真正干活的函数；失败时返回失败原因字符串
 * @returns {Promise<boolean>} 成功 true / 失败 false
 */
export async function refreshWithReceipt(notice, label, run) {
  if (typeof notice !== "function") return run();
  notice(`正在${label}…`);
  let failure = "";
  try {
    failure = await run();
  } catch (error) {
    failure = reasonOf(error);
  }
  notice(failure ? `${label}失败：${reasonOf(failure)}` : `${label}完成`);
  return !failure;
}
