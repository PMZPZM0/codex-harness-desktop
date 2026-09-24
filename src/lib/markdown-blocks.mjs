/** 消息正文的 markdown 分块（splitMarkdown 从 src/features/markdown/Markdown.tsx 原样搬来）。
 *
 *  为什么抽成 .mjs：纯函数 ⇒ 预检守卫可以直接 import 跑真值表（比 grep 源码硬），
 *  与 src/lib/ 下其它纯函数模块同一套路。
 *
 *  这里额外做了两处**渲染容错**，都针对同一个用户可见症状（「最后一个总是歪的，前面空那么多」）：
 *    ① trimInvisibleSpace —— 行首/行尾的全角空格与 U+00A0 不被 HTML 折叠，会渲染成可见空白；
 *    ② softenListTailLazyContinuation —— 列表尾部顶格的结语行会被 CommonMark 当 lazy 续行，
 *       吞进最后一个 <li> 里 ⇒ 从 marker 之后起排、左侧空出 marker 宽度。
 *  两处都只动「空白/换行」，不改任何一个正文字符；围栏（代码块）内一律不碰。
 */

/** 列表项行：0-3 空格缩进 + 标记（-、*、+ 或 1. / 1)）+ 空白 + 内容 */
const LIST_ITEM_LINE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+\S/;
/** 其它块级元素开头（标题 / 引用 / 围栏 / 分隔线 / 表格）：这类行 CommonMark 自己会断块，
 *  不属于「被列表吞掉的续行」，不要碰。 */
const OTHER_BLOCK_LINE = /^ {0,3}(?:#{1,6}(?:\s|$)|>|\||`{3,}|~{3,}|(?:[-*_] *){3,}$)/;

export function isListItemLine(line) {
  return LIST_ITEM_LINE.test(line);
}

/**
 * 列表项行 + 紧随其后**顶格**的普通行 ⇒ 那行在 CommonMark 里是该项的 lazy 续行
 * （`<li>四通八达<br/>1–10 全是…</li>`），渲染上会缩进到 marker 之后、左侧空出 marker 的
 * 宽度 —— 表现为「最后一行歪了、前面空一块」。
 *
 * 聊天里这几乎总是「模型忘了在列表后加空行」：作者本意是列表结束后另起一句话。
 * 判据刻意收窄（三条都要满足），避免误伤真正的多行列表项：
 *   ① 只在块的**尾部**找（用户看到的就是末尾那行）；
 *   ② 该行**顶格**（真续行作者会缩进对齐，缩进的绝不碰）；
 *   ③ 该行本身不是列表项、也不是别的块级开头。
 * 处理方式 = 在这行前**补一个空行**（不是拆块）：块数不变 ⇒ 流式期间 <MdBlock> 的 key
 * 稳定、组件不会重挂载；解析结果与「作者本来写了空行」逐字一致。
 */
export function softenListTailLazyContinuation(block) {
  const lines = block.split("\n");
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end--; // 块尾空行不算内容
  if (end === 0) return block;
  // 围栏（``` / ~~~）内的行不是 markdown 正文：往里注入空行会**改动代码块内容** ⇒ 必须跳过。
  // ⛔ 流式期间围栏可能还没闭合，所以这里记录「每行开始前是否已在围栏内」，而不是只看成对。
  const insideFence = [];
  let fence = null;
  for (let k = 0; k < lines.length; k++) {
    insideFence.push(fence !== null);
    const marker = /^(`{3,}|~{3,})/.exec(lines[k].trim());
    if (marker) {
      const ch = marker[1][0];
      if (!fence) fence = ch;
      else if (ch === fence) fence = null;
    }
  }
  let i = end;
  while (i > 0) {
    const line = lines[i - 1];
    if (insideFence[i - 1]) break;
    if (LIST_ITEM_LINE.test(line)) break;
    if (/^\s/.test(line)) break;
    if (OTHER_BLOCK_LINE.test(line)) break;
    i--;
  }
  if (i === end || i === 0 || !LIST_ITEM_LINE.test(lines[i - 1])) return block;
  return lines.slice(0, i).concat("", lines.slice(i)).join("\n");
}

/** 行首/行尾的「看不见的空白」：全角空格 U+3000 与不换行空格 U+00A0。
 *  ⛔ 它们在 HTML 里**不会被折叠**（只有 ASCII 空格/制表符会被折叠），所以会实打实渲染成一块
 *  可见空白 —— 中文模型输出里常带，表现就是「最后一行歪了、前面空那么多」（用户 09-24 两次反馈）；
 *  行尾那种还可能把长行挤折、多出一行。
 *  半角空格不用管：行首/行尾的 ASCII 空白浏览器会自己折叠掉，没有视觉影响。
 *  ⛔ 调用方只在**非围栏行**上调用：代码块里一个字符都不能动。 */
export function trimInvisibleSpace(line) {
  return line.replace(/^[\u3000\u00A0]+/, "").replace(/[\u3000\u00A0]+$/, "");
}

/** 按空行切块（围栏内不切），做两处容错后返回 */
export function splitMarkdown(text) {
  const lines = text.split("\n");
  const blocks = [];
  let buf = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const inFence = fence !== null;
    const line = inFence ? lines[i] : trimInvisibleSpace(lines[i]);
    const trimmed = line.trim();
    const marker = /^(`{3,}|~{3,})/.exec(trimmed);
    if (marker) {
      const ch = marker[1][0];
      // 围栏内不切分：否则 ``` 开合被拆到两个块里，代码块会渲染成乱码
      if (!fence) fence = ch;
      else if (ch === fence) fence = null;
    }
    const nextLine = i + 1 < lines.length ? trimInvisibleSpace(lines[i + 1]) : "";
    const nextIsContent = i + 1 < lines.length && nextLine.trim() !== "";
    if (!fence && trimmed === "" && nextIsContent) {
      if (buf.length) { blocks.push(buf.join("\n")); buf = []; }
      continue;
    }
    buf.push(line);
  }
  if (buf.length) blocks.push(buf.join("\n"));
  return blocks.map(softenListTailLazyContinuation);
}
