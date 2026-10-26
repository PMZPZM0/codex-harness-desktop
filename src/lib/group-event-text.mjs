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
 *
 * ⛔ 10-26 追加：「成品文件」行 —— 交活正文**落盘成文件**（主进程写），这里把它解析出来
 *    交给渲染层出**文件卡**（点开即预览）。理由：交活正文动辄几千字，铺在气泡里既挤又丑；
 *    而且别的对话框里 Codex 的产出就是文件卡 + 右栏预览 ⇒ 群这边对齐同一套手感。
 */

const TAG = "[群事件]";
/** 交活正文落盘后的路径行（主进程写 ⇒ 这里读）。 */
const FILE_LINE = /^成品文件：(.+)$/;

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

/** 这段文本是不是群广播（宿主投进中枢会话的机器文本）。
 *  ⛔ 渲染层靠它决定群广播**摆在哪**（消息下方，而不是像用户消息那样在消息上方）。
 *  ⛔⛔ 判据必须与 `parseGroupEvents` **同源**（解析出块才算）：早先这里只查 `includes(TAG)`，
 *     于是「用户正文里恰好提到 `[群事件]`」或「文案漂移导致一块都解析不出」的文本会被
 *     移到底部却仍按用户气泡渲染 —— 位置与样式两套判据不一致。 */
export function isGroupEventText(text) {
  return parseGroupEvents(text) !== null;
}

/** 正文首行若是「成品文件：…」⇒ 抽成 file，其余仍是正文。
 *  ⛔ 路径里可能有空格（`D:\Codex Harness Desktop\…`）⇒ 必须**按行**取，不能用懒惰正则跨行匹配。 */
function splitFile(body) {
  const text = String(body ?? "");
  const breakAt = text.indexOf("\n");
  const first = breakAt >= 0 ? text.slice(0, breakAt) : text;
  const rest = breakAt >= 0 ? text.slice(breakAt + 1) : "";
  const match = first.match(FILE_LINE);
  if (!match) return { file: "", body: text.trim() };
  return { file: match[1].trim(), body: rest.trim() };
}

/** 待审请求里的 `=== 成品 ===` 段（成员交上来的正文）—— 界面要能展开看。 */
function deliverableOf(text) {
  const raw = String(text ?? "");
  const at = raw.indexOf("=== 成品 ===");
  if (at < 0) return "";
  const tail = raw.slice(at + "=== 成品 ===".length);
  /* 成品后面可能还跟着中枢自己的指令行（"⛔ 判完…"）⇒ 截到第一条 ⛔ 之前。 */
  const stop = tail.search(/\n\s*⛔/);
  return (stop >= 0 ? tail.slice(0, stop) : tail).trim();
}

function classify(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  /* ① 单人交活：`<名字> 交活：「<标题>」\n[成品文件：<路径>\n]<成品>`   （outboxText 单条路径） */
  const deliver = s.match(/^(.{1,40}?) 交活：「(.+?)」\n([\s\S]*)$/);
  if (deliver) {
    const { file, body } = splitFile(deliver[3]);
    return { type: "deliverable", who: deliver[1].trim(), title: deliver[2].trim(), body, file };
  }

  /* ② 合并投递：`本轮 N 条交活（…）：\n- 「标题」（名字）：摘要…\n  成品文件：<路径>` （多条路径） */
  const batch = s.match(/^本轮 (\d+) 条交活/);
  if (batch) {
    const items = [];
    for (const line of s.split("\n")) {
      const text = line.trim();
      const item = text.match(/^-\s*「(.+?)」（(.+?)）：(.*)$/);
      if (item) {
        items.push({ title: item[1].trim(), who: item[2].trim(), summary: item[3].trim(), file: "" });
        continue;
      }
      const file = text.match(FILE_LINE);
      if (file && items.length) items[items.length - 1].file = file[1].trim();
    }
    return { type: "batch", count: Number(batch[1]) || items.length, items };
  }

  /* ②b 审查结论（10-26）：`审查结论：<成员> 的「<任务>」通过|打回（<判定方>判定）：<理由>`
     ⛔ 这条是**成员汇报结果**（成员干完了、被认可还是被打回）⇒ 走成员气泡（头像+名字+徽标），
        不是居中灰行 —— 用户原话：「成员消息是汇报结果的」。 */
  const verdict = s.match(/^审查结论：(.+?) 的「(.+?)」(通过|打回)（(.+?)判定）?(.*)$/s);
  if (verdict) {
    return {
      type: "verdict",
      who: verdict[1].trim(),
      title: verdict[2].trim(),
      passed: verdict[3] === "通过",
      reviewer: verdict[4]?.trim() || "",
      reasons: (verdict[5] ?? "").replace(/^[：:]/, "").trim(),
    };
  }

  /* ③ 待审请求（一条或多条）：`任务「X」已交活…` / `有 N 条任务已交活待你判…`
     ⛔ 这两段是**给中枢的机器指令**（含验收标准与最多 16k 成品）⇒ 界面上只留一句提示；
        但**成品正文要看得见**（用户原话：「我看不见方案内容」）⇒ 把 `=== 成品 ===` 段摘出来，
        折叠展示（点开看全文），不铺在气泡里。 */
  const reviewMany = s.match(/^有 (\d+) 条任务已交活待你判/);
  if (reviewMany) {
    const titles = [...s.matchAll(/^·\s*taskId=[^\s「]+\s*「(.+?)」/gm)].map((m) => m[1].trim());
    return { type: "review", count: Number(reviewMany[1]) || titles.length, titles, output: "" };
  }
  const reviewOne = s.match(/^任务「(.+?)」已交活/);
  if (reviewOne) {
    return { type: "review", count: 1, titles: [reviewOne[1].trim()], output: deliverableOf(s) };
  }

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
      if (b.type === "verdict") return `「${b.title}」${b.passed ? "通过" : "打回"}（${b.who}）`;
      return b.text;
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
