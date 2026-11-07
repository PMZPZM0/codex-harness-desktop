/**
 * 调度提示词的**说话方式** · 单一真相源（11-07 用户令）
 *
 * 用户原话：
 *   「专家团的调度会话，提示词，太生硬了，跟机器人一样的，转述，都不会转述，
 *     所以调度提示词，看看，说人话不行吗，简单一点」
 *   「你看看这种词（@image#1:Clipboard_Screenshot.png），跟傻逼一样的」
 *
 * 真根因（不是模型笨，是我们教的）：
 *   ① 宿主给被调度方拼的每一段话都是**公文腔** —— `【群聊直接发言】`、`# 调度权限`、
 *      「要求：- 1. 2. 3.」、`⛔` 满屏。模型是极强的文体模仿器：它看到什么腔调，
 *      回写给别人时就用什么腔调 ⇒ 主理人写给成员的任务立刻变成一张"需求规格书"。
 *   ② 我们从来没示范过**怎么转述**：只说了「不要复述成员原文」，没说「该怎么说」。
 *   ③ 用户消息里的图片/附件是机器标记（`@image#1:clip.png`、`[图片:<enc>]`），
 *      原样搬进提示词 ⇒ 模型照着抄进正文，人读到就是一串天书。
 *
 * 所以这里只做三件事，全部是"人话"层，⛔ 不动结构性分隔符：
 *   · `LEAD_TASK_NOTE` / `MEMBER_TASK_NOTE` / `SUBCONV_NOTE` / `GROUP_MEMBER_NOTE`：
 *     给主理人 / 团成员 / 子会话 / 群成员的四段话，短句、口语、无 emoji、不列"要求：清单"；
 *   · `HANDOFF_STYLE_NOTE`：把「怎么转述」示范出来（用户说"转述都不会转述"就是缺这一句）；
 *   · `humanizeRefs`：把机器标记翻成人话（图片 / 文件），派活前统一过一遍。
 *
 * ⛔ 结构性分隔符（`[SYSTEM TASK · …]`、`=== 用户需求 ===`、`=== END ===`、
 *    `【群聊上下文 · …】…【群聊上下文结束】`）**保持原样**：`user-refs.ts` /
 *    `harness-block-strip.mjs` / `rollout-worker-source.ts` / `thread-backup.ts` 都在解析它们，
 *    改一个字就会让老会话的壳漏进气泡。用户看不到它们（展示前已剥离），所以它们不算"生硬"。
 *
 * ⛔ 纯函数、零依赖；类型在 `dispatch-voice.d.mts`。守卫 `scripts/guards/12bf-dispatch-voice.mjs`。
 */

/* ── 四段"跟被调度方说的话" ─────────────────────────────────────────────
   ⛔ 密度标准（11-07 用户第二次点名：「人与人之间沟通，需要这么废话和多余的垃圾赘述吗」）：
   每段最多两句，只留"现在该干什么"和"边界是什么"；理由、背景、为什么要这样，全留在本文件的
   注释里，⛔ 不写进提示词。模型不需要被说服，它需要被交代。 */

/** 专家团主理人（团队会话）。需求前端已确认过，不再重复确认。 */
export const LEAD_TASK_NOTE = "需求已确认，直接开工。能并行的就一次派出去，只有一件就单独叫人；每做完一段在群里说一句。收尾给结论和下一步，成员的产出他们自己会发进群。";

/** 专家团成员（主理人派活 / 成员直达会话）。 */
export const MEMBER_TASK_NOTE = "需求在上面，直接按你的专业给结论：结论、依据、建议。你是团里的成员，没有调度权限，也别跟用户说你能调人。";

/** 普通被调度方（专家 / 子智能体 / CLI）。 */
export const SUBCONV_NOTE = "直接做，给结论、依据、建议。你的回答会完整转给发起方，不用调回传工具。";

/** 中枢群的群成员（一句话）。 */
export const GROUP_MEMBER_NOTE = "你是子会话，没有调度权限，别调 agent_invoke；要协作就写在产出里交给上级。";

/* ── 怎么转述（用户："转述，都不会转述"）────────────────────────────────
   ⛔ 只给负例（"别复述"）时模型会退化成：原话整段贴过去 + 自己加一套「要求：1.2.3.」清单
   —— 正是用户截图里那段东西。一条短正例比三条禁止更管用。 */

export const HANDOFF_STYLE_NOTE = "交代事情用自己的话说清「要他做什么、做到什么算完」，别把原话整段搬过去，也别列「要求：1. 2. 3.」。\n例：用户说「让他们在群里回复我」，就写「在群里回潘总一句，说说你能帮他做什么」。图写成「一张图（文件名）」。";

/* ── 机器标记 → 人话 ────────────────────────────────────────────────────── */

const FILE_NAME_RE = /[\\/]([^\\/]+)$/;

function basenameOf(path) {
  const raw = String(path ?? "");
  const hit = raw.match(FILE_NAME_RE);
  return (hit ? hit[1] : raw).trim();
}

function decodeSafe(text) {
  try { return decodeURIComponent(text); } catch { return text; }
}

/**
 * 只留"像文件名的那一段"。
 * ⛔ 为什么需要：`@image#1:报价单.xlsx对不对` 这种（标记后面直接跟正文，中间没有空格）——
 *    贪婪匹配会把「对不对」一起吃进括号里，读起来更蠢。按扩展名截断最稳。
 */
function trimToFileName(raw) {
  const text = String(raw ?? "");
  const hit = text.match(/^.*?\.[A-Za-z0-9]{2,5}/);
  return hit ? hit[0] : text;
}

/**
 * 把提示词里的机器标记翻成人话。
 * · `@image#1:Clipboard_Screenshot.png` → `一张图（Clipboard_Screenshot.png）`
 * · `[图片:<enc path>]` → `一张图（Clipboard_Screenshot.png）`
 * · `[文件:<enc path>]` → `文件（报表.xlsx）`（带绝对路径，读文件时还得用它）
 * · 其余原样返回（⛔ 不碰正文：用户自己的措辞一个字都不改）
 */
export function humanizeRefs(text) {
  let out = String(text ?? "");
  /* @image#N:name / @file#N:name —— 有些客户端与图片 part 会这么标注。
     ⛔ 名字优先按**扩展名**截断（非贪婪到第一个 .ext），否则「报价单.xlsx对不对」会把
        后面那句话一起吞进括号里。没扩展名时才退化成"到空白/标点为止"。 */
  const NAME = String.raw`(?:[^\s，。；、（）()\[\]【】]*?\.[A-Za-z0-9]{2,5}|[^\s，。；、（）()\[\]【】]+)`;
  out = out.replace(new RegExp(String.raw`@image#\d+\s*[:：]\s*${NAME}`, "g"), (m) => `一张图（${trimToFileName(basenameOf(m.replace(/^@image#\d+\s*[:：]\s*/, "")))}）`);
  out = out.replace(new RegExp(String.raw`@file#\d+\s*[:：]\s*${NAME}`, "g"), (m) => `文件（${trimToFileName(basenameOf(m.replace(/^@file#\d+\s*[:：]\s*/, "")))}）`);
  out = out.replace(/@image#\d+/g, "一张图");
  out = out.replace(/@file#\d+/g, "一个文件");
  /* 输入框附件占位符（composer-attachments.mjs 的格式，路径是 encodeURIComponent 过的） */
  out = out.replace(/\[图片:([^\]]+)\]/g, (_m, enc) => `一张图（${basenameOf(decodeSafe(enc))}）`);
  out = out.replace(/\[文件:([^\]]+)\]/g, (_m, enc) => {
    const path = decodeSafe(enc);
    return `文件（${basenameOf(path)}）：${path}`;
  });
  return out;
}
