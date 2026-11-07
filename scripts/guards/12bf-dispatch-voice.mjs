/**
 * 调度提示词必须说人话（11-07 用户令，两次）
 *
 * 用户原话：
 *   「专家团的调度会话，提示词，太生硬了，跟机器人一样的，转述，都不会转述，
 *     所以调度提示词，看看，说人话不行吗，简单一点」
 *   「还说什么 @image#1:Clipboard_Screenshot.png，你看看这种词，跟傻逼一样的」
 *   「就好比人与人之间沟通，需要这么废话和多余的垃圾赘述吗」
 *
 * 真根因（不是模型笨，是我们教的）：宿主给被调度方拼的每一段话都是**规格书** ——
 * `【群聊直接发言】`、`# 调度权限`、「要求：1. 2. 3.」、`⛔` 满屏。模型是极强的文体模仿器，
 * 它照着这个腔回写给成员，于是每次派活都变成一张需求清单。
 *
 * 本守卫盯四件事（⛔ 不是"有没有这个词"，而是"还会不会教坏模型"）：
 *   ① 文案唯一源 `src/lib/dispatch-voice.mjs` 的四段话：无 emoji / 无 `**` / 无 `【】` /
 *      无「要求：」清单，且够短（每段 ≤ 120 字 —— 用户要的是"人与人说话"的密度）；
 *   ② 转述必须有**正例**（只给禁令时模型会退化成"原话 + 要求清单"）；
 *   ③ 机器标记（`@image#1:…` / `[图片:…]` / `[文件:…]`）在进提示词前翻成人话；
 *   ④ 四处壳（团队 / 成员 / 子会话 / 群成员）都**引用**它，且旧规格书文案不许回流。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GROUP_MEMBER_NOTE, HANDOFF_STYLE_NOTE, LEAD_TASK_NOTE, MEMBER_TASK_NOTE, SUBCONV_NOTE, humanizeRefs,
} from "../../src/lib/dispatch-voice.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
/** 剥注释：负向结构断言不能因为"注释里引用了旧文案"而红。 */
const codeOnly = (source) => String(source)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【voice】${message}`);
  if (!condition) fails++;
};

/* ── ① 四段话的密度与文体 ── */
{
  const texts = {
    主理人: LEAD_TASK_NOTE,
    团成员: MEMBER_TASK_NOTE,
    子会话: SUBCONV_NOTE,
    群成员: GROUP_MEMBER_NOTE,
  };
  for (const [label, text] of Object.entries(texts)) {
    ok(typeof text === "string" && text.trim().length > 0, `${label}：有文案`);
    ok(!/⛔|⚠️|✅|❌/u.test(text), `⛔ ${label}：不许带 emoji 符号（模型会照抄进正文）`);
    ok(!/\*\*/.test(text), `⛔ ${label}：不许用 ** 加粗当强调（同上）`);
    ok(!/【[^】]*】/.test(text), `⛔ ${label}：不许用【】标签（用户截图里那句就是这种）`);
    ok(!/^\s*要求[:：]/m.test(text) && !/要求[:：]\s*1[.、]/.test(text), `⛔ ${label}：不许列「要求：1. 2. 3.」清单`);
    ok(text.length <= 120, `${label}：够短（${text.length} ≤ 120 字；用户：「需要这么废话和多余的垃圾赘述吗」）`);
  }
  ok(/没有调度权限/.test(MEMBER_TASK_NOTE) && /没有调度权限/.test(GROUP_MEMBER_NOTE),
    "「没有调度权限」这句必须留（11f 按它判零调度权限，别为了口语把它删了）");
  ok(/结论|产出/.test(MEMBER_TASK_NOTE) && /结论|产出/.test(SUBCONV_NOTE),
    "两段都还要求「给结论/产出」（口语化不许把任务目标说丢）");
}

/* ── ② 转述要有正例（用户：「转述都不会转述」） ── */
{
  ok(/例[:：]/.test(HANDOFF_STYLE_NOTE), "转述说明带一条**正例**（只给禁令时模型会写成需求清单）");
  ok(/别列|不要列/.test(HANDOFF_STYLE_NOTE), "明说不许列「要求：1. 2. 3.」");
  ok(/一张图（文件名）/.test(HANDOFF_STYLE_NOTE), "图片写法给了人话模板");
  ok(!/⛔/.test(HANDOFF_STYLE_NOTE) && HANDOFF_STYLE_NOTE.length <= 160,
    `转述说明够短（${HANDOFF_STYLE_NOTE.length} ≤ 160 字）`);
}

/* ── ③ 机器标记 → 人话（用户点名的 @image#1） ── */
{
  const cases = [
    ["@image#1:Clipboard_Screenshot.png", "一张图（Clipboard_Screenshot.png）"],
    ["看看@image#2:报价单.xlsx对不对", "看看一张图（报价单.xlsx）对不对"],
    ["@image#1", "一张图"],
    ["[图片:C%3A%5Cshot%5CClipboard_Screenshot.png]", "一张图（Clipboard_Screenshot.png）"],
    ["[文件:C%3A%5Cdata%5C销量.xlsx]", "文件（销量.xlsx）：C:\\data\\销量.xlsx"],
    ["普通正文，一个字都不该动。", "普通正文，一个字都不该动。"],
  ];
  for (const [input, expect] of cases) {
    const got = humanizeRefs(input);
    ok(got === expect, `humanize(${JSON.stringify(input)}) ⇒ ${JSON.stringify(expect)}（实得 ${JSON.stringify(got)}）`);
  }
  ok(humanizeRefs("@image#1:a.png 和 [图片:b.png]") === "一张图（a.png） 和 一张图（b.png）",
    "一条消息里多个标记全换（⛔ 别只换第一个）");
  ok(humanizeRefs(null) === "" && humanizeRefs(undefined) === "", "脏值不炸（null/undefined → 空串）");
}

/* ── ④ 四处壳都引用唯一源，且旧规格书不许回流 ── */
{
  const voice = read("src/lib/dispatch-voice.mjs");
  ok(/export const LEAD_TASK_NOTE/.test(voice) && /export const MEMBER_TASK_NOTE/.test(voice)
    && /export const SUBCONV_NOTE/.test(voice) && /export const GROUP_MEMBER_NOTE/.test(voice)
    && /export function humanizeRefs/.test(voice),
    "四段话 + 人话化函数都在 dispatch-voice 一处");

  const sites = [
    ["electron/features/teams-ipc.ts", "团队 / 成员会话", /MEMBER_TASK_NOTE|LEAD_TASK_NOTE/, /humanizeRefs\(/],
    ["electron/team-invoke.ts", "主理人派成员", /MEMBER_TASK_NOTE/, /humanizeRefs\(/],
    ["electron/features/delegation.ts", "调度会话", /SUBCONV_NOTE/, /humanizeRefs\(/],
    ["electron/boss-groups/runner.ts", "群成员", /GROUP_MEMBER_NOTE/, /humanizeRefs\(|task\.brief/],
  ];
  for (const [file, label, noteRe, refRe] of sites) {
    const src = codeOnly(read(file));
    ok(/from "[./]*src\/lib\/dispatch-voice\.mjs"/.test(src), `${label}：从 dispatch-voice 取文案（⛔ 不许内联长段中文）`);
    ok(noteRe.test(src), `${label}：真的用上了那段话`);
    ok(refRe.test(src), `${label}：用户任务文本过 humanizeRefs（图片标记不许原样进提示词）`);
  }

  /* 旧规格书：⛔ 一个字都不许回流 —— 它们是用户截图里那个腔调的来源 */
  const oldSpecs = [
    ["按 SOP 编排团队", "electron/features/teams-ipc.ts"],
    ["请以你的角色直接回应用户上方提交的需求", "electron/features/teams-ipc.ts"],
    ["请直接给出你的专业产出（关键结论 + 依据 + 建议）", "electron/team-invoke.ts"],
    ["直接执行上面的任务并给出最终产出", "electron/features/delegation.ts"],
    ["# 调度权限", "electron/boss-groups/runner.ts"],
    ["【浏览器】", "electron/boss-groups/runner.ts"],
  ];
  for (const [phrase, file] of oldSpecs) {
    ok(!codeOnly(read(file)).includes(phrase), `⛔ ${file} 里不再有规格书原句「${phrase}」`);
  }
}

/* ── ⑤ 群上下文块也不许带 ⛔ 与「要求：」清单（它每轮都贴在需求前面） ── */
{
  const models = read("src/lib/team-models.mjs");
  /* ⛔ 必须剥注释：那个函数里有大段说明（「⛔ 11-07 用户令…」），
     不剥的话断言永远红 —— 而"注释里写禁止"恰恰是这个项目最常见的假象之一。
     ⛔ 切片**不能**按结束信封那句收尾：说明注释里也提到了它，会从注释中间切断，
       注释的收尾符号不在片里 ⇒ 剥不掉 ⇒ 假红。按函数体的收尾大括号切。 */
  const start = models.indexOf("export function groupContextBlock");
  const end = models.indexOf("\n}", start);
  const fn = codeOnly(models.slice(start, end));
  ok(!/⛔/u.test(fn), "groupContextBlock 的注入正文里没有 ⛔（注释可以说明，正文不许带）");
  ok(!/【群聊上下文 · [^】]*】[\s\S]{0,400}?要求[:：]\s*1/.test(fn), "群上下文里没有「要求：1.」清单");
  ok(/【群聊上下文 · /.test(models) && /【群聊上下文结束】/.test(models),
    "信封标记一个字不动（harness-block-strip / user-refs / cloud-sync 按它剥离）");
  ok(/成员做完会自己把结果发进群/.test(models), "主理人那句改成了人话，但语义还在（别替成员复述）");
}

console.log(`\n【voice】${checks - fails}/${checks} 通过`);
process.exit(fails ? 1 : 0);
