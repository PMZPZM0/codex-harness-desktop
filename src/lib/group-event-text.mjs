/**
 * 群广播文本解析（10-26 用户令：「方案就按『只广播』这个完成」）。
 *
 * 背景：群里的成员**不互相对话**，只把成品汇总到中枢会话。宿主用 `[群事件] …` 这一段
 * 机器文本投进中枢线程（`electron/boss-groups/runner.ts` 的 outboxText / postToBoss）。
 * 问题是这段文本在界面上被当成**用户自己说的话**（右对齐气泡 + "你"）—— 于是"群聊"看起来
 * 全是用户自说自话，也看不出是谁交的活。
 *
 * ⇒ 这里把 `[群事件]` 文本拆成结构化块，渲染层按块出气泡（头像 + 名字 + 内容）。
 * ⛔ 纯函数、零依赖（类型在 group-event-text.d.mts）：`scripts/verify-injection-strip.mjs`
 *    直接 import 它跑真实样本 ⇒ 改 runner 的文案时那条回归会立刻报红
 *    （文案漂移 = 解析失效 = 又变回一坨文本铺在气泡里）。
 */

const TAG = "[群事件]";

/** 一条消息可能被合并投递（多段 `[群事件]`）⇒ 按标签切段，逐段归类。无标签返回 null（不是群消息）。 */
export function parseGroupEvents(text) {
  const raw = String(text ?? "");
  if (!raw.includes(TAG)) return null;
  const segments = [];
  let at = raw.indexOf(TAG);
  while (at >= 0) {
    const next = raw.indexOf(TAG, at + TAG.length);
    segments.push(raw.slice(at + TAG.length, next < 0 ? raw.length : next));
    at = next;
  }
  const blocks = segments.map(classify).filter(Boolean);
  return blocks.length ? blocks : null;
}

function classify(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  /* ① 单人交活：`<名字> 交活：「<标题>」\n<成品>`                       （outboxText 单条路径） */
  const deliver = s.match(/^(.{1,40}?) 交活：「(.+?)」\n([\s\S]*)$/);
  if (deliver) {
    return { type: "deliverable", who: deliver[1].trim(), title: deliver[2].trim(), body: deliver[3].trim() };
  }

  /* ② 合并投递：`本轮 N 条交活（…）：\n- 「标题」（名字）：摘要…`        （outboxText 多条目路径） */
  const batch = s.match(/^本轮 (\d+) 条交活/);
  if (batch) {
    const items = [...s.matchAll(/^-\s*「(.+?)」（(.+?)）：/gm)].map((m) => ({ title: m[1].trim(), who: m[2].trim() }));
    return { type: "batch", count: Number(batch[1]) || items.length, items };
  }

  /* ③ 待审请求（一条或多条）：`任务「X」已交活…` / `有 N 条任务已交活待你判…`
     ⛔ 这两段的正文里带着验收标准与最多 16k 成品 —— 成品在上面那条交付气泡里已经显示过，
        界面只留一句"等中枢评审"，不再整段铺开（否则群里一半版面是重复内容）。 */
  const reviewMany = s.match(/^有 (\d+) 条任务已交活待你判/);
  if (reviewMany) {
    const titles = [...s.matchAll(/^·\s*taskId=[^\s「]+\s*「(.+?)」/gm)].map((m) => m[1].trim());
    return { type: "review", count: Number(reviewMany[1]) || titles.length, titles };
  }
  const reviewOne = s.match(/^任务「(.+?)」已交活/);
  if (reviewOne) return { type: "review", count: 1, titles: [reviewOne[1].trim()] };

  /* ④ 其余（预算/停滞/失败/成员进出/超时…）：居中系统行，原样显示（都短）。 */
  return { type: "notice", text: s };
}

/** 用户可见的纯文本（复制/搜索/标题用）：交付正文 + 系统行，不含机器标签与待审的长正文。 */
export function groupEventPlainText(blocks) {
  return (blocks ?? [])
    .map((b) => {
      if (b.type === "deliverable") return b.body;
      if (b.type === "batch") return b.items.map((i) => `「${i.title}」（${i.who}）`).join("、");
      if (b.type === "review") return b.titles.map((t) => `「${t}」待评审`).join("、");
      return b.text;
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
