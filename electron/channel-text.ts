// 渠道纯文本排版（09-18 用户：「为啥不能跟汇总一样的格式同步过来」「其他机器人渠道消息是这个一样的效果不」）：
// iLink 消息是**纯文本**，不渲染 Markdown——桌面端的表格/标题/粗体原样发过去就是一堆竖线。
// 这里把 Markdown 转成手机上可读性最好的纯文本排版：表格行 → 【首列】其余列、标题 → 【】、
// 粗体/行内代码去符号、链接去 URL 留文字、列表转 •。**逐行转换**——配合流式「攒到完整行再发」
// 的分片策略，表格行跨分片也安全（每行独立转换，不依赖上下文）。
// 纯函数；预检【38】用 node type-stripping 直跑真实现做行为断言。
import { stripVoiceScript } from "../src/lib/voice-script.mjs";

/** 行内代码占位符标记（\u0000 不会出现在模型输出里） */
const CODE_SLOT = "\u0000CODE";

/** 单行内联清理：粗体/斜体/行内代码去符号，链接 [t](u) → t */
function stripInline(md: string): string {
  const spans: string[] = [];
  return md
    // ① 先把 `…` 行内代码摘出来保护：里面的 `*`、`|`、`#` 都是字面量，不参与任何排版。
    //    ⛔ 不能图省事放在最后一步做——那样斜体规则已经先把代码里的星号吃掉了。
    .replace(/`([^`\n]+)`/g, (_all, code: string) => {
      spans.push(code);
      return `${CODE_SLOT}${spans.length - 1}\u0000`;
    })
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    // ② 斜体只认「紧贴词的 *…*」。⛔ 不许退回 `\*([^*\n]+)\*`：那会把 `x = 1 * 2 * 3` 的乘号当
    //    定界符吃掉 —— 11-04 实测发往手机变成 `x = 1  2  3`（数字还在、运算符没了，用户照抄就错）。
    .replace(/\*(\S(?:[^*\n]*\S)?)\*/g, "$1")
    // ③ 残留的 `**` 一律清掉：配对正则吃不到「半截粗体」，流式分片把 `**今晚**` 切成 `**今晚` 时，
    //    不去掉就是 QQ 上一条独立的气泡写着「**今晚」（11-04 用户截图）。
    .replace(/\*\*/g, "")
    // ④ 放回行内代码：纯文本渠道没有等宽字体，去掉反引号但**内容原样**。
    .replace(new RegExp(`${CODE_SLOT}(\\d+)\u0000`, "g"), (_all, i: string) => spans[Number(i)] ?? "");
}

/** 围栏起止行（``` 或 ~~~，可带语言标注） */
function isFenceLine(line: string): boolean {
  return /^\s*(?:`{3,}|~{3,})/.test(line);
}

/** Markdown → 聊天渠道纯文本排版（微信/Telegram/飞书/钉钉/QQ 通用：它们要么是纯文本消息，要么对表格无能为力）*/
export function plainTextForChannel(md: string): string {
  // 先剥播报稿（```voice … ```）：那是给 TTS 念的台本，不是给用户看的正文。
  // 桌面端显示时本来就剥掉它，渠道侧没剥 ⇒ QQ 收到「```voice + 一段和正文重复的口播」。
  // 真相源仍是 src/lib/voice-script.mjs（⛔ 不在这里另抄一份围栏规则）。
  const lines = String(stripVoiceScript(md ?? "")).split(/\r?\n/);
  const out: string[] = [];
  // ⛔ 代码块内**一律原样**。11-04 实测旧写法不认识围栏：```python 里的 `| a | b |` 被转成
  //   【a】b、shell 的 `# 注释` 被转成【注释】——发给手机的代码样本被静默改坏，用户照抄跑不通。
  let inFence = false;
  for (const line of lines) {
    if (isFenceLine(line)) {
      inFence = !inFence;
      out.push(line.trim()); // 保留围栏本身：纯文本里它是「这段是代码」的唯一提示
      continue;
    }
    if (inFence) { out.push(line); continue; }
    // 表格行：| a | b | → 【a】b（分隔行 |---|---| 整行丢弃）
    const table = line.match(/^\s*\|(.+)\|\s*$/);
    if (table) {
      const cells = table[1].split("|").map((c) => stripInline(c.trim()));
      if (cells.every((c) => /^:?-{3,}:?$/.test(c) || c === "")) continue;
      const filled = cells.filter((c) => c !== "");
      if (filled.length === 0) continue;
      out.push(filled.length === 1 ? filled[0] : `【${filled[0]}】${filled.slice(1).join(" ｜ ")}`);
      continue;
    }
    // 水平线：整行丢弃（微信上就是噪音）。⛔ 不要用反向引用（`\1`）——`[\s\1]` 会被 TS 当八进制转义报 TS1536
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue;
    // 标题：## X → 【X】
    const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) { out.push(`【${stripInline(heading[1])}】`); continue; }
    // 引用：> X → X
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) { out.push(stripInline(quote[1])); continue; }
    // 无序列表：- X → • X
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bullet) { out.push(`${bullet[1]}• ${stripInline(bullet[2])}`); continue; }
    out.push(stripInline(line));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
