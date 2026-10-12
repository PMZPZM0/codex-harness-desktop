/**
 * 回合「没干完就收工」→ 宿主自动接手 的判据（10-12 立）。
 *
 * 用户报障：「这个运行过程总是自动中断」（截图 + 会话 01a12e1b）。
 * 真机取证（该会话 rollout 逐行核过，不是推断）：5 个回合**全部是引擎正常 `task_complete`**、
 * 零 abort/interrupted；宿主侧也没有任何人发过 `turn/interrupt` —— **不是崩溃、不是被打断**。
 * 真机制是引擎的回合语义：一条回复里**没有工具调用 = 回合完成、控制权交还用户**，而那 4 个
 * 「断掉」的回合末条正文都只是一句「宣布下一步」（「继续…」「重跑…」「验证一下。」）。
 * 唯一**正常收尾**的那个回合末句是**问用户的问句**。
 *
 * 判据是**纯函数**（`src/lib/turn-unfinished.mjs`），本守卫跑真值表 + 钉接线形态。
 * ⛔ 误判的代价是「应用替用户多发一个回合」（烧 token + 打断用户节奏）⇒ 真值表里**正常收尾
 *    一条都不许判真**，这是本文件最重要的断言。
 * ⛔ 独立守卫（不进 check-preflight 的 checks 计数），与 11y/11z/12* 同款：新断言一律自成一个
 *    文件，不许把 07-turn-fold 那种在册大文件继续撑长（守卫【265】行数棘轮只许缩不许长）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isPromiseEnding, lastAssistantText, unfinishedContinuePrompt, unfinishedNotice, unfinishedTurnReason } from "../../src/lib/turn-unfinished.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【turn-unfinished】${message}`);
  if (!condition) fails++;
};

const unfSrc = read("src/lib/turn-unfinished.mjs");
const appSrc = [
  read("src/features/app-state/parts/part05/event-router/07-turn-completed-settle.tsx"),
  read("src/features/app-state/parts/part04/03-seg/02-browser-queue-settings.tsx"),
].join("\n");

/* ── ① 判真：用户报障的 4 个「宣布下一步」原始形态（逐字取自 rollout） ── */
ok(isPromiseEnding("读它的快照，同时再抓机器之心。"), "判真：「读它的快照，同时再抓机器之心。」（rollout 实证）");
ok(isPromiseEnding("关键发现：并行会撞互斥锁，必须串行。改串行重跑。"), "判真：「…必须串行。改串行重跑。」（rollout 实证）");
ok(isPromiseEnding("两条都活了；browser_navigate 也通了。继续串行压浏览器通道。"), "判真：「…继续串行压浏览器通道。」（rollout 实证）");
ok(isPromiseEnding("标签页有猫腻：活动 tab 是 about:blank，页面在 tab 1 —— 这大概就是快照空的原因。验证一下。"), "判真：「…验证一下。」（rollout 实证）");

/* ── ② 判假：正常收尾一条都不许判真（误判 = 替用户多发一个回合） ── */
ok(!isPromiseEnding("⏭️ **下一步**：要不要我给你挂个每天早上 9 点的 AI 早报？回「挂」我就建。"),
  "判假：问用户的收尾（实证：唯一正常收尾的回合末句就是问句）");
ok(!isPromiseEnding("好了，都做完了。"), "判假：明确的完成结论");
ok(!isPromiseEnding("这样就可以了，你继续用吧。"), "判假：在跟用户说话（末句含第二人称）");
ok(!isPromiseEnding("先这样，剩下的明天再继续。"), "判假：明确的收尾语（用户要求结束/等用户）");
ok(!isPromiseEnding("我先把结论给出来：这套方案可行。"), "判假：把结论说完了（不是「宣布下一步」）");
ok(!isPromiseEnding("") && !isPromiseEnding(undefined), "判假：空正文");

/* ── ③ 整条判据（含「长命令只剩半截输出」那一路） ── */
const turnPromise = { items: [
  { type: "userMessage", id: "u1" },
  { type: "reasoning", id: "r1", summary: [{ text: "想一下" }] },
  { type: "agentMessage", id: "a1", text: "标签页有猫腻：活动 tab 是 about:blank。验证一下。" },
]};
const turnPartial = { items: [
  { type: "agentMessage", id: "a0", text: "先发一批命令。" },
  { type: "commandExecution", id: "c1", command: "nuphus-call browser_snapshot", aggregatedOutput: "Wall time: 20.0081 seconds\nProcess running with session ID 59332\nOutput:" },
  { type: "agentMessage", id: "a1", text: "标签页那边返回的是空的。" },
]};
const turnDone = { items: [
  { type: "agentMessage", id: "a1", text: "📰 最近 AI 新闻\n\n⏭️ 下一步：要不要我给你挂个每日早报？回「挂」我就建。" },
  { type: "commandExecution", id: "c1", aggregatedOutput: "Chunk ID: aeec21\nProcess exited with code 0\nOutput:\n OK" },
]};
// ⛔ 收尾的 `voice` 播报块必须**先剥掉**再判（那是给耳朵的稿，不是工作计划；实证：正常收尾那个
//    回合的播报块里正是一句问用户的话）。下面第一条用例**只在剥了块之后才判真**（不剥的话末段
//    会落在围栏上 ⇒ 判假）⇒ 变异测试能抓「忘了剥」。
const turnVoiceBody = { items: [
  { type: "agentMessage", id: "a1", text: "验证一下。\n\n```voice\n好了，就这些。\n```" },
]};
const turnVoiceOnly = { items: [
  { type: "agentMessage", id: "a1", text: "都做完了，这是结果。\n\n```voice\n我接着去核对一遍。\n```" },
]};
ok(unfinishedTurnReason(turnPromise) === "promise", "整条判据：只宣布下一步 ⇒ promise");
ok(unfinishedTurnReason(turnPartial) === "partial-command", "整条判据：最后一次工具输出是引擎的半截标记 ⇒ partial-command");
ok(unfinishedTurnReason(turnDone) === "", "整条判据：正常收尾（问用户 + 命令正常退出）⇒ 不判");
ok(unfinishedTurnReason(turnVoiceBody) === "promise", "播报块不参与判定：正文说「验证一下」+ 收尾稿干净 ⇒ 仍判 promise");
ok(unfinishedTurnReason(turnVoiceOnly) === "", "收尾稿里的承诺不算工作计划：正文是完成结论 ⇒ 不判");
ok(lastAssistantText({ items: [{ type: "userMessage", id: "u1", content: [{ type: "text", text: "hi" }] }] }) === "",
  "没有 assistant 正文时取空串（用户消息不是模型的工作计划）");
ok(/Process running with session ID/.test(unfSrc), "半截标记**逐字**取自引擎输出（Process running with session ID），别改写成同义句");

/* ── ④ 接线与闸（判定在 lib、触发在回合收尾、投递复用既有续接管道） ── */
ok(/unfinishedTurnReason\(localTurn \?\? params\.turn\)/.test(appSrc) && /bag\.maybeAutoContinueUnfinished\(/.test(appSrc),
  "回合收尾时用 unfinishedTurnReason 判定并触发自动接手");
ok(/else if \(!wasManualStop && !params\.turn\.error\?\.message\)/.test(appSrc),
  "手动停止的回合 / 失败的回合都不自动接手（同截断续接的理由）");
ok(/const isPlanTurn = Boolean\(bag\.planTurnRef\.current && bag\.planTurnRef\.current\.turnId === String\(params\.turn\?\.id/.test(appSrc)
  && /const reason = isPlanTurn \? "" : unfinishedTurnReason/.test(appSrc),
  "方案回合不自动接手（它本来就该停在「等用户确认执行」，替它续跑 = 抢用户点确认）");
ok((() => {
  const body = appSrc.slice(appSrc.indexOf("function maybeAutoContinueUnfinished"), appSrc.indexOf("bag.maybeAutoContinueUnfinished ="));
  return body.includes("autoContinueLogRef") && body.includes("AUTO_CONTINUE_MAX_ATTEMPTS");
})(), "自动接手与截断续接**共用同一份记账**（同会话窗口内合计次数上限，防「续了又停」滚雪球烧钱）");
ok(/不要复述计划/.test(unfinishedContinuePrompt("promise")) && /立刻执行/.test(unfinishedContinuePrompt("promise")),
  "补发的指令是「立刻执行」语义（复述计划 = 又一轮空转）");
ok(/RedirectStandardOutput|重定向到文件/.test(unfinishedContinuePrompt("partial-command")),
  "长命令那一路把正确姿势写进指令（输出重定向到文件再读，别把半截输出当结果）");
ok(/上一条回复/.test(unfinishedNotice("promise")) && /上一条回复/.test(unfinishedNotice("partial-command")),
  "两种原因都有面向用户的提示文案（不能静默替用户发消息）");

console.log(fails ? `\n【turn-unfinished】${checks} 条断言 / ${fails} 条失败` : `\n【turn-unfinished】${checks} 条断言全部通过`);
process.exit(fails ? 1 : 0);
