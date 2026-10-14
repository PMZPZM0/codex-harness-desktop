/**
 * 正文表格「右上角复制」的判据（10-14 立，用户：「汇总输出里类似这种格式内容的时候，在右上角加一个
 * 复制小图标，图标两段过渡动画」—— 截图里那份提交汇总正是一张 markdown 表格，此前正文里没有任何复制入口）。
 *
 * 三个失效点全是静默的，静态守卫 + 真值表各自钉一半：
 *   ① 两段反馈的 CSS 动画选择器漏掉这颗按钮 ⇒ 点了**只变色、不弹动**（看着像"动画没做"）；
 *   ② 复制内容拼错（内嵌换行把表撕开 / 空表也演成功）；
 *   ③ 悬停显形的隐藏态没关 `pointer-events` ⇒ 看不见却点得到（误触）。
 * ⛔ 独立守卫（不进 check-preflight 的 checks 计数），与 11y/11z/12* 同款：新断言自成一个文件，
 *   不许把在册大文件继续撑长（守卫【265】行数棘轮只许缩不许长）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tableToTsv } from "../../src/lib/md-table-text.mjs";
import { isBlockCode } from "../../src/lib/md-code-block.mjs";
import { codeOnly } from "./_ctx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【md-block-copy】${message}`);
  if (!condition) fails++;
};

const mdSrc = read("src/features/markdown/Markdown.tsx");
const css = read("src/styles/03-messages-turns.css");
const acceptSrc = read("scripts/accept.mjs");

/* ── ① 渲染层接线：表格被包一层 + 复制走共用两段反馈组件 ── */
ok(/table: \(\{ children \}\) => <MdTable>\{children\}<\/MdTable>/.test(mdSrc),
  "MD_COMPONENTS 覆盖了 `table`（正文表格才拿得到复制入口；不覆盖 = 只有裸 <table>）");
ok(/className="md-table-wrap"/.test(mdSrc) && /querySelector\("table"\)/.test(mdSrc),
  "表格被包进 .md-table-wrap（绝对定位的锚），复制时从**容器内**取 table（不抓全页第一张）");
ok((() => {
  const body = mdSrc.slice(mdSrc.indexOf("const MdTable = memo"), mdSrc.indexOf("export const MD_COMPONENTS"));
  return /<FeedbackIconButton/.test(body) && !/useState/.test(body) && !/setTimeout/.test(body);
})(), "两段反馈**复用** `FeedbackIconButton`（变对勾 + 1.1s 回位是它的时序；自己写 useState/setTimeout = 全仓两套反馈）");
ok(/window\.codex\.writeClipboard\(text\)/.test(mdSrc),
  "真写剪贴板走主进程通道 `window.codex.writeClipboard`（不是 navigator.clipboard 直写 —— 全应用同一口径）");
ok(/tableToTsv\(table\.rows\)/.test(mdSrc),
  "把**原始 HTMLCollection** 交给 tableToTsv（它自己 `Array.from`）—— 在组件里先 Array.isArray 判会整表变空（10-14 真机实测）");
ok(/if \(!text\) return false;/.test(mdSrc),
  "空表 / 取不到内容时返回 false ⇒ 不演成功（不假装复制了）");
/* ── ①b 代码块（10-14 二改：用户截图「上面没有，下面有了」—— 上面那块是围栏/代码块，不是表格） ── */
ok(/className="md-code-wrap"/.test(mdSrc) && /className="md-code-copy"/.test(mdSrc),
  "代码块（`MdCode`）也包进 .md-code-wrap + 挂复制按钮（表格与代码块是两种块，两种都要入口）");
ok(/window\.codex\.writeClipboard\(code\)/.test(mdSrc),
  "代码块复制的是**代码原文**（`code` 变量就在手上，不从 DOM 反推 —— 行号会混进 DOM 文本）");
ok(/<FeedbackIconButton[\s\S]{0,400}className="md-code-copy"[\s\S]{0,600}writeClipboard\(code\)/.test(mdSrc),
  "代码块的按钮同样**复用** FeedbackIconButton（同一套两段反馈，不许自造）");
ok(/\.markdown pre:has\(\.md-code-wrap\)\s*\{[\s\S]{0,60}position:\s*relative/.test(css),
  "代码块按钮锚在**外层 `pre`**（`:has` 规则）—— 锚在包裹层上，横向滚动时按钮会被一起滚出可视区");
/* ── ①c 无语言围栏（10-15 用户截图：「三块里就中间的没有」—— 中间那块正是 ``` 后**不写语言**的
   提交列表：上面/下面是表格、它是裸围栏） ── */
ok(/isBlockCode\(className, children\)/.test(mdSrc) && /from "\.\.\/\.\.\/lib\/md-code-block\.mjs"/.test(mdSrc),
  "判据走**纯函数模块** `lib/md-code-block.mjs`（组件内不许再内联同名表达式 —— 改一处漏一处）");
ok(!/Boolean\(className\) \|\|/.test(codeOnly(mdSrc)),
  "⛔ 负向：组件里不许内联 `Boolean(className) || …`（判据只此一份）");
ok(/if \(!isBlockCode\(className, children\)\) return <code \{\.\.\.props\}>\{children\}<\/code>;/.test(mdSrc),
  "提前 return 由 `isBlockCode` 把关 —— 不再是 `!className`（那会把裸围栏与行内 code 一起放走）");
ok(!/if \(!className\) return <code \{\.\.\.props\}/.test(codeOnly(mdSrc)),
  "⛔ 负向：`if (!className) return <code …` 不许复活（它就是把裸围栏的按钮漏掉的那一行；过 codeOnly 剥注释防假红）");
ok(/if \(!language\) \{[\s\S]{0,220}withCopy\(/.test(mdSrc) && /data-plain-code="1"/.test(mdSrc),
  "裸围栏走**纯文本 + 同一个 withCopy**（无语法可高亮，但复制入口必须在；样式复用 plainCodeStyles）");

/* ── ①d 判据真值表 + react-markdown **真跑**（判据若与 Markdown 解析器的实际行为脱钩，这里就红） ── */
ok(isBlockCode("", "line1\nline2\n") === true && isBlockCode("language-bash", "ls -la\n") === true
  && isBlockCode("", "   缩进块\n") === true,
  "真值表：裸围栏 / 带语言围栏 / 缩进代码块都判成**块级**（三者文本都以 \\n 结尾）");
ok(isBlockCode("", "行内代码") === false && isBlockCode(undefined, undefined) === false,
  "真值表：行内 code / 空串判成**行内**（不进 withCopy 分支）");
{
  const md = ["| a | b |", "|---|---|", "| 1 | 2 |", "", "```", "裸围栏第一行", "第二行", "```", "",
    "```bash", "ls -la", "```", "", "　　有 `行内` 与另一个 `x`。", "", "    缩进代码块"].join("\n");
  const seen = [];
  const stub = { code: (props) => { seen.push({ cls: props.className ?? "", text: String(props.children ?? "") }); return null; }, pre: (props) => props.children };
  renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], components: stub }, md));
  const blocks = seen.filter((n) => isBlockCode(n.cls, n.text));
  const inlines = seen.filter((n) => !isBlockCode(n.cls, n.text));
  ok(seen.length === 5 && blocks.length === 3 && inlines.length === 2,
    `真跑：三个块级形态（裸围栏 / 带语言围栏 / 缩进块）都判成块级、两处行内 code 判成行内（实测 ${seen.length} 个 code 节点 → 块级 ${blocks.length} / 行内 ${inlines.length}）`);
}

/* ── ② TSV 拼装：跑真实现（不是抄一份正则） ── */
const cell = (t) => ({ textContent: t });
ok(tableToTsv([{ cells: [cell("项"), cell("值")] }, { cells: [cell("甲"), cell("1")] }]) === "项\t值\n甲\t1",
  "真值表：单元格 Tab、行换行（贴进表格/文档就是一张表）");
ok(tableToTsv([{ cells: [cell("多\n行"), cell(" 空格  多  ")] }]) === "多 行\t空格 多",
  "真值表：单元格内换行/多空格压成单空格（内嵌换行会把 TSV 撕成两条记录）");
ok(tableToTsv([]) === "" && tableToTsv(null) === "" && tableToTsv([{ cells: [] }]) === "",
  "真值表：空表 / 坏入参 → 空串（调用方据此不演成功）");
ok(tableToTsv([{ cells: [{}, cell("x")] }]) === "\tx",
  "真值表：缺 textContent 的单元格当空串（不吐 undefined 字面量）");
// ⛔ 这条是**真机 bug 的原样复现**（10-14 实测：预览里点复制没反应，诊断标记 `empty-text`）：
//   真 DOM 的 `row.cells` / `table.rows` 都是 **HTMLCollection（类数组）**，不是 Array ——
//   用 `Array.isArray` 判会静默整表变空。这里喂类数组，实现里必须走 `Array.from`。
const arrayLike = (items) => ({ length: items.length, ...Object.fromEntries(items.map((v, i) => [i, v])) });
ok(tableToTsv(arrayLike([{ cells: arrayLike([cell("项"), cell("值")]) }])) === "项\t值",
  "真值表：rows / cells 是**类数组**（真 DOM 形态）也拼得出 TSV —— 用 Array.isArray 判会整表变空");

/* ── ③ CSS：位置 / 显隐 / 两段动画选择器 ── */
const ruleOf = (sel) => {
  const at = css.indexOf(`${sel} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};
const wrapRule = ruleOf(".md-table-wrap");
const btnRule = (() => {
  const at = css.indexOf(".md-table-copy,");
  const solo = css.indexOf(".md-table-copy {");
  const i = at >= 0 ? at : solo;
  return i < 0 ? "" : css.slice(i, css.indexOf("}", i));
})();
ok(/position:\s*relative/.test(wrapRule), "锚点容器 `.md-table-wrap` 是 relative（否则绝对定位的按钮跑到别处）");
ok(/position:\s*absolute/.test(btnRule) && /top:\s*\d+px/.test(btnRule) && /right:\s*\d+px/.test(btnRule),
  "按钮绝对定位在**右上角**（top/right 都给了值）");
// ⛔ 10-14 二改（用户口径「常驻且更醒目」）：**常驻可见**，不再 hover 才显形。
//   负向断言直接钉住"不许退回 dot 里的 hover-only 隐藏"——用户报「旧消息我没看见」就是它造成的。
ok(/background:\s*var\(--panel\)/.test(btnRule) && /border:\s*1px solid var\(--line\)/.test(btnRule),
  "常驻醒目：**不透明底色**（--panel）+ 明显边框（--line）—— 压在表头文字上也看得清");
ok(!/opacity:\s*0\s*;/.test(btnRule) && !/pointer-events:\s*none/.test(btnRule),
  "⛔ 不许退回 hover-only 隐藏（`opacity: 0` / `pointer-events: none` 都不许出现在默认态）");
ok(/\.md-table-copy:hover[\s\S]{0,120}\{[\s\S]{0,160}color:\s*var\(--text\)/.test(css),
  "悬停时配色加重（不是显隐开关）");
const doneBlock = css.slice(css.indexOf("两段反馈"), css.indexOf("@keyframes message-action-pop"));
ok(/\.md-table-copy\[data-phase="done"\]/.test(doneBlock) && /\.md-code-copy\[data-phase="done"\]/.test(doneBlock),
  "两段动画的 `[data-phase=\"done\"]` 选择器**两个按钮都带上了**（表格 + 代码块，漏一个就只有变色没有弹动）");
const reduceBlock = css.slice(css.indexOf("prefers-reduced-motion"), css.indexOf("prefers-reduced-motion") + 600);
ok(/\.md-table-copy\[data-phase="done"\]/.test(reduceBlock) && /\.md-code-copy\[data-phase="done"\]/.test(reduceBlock),
  "减弱动效里两个按钮也都列了（关掉弹动但保留对勾与颜色 —— 反馈是信息、动效才是装饰）");

/* ── ④ 验收项登记（新增项必须登记轮次，否则默认轮跑不到） ── */
ok(/id:\s*"md-block-copy"/.test(acceptSrc) && /"md-block-copy":\s*"10-12"/.test(acceptSrc),
  "验收项 `md-block-copy` 已建并登记进 ROUND_OF（默认轮跑得到）");

console.log(fails ? `\n【md-block-copy】${checks} 条断言 / ${fails} 条失败` : `\n【md-block-copy】${checks} 条断言全部通过`);
process.exit(fails ? 1 : 0);
