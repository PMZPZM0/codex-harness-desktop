/**
 * 「待处理 · 责任人」标记的解析（纯函数，主进程与渲染层共用）。
 *
 * 11-10 用户令「继续补上缺口」——实测豆包的两级触达是「群里发总榜 + 点名到人」；
 * 我们没有私聊载体，真正的缺口是**异常发在群里没人认领**。
 * ⇒ 约定一条标记：报异常时单独一行写 `【待处理 · 责任人：某人】`，
 *   宿主登记成待办（群头可见），对方开口后自动关闭。
 *
 * ⛔ 标记写成白名单格式（全角/半角冒号、可有可无的分隔点都认），
 *   否则模型写成 `待处理:责任人=张三` 就解析不到，功能静默失效。
 */

export const DUTY_MARK_RE = /【待处理\s*[·・:：]?\s*责任人\s*[：:]\s*([^】]{1,24})】/;

/**
 * 从一段产出里取出「责任人 + 待办标题」。
 * 返回 null = 这条消息没有标记（⛔ 不要拿它当"没有异常"，只代表"没按格式写"）。
 */
export function parseDuty(text) {
  const src = String(text ?? "");
  const hit = DUTY_MARK_RE.exec(src);
  if (!hit) return null;
  const owner = String(hit[1] ?? "").trim();
  if (!owner) return null;
  const line = src.split("\n").find((row) => DUTY_MARK_RE.test(row)) ?? src;
  const title = line.replace(DUTY_MARK_RE, "").replace(/^[-*·\s]+/, "").trim().slice(0, 40) || "待处理事项";
  return { owner, title };
}

/** 标题去重键：同一个人 + 标题前 20 字 ⇒ 视为同一条待办（⛔ 防群头数字虚高）。 */
export function dutyKeyOf(owner, title) {
  return `${String(owner ?? "").replace(/\s+/g, "")}::${String(title ?? "").slice(0, 20).replace(/\s+/g, "")}`;
}
