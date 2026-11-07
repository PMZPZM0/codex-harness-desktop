/**
 * 群聊正文里的 @ 提及 → **按出现顺序**切成渲染段（11-07 用户令）。
 *
 * ⛔⛔ 用户原话：「消息开头的一处艾特需显示为真实艾特，其余位置出现的艾特均为假艾特且被重复展示；
 *    请将所有艾特统一改为真实艾特……当一条消息包含多个艾特时，需按出现顺序依次解析并逐一渲染，
 *    不可一次性全部输出或错乱顺序」。
 *
 * 旧实现在两处各走一半，结果就是截图里那个样子：
 *   · 用户消息：`row.mentions` 渲染成**前缀 chip**，而正文里的 `@承枢` 原文照旧被 Markdown 画出来
 *     ⇒ 同一条消息里出现两个「@承枢」（一个真、一个假）；
 *   · 伙伴回复：正文里的 `@问需：` / `@构梁：` 只当普通文字（假艾特，不可点、没有头像）。
 *
 * ⇒ 唯一口径：**只从正文切**。谁在正文里写了 `@名字`，就在那个位置渲染一个真提及；
 *    位置与顺序由本函数保证（左到右逐段产出），调用方只负责把 text 段与 mention 段按序画出来。
 *    ⛔ 不再单独渲染 mentions 前缀 —— 那必然重复。
 *
 * ⛔ 只在**独立的 @ 词**上命中：`@名字` 后面必须是分隔符（空白/标点/结尾），
 *    否则「@问需求澄清」会把成员「问需」吃掉半截 —— 名字后面直接跟汉字时不算提及。
 * ⛔ 代码块（``` 围栏）里的 @ 一律不当提及：那里是给模型看的原文（命令行、邮箱等）。
 * ⛔ 候选名按长度降序匹配：有「张三」「张三丰」时 `@张三丰` 必须整体命中，不能切成「张三」+「丰」。
 */

/** @ 后面允许紧跟的「词边界」字符（命中后不吞这些字符，它们留在下一个 text 段里）。 */
const BOUNDARY = new Set([
  " ", "\t", "\n", "\r", "\u3000",
  "：", ":", "，", ",", "。", ".", "；", ";", "！", "!", "？", "?",
  "、", ")", "）", "]", "】", "》", ">", "”", "\"", "'", "…", "—",
]);

/** 文本段 / 提及段。⛔ mention 带 id 与 name，调用方据此取头像（真实用户中心数据）与用户名。 */

/**
 * 把正文切成「文本段 / 提及段」，**严格按出现顺序**。
 *
 * @param {string} text 正文原文
 * @param {Array<{id?: string, name?: string}>} candidates 群成员 + 团成员 + 当前用户（同名以先出现者为准）
 * @param {{ excludeId?: string }} [options] excludeId = 不把自己 @ 自己算成提及
 * @returns {Array<{type: "text", text: string} | {type: "mention", id: string, name: string, raw: string}>}
 */
export function splitMentionSegments(text, candidates, options = {}) {
  const src = String(text ?? "");
  if (!src) return [];
  const excludeId = String(options?.excludeId ?? "");
  /* ⛔ 名字去重 + 长度降序：长名优先，避免「张三丰」被「张三」截断。 */
  const seen = new Set();
  const list = (Array.isArray(candidates) ? candidates : [])
    .map((c) => ({ id: String(c?.id ?? ""), name: String(c?.name ?? "").trim() }))
    .filter((c) => c.id && c.name && c.id !== excludeId)
    .filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)))
    .sort((a, b) => b.name.length - a.name.length);

  /** 代码围栏区间（``` 或 ~~~ 成对），区间内不解析 —— 一行里同时开合的也算。 */
  const fences = [];
  {
    const re = /^[ \t]*(```|~~~)/gm;
    let open = -1;
    let m;
    while ((m = re.exec(src))) {
      if (open < 0) open = m.index;
      else { fences.push([open, m.index + m[0].length]); open = -1; }
    }
    if (open >= 0) fences.push([open, src.length]);
  }
  const inFence = (i) => fences.some(([a, b]) => i >= a && i < b);

  const out = [];
  const pushText = (chunk) => {
    if (!chunk) return;
    const last = out[out.length - 1];
    if (last && last.type === "text") last.text += chunk;
    else out.push({ type: "text", text: chunk });
  };

  let i = 0;
  let plain = "";
  while (i < src.length) {
    const ch = src[i];
    if (ch !== "@" || inFence(i) || !list.length) { plain += ch; i += 1; continue; }
    const hit = list.find((c) => {
      const word = `@${c.name}`;
      if (!src.startsWith(word, i)) return false;
      const after = src[i + word.length];
      return after === undefined || BOUNDARY.has(after);
    });
    if (!hit) { plain += ch; i += 1; continue; }
    pushText(plain);
    plain = "";
    const raw = `@${hit.name}`;
    out.push({ type: "mention", id: hit.id, name: hit.name, raw });
    i += raw.length;
  }
  pushText(plain);
  return out;
}

/** 提及链接的 href 前缀。⛔ 用**页内锚点**而不是自定义协议：
 *  react-markdown 的 `defaultUrlTransform` 会把不认识协议的 URL 清洗掉（href 变空），
 *  而 `#...` 相对锚点一律放行 —— 换协议名就等于换一整条链路。 */
const HREF_PREFIX = "#tm-";

/**
 * 把正文里的 `@名字` 改写成 **Markdown 链接**，交给 Markdown 渲染后再由 `a` 组件画成真提及。
 *
 * ⛔ 为什么走链接而不是切段渲染：正文里的 @ 常常在**段落中间**（「重点问清 @问需 这件事」），
 *    切段会把段落切成多个块级元素（换行、列表断裂）。链接是 Markdown 唯一的行内钩子。
 * ⛔ 代码块里的 @ 不替换（splitMentionSegments 已保证）。
 */
export function linkifyMentions(text, candidates, options = {}) {
  const segs = splitMentionSegments(text, candidates, options);
  return segs
    .map((seg) => (seg.type === "text"
      ? seg.text
      : `[@${seg.name.replace(/[[\]]/g, (c) => `\\${c}`)}](${HREF_PREFIX}${encodeURIComponent(seg.id)})`))
    .join("");
}

/** 从提及链接的 href 取回目标 id（不是提及链接 ⇒ ""）。 */
export function mentionIdOfHref(href) {
  const v = String(href ?? "");
  if (!v.startsWith(HREF_PREFIX)) return "";
  try { return decodeURIComponent(v.slice(HREF_PREFIX.length)); } catch { return ""; }
}
