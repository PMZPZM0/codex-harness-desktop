/** 用户消息「chip 原始位置」注解（09-25）。
 *
 * 背景：发送时正文里的 [图片:path] / [文件:path] token 会被剥离（引擎协议需要干净正文
 * + [附件文件] 段 + localImage parts），渲染层只能把附件 chip 统一堆到消息尾部 ——
 * 用户在输入框里明明把 chip 放在了文字中间（用户 09-25：「不用强制在消息尾部」）。
 *
 * 方案：发送时把「带 token 的用户原文」按**剥离后核心文本的指纹**存入 localStorage；
 * 渲染层对 rawText 算同一指纹，命中就用原文做内联渲染（token 在哪 chip 就在哪），
 * 未命中回退现状（尾部堆叠）。不动引擎协议。
 *
 * key = hash(stripAttachmentTokens(cleanText))：发送侧 = resolve 引用块之后的 messageText
 * （已剥 token）；渲染侧 = parseUserRefs(rawText).cleanText（引用/协议段已被剥，token 本就不在）。
 * 两侧对同一消息得到同一核心文本 ⇒ 同一 key。重复文本的两条消息共享注解（无害且语义正确）。
 */

const KEY_PREFIX = "uorig-";
const MAX_ENTRIES = 400;
const TS_PREFIX = "uorig-ts-";

/** djb2：足够区分用户消息文本；即使碰撞，后果只是两条同构消息共用一份位置注解。 */
function hashText(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + "-" + text.length.toString(36);
}

function entryKey(stripped) { return KEY_PREFIX + hashText(stripped); }

export function saveMessageOriginal(stripped, original) {
  try {
    if (!stripped || !original || original === stripped) return; // 无 token 差异 ⇒ 不用注解
    const key = entryKey(stripped);
    localStorage.setItem(key, original);
    localStorage.setItem(TS_PREFIX + key.slice(KEY_PREFIX.length), String(Date.now()));
    prune();
  } catch { /* 存储满/隐私模式 ⇒ 静默降级（尾部堆叠的现状） */ }
}

export function lookupMessageOriginal(stripped) {
  try {
    if (!stripped) return null;
    const v = localStorage.getItem(entryKey(stripped));
    return v ?? null;
  } catch { return null; }
}

/** 超上限删最旧（LRU 粗修剪），防长文本消息把 localStorage 撑爆。 */
function prune() {
  try {
    const tsEntries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(TS_PREFIX)) tsEntries.push([k, Number(localStorage.getItem(k) || 0)]);
    }
    if (tsEntries.length <= MAX_ENTRIES) return;
    tsEntries.sort((a, b) => a[1] - b[1]);
    for (const [tsKey] of tsEntries.slice(0, tsEntries.length - MAX_ENTRIES)) {
      localStorage.removeItem(tsKey);
      localStorage.removeItem(KEY_PREFIX + tsKey.slice(TS_PREFIX.length));
    }
  } catch { /* 忽略 */ }
}
