/**
 * 回合「没干完就收工」检测（10-12 用户报障「运行过程总是自动中断」，拍板走「宿主自动接手」）。
 *
 * ⛔⛔ 证据（会话 01a12e1b 的 rollout，逐行核过，不是推断）：
 *   · 那个会话 5 个回合**全部是引擎正常 `task_complete`**，零 abort / interrupted 记录，
 *     宿主侧也没有任何人发过 `turn/interrupt` ⇒ **不是崩溃、不是被打断**。
 *   · 真机制是引擎的**回合语义**：一条回复里**没有工具调用 = 回合完成、控制权交还用户**。
 *     5 个回合里有 4 个的**末条正文只是「宣布下一步」**：
 *       「读它的快照，同时再抓机器之心。」/「改串行重跑。」/「继续串行压浏览器通道。」/「验证一下。」
 *     ⇒ 模型把"说出计划"当成了"干完了"，用户看到的就是"跑到一半自己断了"。
 *   · 唯一**正常收尾**的那个回合，末句是**问用户的问句**（「要不要我给你挂个每日早报？」回「挂」我就建）。
 *   · 另一个客观痕迹：本回合**最后一次工具输出**是引擎的半截标记
 *     （`Process running with session ID 59332` / `write_stdin failed: stdin is closed …`）——
 *     长命令还没跑完 / 剩余输出没读到，模型却收工了（同轮实测两次）。
 *
 * 本模块只做**判定与文案**（纯函数、无副作用）：可被 `scripts/check-preflight.mjs` 的守卫
 * 直接 import 跑真值表 —— 判定这种东西不许靠"读代码觉得对"。
 * ⛔ 判定一律**保守**：宁可漏判（维持现状）也绝不误判 —— 误判的代价是应用**替用户多发一个回合**
 *   （烧 token + 打断用户节奏），而漏判只是没帮忙。
 * ⛔ 自动续跑的闸（同会话 15 分钟最多 2 次 / 只对当前会话 / 空闲才发 / 手动停止不触发）在调用方，
 *   与既有「截断自动续接」共用同一套 `autoContinueLogRef` 记账。
 */
import { stripVoiceScript } from "./voice-script.mjs";

/** 工具类 item 的输出字段（引擎点名的三种形态：commandExecution / functionCallOutput / mcp 类）。 */
function toolOutputOf(item) {
  if (!item || typeof item !== "object") return "";
  const type = String(item.type ?? "");
  if (
    type !== "commandExecution" &&
    type !== "functionCallOutput" &&
    type !== "mcpToolCall" &&
    type !== "dynamicToolCall" &&
    type !== "subagentActivity"
  ) return "";
  const value = item.aggregatedOutput ?? item.output ?? item.text ?? "";
  return typeof value === "string" ? value : "";
}

/** 末条 assistant 正文（⛔ 先剥 `voice` 播报块：那是给耳朵的收尾稿，不是模型的工作计划；
 *  实证——唯一正常收尾的那个回合，播报块里正是一句问用户的话）。 */
export function lastAssistantText(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item || typeof item !== "object") continue;
    const type = String(item.type ?? "");
    if (type !== "agentMessage" && type !== "message") continue;
    const text =
      typeof item.text === "string"
        ? item.text
        : Array.isArray(item.content)
          ? item.content.map((part) => (part && typeof part.text === "string" ? part.text : "")).join("")
          : "";
    return stripVoiceScript(text).trim();
  }
  return "";
}

/** 本回合**最后一次**工具输出（用户："长命令拿半截输出就收工"那一类看它）。 */
export function lastToolOutput(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const text = toolOutputOf(items[i]);
    if (text.trim()) return text;
  }
  return "";
}

/** 引擎「命令还在跑 / 剩余输出读不回来」的原文标记（⛔ 逐字取自引擎实测输出，别改写成同义句）。 */
export const PARTIAL_OUTPUT_MARKERS = [
  /Process running with session ID/i,
  /write_stdin failed: stdin is closed/i,
];

/** 「宣布下一步」的意图词（续做 / 重做 / 补做）。
 *  ⛔⛔ 10-12 15:51 补词实证：模型写的是「**换成** CSS selector **再试**」—— 两个词都不在原词表里
 *    （原表只有 重试/再跑/重跑），于是 intent 判定落空 ⇒ 漏判（用户再报"还在自动断"）。 */
const INTENT_LEAD = /(继续|接着|接下来|下一步|随后|稍后|马上|立刻|这就|再去|再抓|再看|再读|再查|再跑|再试|重跑|重试|重新跑|重新来|换成|改成|改为|补齐|跟进|往下|照着)/;
/** 「…一下 / …一次」式收尾（「验证一下。」「再核对一遍。」）——必须带动作词才算，光「一下」不算。 */
const INTENT_ONCE = /(一下|一次|一遍)$/;
const ACTION_WORD = /(验证|确认|核对|复现|检查|排查|看|读|试|跑|抓|测|查|修|改|补|清理|重装|再建)/;
/** 问用户的话 = 正常收尾，不是"没干完"（实证：唯一正常收尾的回合末句就是问句）。 */
const ASK_TAIL = /[？?]\s*$|(吗|呢)\s*[。！!]?\s*$|(要不要|是不是|行不行|可以吗|请你|你来|你选|你定|请确认|需要我)/;
/** 明确的收尾语（用户自己要求结束/等用户），别自作多情去续跑。 */
const CLOSER = /(先这样|就这样|先到这儿|先到这|回头再|明天再|等你|待你|静候|随时叫我)/;
/** ⛔⛔ 10-12 15:51 漏判实录（这次判定的真正来源）：模型末条正文是
 *   「ref 不能跨进程复用（CLI 每次调用是新连接）—— 换成 CSS selector 再试。**这是个关键坑。**」
 *   —— 宣布下一步在**倒数第二句**，末句是一句无关的评价 ⇒ 只看末句的旧写法漏判（用户又报"还在自动断"）。
 *   ⇒ 回看末 3 句。但**放宽必须有护栏**：下面 DONE_MARKERS 先拦掉"已完成 + 建议…"这类结论，
 *   否则「已完成。下次建议重试。」会被 INTENT_LEAD 的「重试」误判 ⇒ 替用户多发回合（比漏判更糟）。 */
const DONE_MARKERS = /(已完成|做完了|完成了|已修复|修好了|搞定|全部完成|任务完成|收工|交付完成|已改|已换|已替换|已更新)/;
/** 回看几句（末句 + 往前 2 句）。再多就容易把结论里的"建议"当成计划。 */
const LOOKBACK_SENTENCES = 3;

/** 末句是不是「宣布下一步」式收尾（不含问句、不含明确收尾语）。 */
export function isPromiseEnding(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  // ⛔ 三道护栏都在**全篇**上判（旧的只在末句判）：任一命中就当"正常收尾"，宁可漏判不误判。
  if (DONE_MARKERS.test(raw)) return false;   // 已完成/搞定 + 后面再建议什么，都不算没干完
  if (ASK_TAIL.test(raw) || CLOSER.test(raw)) return false; // 在问用户 / 用户要求停 ⇒ 不该替他续
  // ⛔ 只切 。！!；;\n（**不切 ？**）—— 问号要留在句子里给 ASK_TAIL 判。
  const parts = raw.split(/[。！!；;\n]+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return false;
  // 从末句往前回看 LOOKBACK_SENTENCES 句，命中即判「宣布下一步」
  for (let i = parts.length - 1, seen = 0; i >= 0 && seen < LOOKBACK_SENTENCES; i -= 1, seen += 1) {
    const sentence = parts[i];
    // 末句带第二人称（「你继续用吧」）= 在跟用户说话，不是"我还要接着干"；逐句各判各的
    if (/(你|您)/.test(sentence)) continue;
    if (INTENT_LEAD.test(sentence)) return true;
    if (INTENT_ONCE.test(sentence) && ACTION_WORD.test(sentence)) return true;
  }
  return false;
}

/**
 * 本回合「没干完」的原因。返回空串 = 干完了（或不判）。
 *   `promise` = 末条正文只宣布了下一步、没发任何工具调用；
 *   `partial-command` = 最后一次工具输出是引擎的半截标记（命令还在跑 / 剩余输出没读到）。
 * ⛔ 顺序有意义：正文形态是**直接成因**，先报它。
 */
export function unfinishedTurnReason(turn) {
  const text = lastAssistantText(turn);
  if (isPromiseEnding(text)) return "promise";
  const output = lastToolOutput(turn);
  if (output && PARTIAL_OUTPUT_MARKERS.some((re) => re.test(output))) return "partial-command";
  return "";
}

/** 给用户看的提示条（说明发生了什么 + 应用已经接手）。 */
export function unfinishedNotice(reason) {
  if (reason === "partial-command") {
    return "上一条回复收工时，那条长命令还在跑、剩余输出没读回来（引擎原话 Process running with session ID）。已自动接着推进 —— 若反复出现，让 Codex 把长命令的输出重定向到文件再读。";
  }
  return "上一条回复只是说了下一步要做什么、没有真的去做，引擎就把这一回合判为结束了（看着像「跑到一半自己断了」）。应用已自动补一条让它接着执行。";
}

/** 自动补发的那条指令：**承接执行**语义 —— 别再复述计划，直接做。
 *  ⛔ 顺带把长命令的正确姿势写进去（实测触发因素）：超过等待窗口的命令要重开或落文件，
 *  别把半截输出当结果。 */
export function unfinishedContinuePrompt(reason) {
  if (reason === "partial-command") {
    return "（自动续接）你上一条回复收工时，那条命令**还在跑**（引擎提示 Process running with session ID …），剩余输出你并没有读到，这一步并没有做完。请现在把它跑完：重新执行并把输出**重定向到文件**后再读取（PowerShell: Start-Process -FilePath <exe> -ArgumentList <args> -RedirectStandardOutput out.txt -RedirectStandardError err.txt -PassThru，之后 Get-Content out.txt -Tail 40），或带 tty=true 重开该会话再读；读到结束标记或退出码为止。⛔ 不要复述计划、不要再解释一遍，直接做。";
  }
  return "（自动续接）你上一条回复**只是宣布了下一步要做什么、并没有发出任何工具调用**，引擎因此把这一回合判为结束、把控制权交还给了用户 —— 用户看到的就是「任务跑到一半自己断了」。请**立刻执行**你刚才说要做的下一步（不要复述计划、不要解释、不要道歉），把它做完再说别的。⛔ 如果那一步是长命令：把输出重定向到文件后再读，别把半截输出当结果。";
}
