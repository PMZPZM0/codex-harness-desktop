// 输入框附件占位符的公共机制：**图片** `[图片:<path>]` 与**文件** `[文件:<path>]`
// 都在 contentEditable 里渲染成内联 chip（09-18 用户：「把文件展示不要在输入框上面了，
// 改成在输入框里面的 chip，跟图片一样的展示」）。
//
// 为什么要"一套机制两种类型"而不是各写一份（09-18）：
//   解析、插入、剥离、去重这四件事一旦有两份实现就会漂移 —— 修订了图片那份忘了文件那份，
//   症状是"图片正常、文件时灵时不灵"，且没有任何报错。所以 token 格式与解析只此一处，
//   `src/lib/prompt-images.ts` 也只做转发（它保留的图片专用 API 供消息渲染层使用）。
//
// 纯函数、零依赖，供 App.tsx 与 scripts/check-preflight.mjs 离线断言。

export const ATTACHMENT_IMAGE = "image";
export const ATTACHMENT_FILE = "file";

const LABEL_OF = { [ATTACHMENT_IMAGE]: "图片", [ATTACHMENT_FILE]: "文件" };
const KIND_OF_LABEL = { "图片": ATTACHMENT_IMAGE, "文件": ATTACHMENT_FILE };

/** 造一个附件占位符。path 经 encodeURIComponent 编码以容忍空格 / 中文 / 反斜杠。
 *  ⛔ 图片那份的格式**必须与历史保持一致**（`[图片:<enc>]`）：已发出的消息文本里存着它，
 *  改了格式老消息的图片就解析不出来（消息渲染层 splitPromptSegments 读的就是这个）。 */
export function attachmentToken(kind, path) {
  const label = LABEL_OF[kind];
  if (!label) throw new Error(`未知的附件类型：${kind}`);
  return `[${label}:${encodeURIComponent(String(path ?? ""))}]`;
}

export function imageToken(path) {
  return attachmentToken(ATTACHMENT_IMAGE, path);
}

export function fileToken(path) {
  return attachmentToken(ATTACHMENT_FILE, path);
}

const TOKEN_RE = /\[(图片|文件):([^\]]+)\]/g;

/**
 * 把含占位符的文本拆成有序段。
 * @param text 原文
 * @param options.kinds 只把这些类型的 token 当占位符；其余（含其它类型的 token）**原样算作文本** ——
 *        这样消息渲染层的 `splitPromptSegments`（只认图片）遇到 `[文件:...]` 不会把它吞掉。
 * @returns ({ kind: "text", text } | { kind: "image" | "file", path })[]
 */
export function splitAttachmentSegments(text, { kinds = [ATTACHMENT_IMAGE, ATTACHMENT_FILE] } = {}) {
  const wanted = new Set(kinds);
  const segments = [];
  const source = String(text ?? "");
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(source); m; m = TOKEN_RE.exec(source)) {
    const kind = KIND_OF_LABEL[m[1]];
    if (!kind || !wanted.has(kind)) continue;   // 不在本次范围内 → 留作文本
    if (m.index > last) segments.push({ kind: "text", text: source.slice(last, m.index) });
    try {
      segments.push({ kind, path: decodeURIComponent(m[2]) });
    } catch {
      segments.push({ kind, path: m[2] });
    }
    last = m.index + m[0].length;
  }
  if (last < source.length) segments.push({ kind: "text", text: source.slice(last) });
  return segments;
}

/** 文本里出现过的某类型附件路径（按出现顺序去重）。 */
export function attachmentPaths(text, kind) {
  const seen = new Set();
  const paths = [];
  for (const seg of splitAttachmentSegments(text)) {
    if (seg.kind === kind && !seen.has(seg.path)) {
      seen.add(seg.path);
      paths.push(seg.path);
    }
  }
  return paths;
}

/** 图片路径（消息渲染层与发送管线用它，与历史 prompt-images.promptImagePaths 等价）。 */
export function promptImagePaths(text) {
  return attachmentPaths(text, ATTACHMENT_IMAGE);
}

/** 文件路径（输入框 chip / 发送时拼 [附件文件] 段用它）。 */
export function promptFilePaths(text) {
  return attachmentPaths(text, ATTACHMENT_FILE);
}

/** 剥离指定类型的占位符并清理多余空行（图片发送前要把标记从正文里去掉）。
 *  `kinds` 默认两种都剥。 */
export function stripAttachmentTokens(text, kinds = [ATTACHMENT_IMAGE, ATTACHMENT_FILE]) {
  const drop = new Set(kinds);
  return splitAttachmentSegments(text)
    .map((seg) => (seg.kind === "text" ? seg.text : (drop.has(seg.kind) ? "" : attachmentToken(seg.kind, seg.path))))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 在 [start, end) 处插入一个占位符，返回新文本与新光标位置。 */
export function insertAttachmentToken(text, start, end, token) {
  const source = String(text ?? "");
  const from = Math.max(0, Math.min(start, source.length));
  const to = Math.max(from, Math.min(end, source.length));
  const before = source.slice(0, from);
  const after = source.slice(to);
  // 前后补空格：避免占位符与相邻文字粘成一个词（`看[图片:x]这个` → `看 [图片:x] 这个`）
  const lead = before && !/\s$/.test(before) ? " " : "";
  const tail = after && !/^\s/.test(after) ? " " : "";
  return { text: `${before}${lead}${token}${tail}${after}`, caret: (before + lead + token + tail).length };
}

/** 从文本里移除某类型某路径的占位符（chip 的 × 被点时用）。
 *  `insertAttachmentToken` 会在占位符两侧补空格，所以这里要**只吃掉补出来的那一个**：
 *  · `\s?token\s?` + 折叠连续空格 → 若前后各有空格会双双被吃，把用户手打的空格也删了
 *    （`readme [文件:x] 很好` → `readme很好`）；
 *  · `[ \t]*token[ \t]*` 会吃光两侧所有空格，`readme    [文件:x]    很好` → `readme很好`。
 *  正确做法：有空格就吃掉其中一个（保留另一个作分隔），没空格就留一个空格补位。 */
export function removeAttachmentToken(text, kind, path) {
  const token = attachmentToken(kind, path);
  const source = String(text ?? "");
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 三种形态依次尝试：左有空格、右有空格、两侧都没空格。命中后统一替换为**一个空格**
  // （它的作用是分隔剩下的词，不是占位），最后把可能出现的连续空格折成一个。
  return source
    .replace(new RegExp(`[ \\t]+${escaped}`), " ")
    .replace(new RegExp(`${escaped}[ \\t]+`), " ")
    .replace(new RegExp(escaped), " ")
    .replace(/[ \t]{2,}/g, " ");
}

/** 粘贴的纯文本超过这个字数就落盘成 .txt 并显示为文件 chip（09-18 用户：「复制的内容
 *  超过 200 字的时候把文本直接显示成一个 .txt 文件的方式」）。 */
export const PASTED_TEXT_TO_FILE_THRESHOLD = 200;

/** 判断粘贴的纯文本是否该转成文件。
 *  阈值按 `trim()` 后的长度算 —— 这样"全是空白的粘贴"（trim 后长度 0）天然不成立，
 *  不必再单独判一次空值（09-18 反证时发现那句早退是冗余的，已删：写两遍判断只会让人
 *  以为两处都必须保留）。 */
export function shouldSavePastedTextAsFile(text, threshold = PASTED_TEXT_TO_FILE_THRESHOLD) {
  return String(text ?? "").trim().length > threshold;
}

