// 微信纯文本排版（09-18 用户：「为啥不能跟汇总一样的格式同步过来」）：
// iLink 消息是**纯文本**，不渲染 Markdown——桌面端的表格/标题/粗体原样发过去就是一堆竖线。
// 这里把 Markdown 转成手机上可读性最好的纯文本排版：表格行 → 【首列】其余列、标题 → 【】、
// 粗体/行内代码去符号、链接去 URL 留文字、列表转 •。**逐行转换**——配合流式「攒到完整行再发」
// 的分片策略，表格行跨分片也安全（每行独立转换，不依赖上下文）。
// 纯函数；预检【38】用 node type-stripping 直跑真实现做行为断言。

/** 单行内联清理：粗体/斜体/行内代码去符号，链接 [t](u) → t */
function stripInline(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

/** Markdown → 微信纯文本排版 */
export function wechatFriendlyText(md: string): string {
  const lines = String(md ?? "").split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
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
    // 水平线：整行丢弃（微信上就是噪音）
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) continue;
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
