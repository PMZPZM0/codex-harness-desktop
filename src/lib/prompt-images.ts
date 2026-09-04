// 输入框内联图片占位符解析：把 prompt 里的 [图片:<path>] 标记拆成文本段 + 图片段。
// 设计对齐 WorkBuddy：图片 chip 内联在文字光标处，粘贴在哪就出现在哪。
// 纯函数，供输入框覆盖层渲染与发送管线共用。

/** 占位符格式：[图片:路径]。路径经 encodeURIComponent 编码以容忍空格/中文。 */
export function imageToken(path: string) {
  return `[图片:${encodeURIComponent(path)}]`;
}

const TOKEN_RE = /\[图片:([^\]]+)\]/g;

export type PromptSegment = { kind: "text"; text: string } | { kind: "image"; path: string };

/** 把含占位符的 prompt 拆成有序段；未知格式原样保留为文本。 */
export function splitPromptSegments(prompt: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(prompt); m; m = TOKEN_RE.exec(prompt)) {
    if (m.index > last) segments.push({ kind: "text", text: prompt.slice(last, m.index) });
    try {
      segments.push({ kind: "image", path: decodeURIComponent(m[1]) });
    } catch {
      segments.push({ kind: "image", path: m[1] });
    }
    last = m.index + m[0].length;
  }
  if (last < prompt.length) segments.push({ kind: "text", text: prompt.slice(last) });
  return segments;
}

/** prompt 中出现过的全部图片路径（按出现顺序去重）。 */
export function promptImagePaths(prompt: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const seg of splitPromptSegments(prompt)) {
    if (seg.kind === "image" && !seen.has(seg.path)) {
      seen.add(seg.path);
      paths.push(seg.path);
    }
  }
  return paths;
}

/** 发送用：从文本中剥离占位符标记（图片已按位置单独取出），并清理多余空行。 */
export function stripImageTokens(prompt: string) {
  return prompt.replace(TOKEN_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** 粘贴/选择图片时：在光标处插入占位符，返回新文本与新光标位置。 */
export function insertImageToken(text: string, start: number, end: number, path: string): { text: string; caret: number } {
  const token = imageToken(path);
  const needsLeadingSpace = start > 0 && !/\s|\n/.test(text[start - 1] ?? "");
  const prefix = text.slice(0, start);
  const suffix = text.slice(end);
  const insert = `${needsLeadingSpace ? " " : ""}${token}`;
  return { text: prefix + insert + suffix, caret: start + insert.length };
}

/** 删除文本中指定路径的全部占位符（含前导空格），并清理多余空行。路径为原始未编码形式。 */
export function removeImageToken(text: string, path: string): string {
  const escaped = imageToken(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\s*${escaped}`, "g"), "").replace(/  +/g, " ").replace(/\n{3,}/g, "\n\n").trimEnd();
}
