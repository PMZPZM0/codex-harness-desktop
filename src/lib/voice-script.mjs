/**
 * 「播报稿」文本层（10-09 新增）。
 *
 * 用户需求：「这个播报功能目前语气过于平淡、缺乏表现力，希望改成让 Codex 根据上下文自行决定
 * 并生成播报内容，而不是由固定文本控制」。
 *
 * ── 契约（⛔ 跨文件：改这里必须同步 electron/developer-instructions.ts 第 16 条 + 守卫 11z）──
 * 回复**末尾**用一个 `voice` 围栏块装口语化播报稿：
 *
 *     ```voice
 *     好的，播报改完了 —— 以后说什么、怎么说，我自己按上下文定。
 *     ```
 *
 * 同一份契约被**三处**消费，所以本文件同时提供三种形态：
 *   ① **结束播报**（`resolveAnnounceSummary`）：**只**念这块（10-09 第二轮用户令
 *      「运行的正文和汇总正文不用播报了，只播报 Codex 写的内容」⇒ 原来"块缺失就回退到本机
 *      压缩摘要"那条路**整条删除**，压缩器也一并删了）；模型没写稿 ⇒ 什么都不念。
 *   ② **通话的正文朗读**（`createVoiceScriptStripper`）：通话照念正文（电话里必须把回复念出来），
 *      但这块**必须整块跳过** —— 它随后由结束播报念，混在正文里念 = 念两遍 + 读出反引号。
 *      ⛔ 非通话链路**没有**正文朗读了（已删），剥离器只为通话保留。
 *   ③ **屏幕显示**（`stripVoiceScript`，由 `features/markdown/Markdown.tsx` 调用）：
 *      整块剥掉 —— 播报稿是**给耳朵的**，摊在对话里只会干扰阅读。
 *
 * ⛔ 为什么用围栏块而不是行标记（`🎙️ …`）：播报稿是多句正文，行标记会让它和正文混在一起渲染；
 *   围栏在**流式**过程中天然可判定（未闭合 = 还在写），屏幕上不会漏出半句草稿。
 * ⛔ 为什么流式剥离要「按住可能的半截围栏」：delta 是按 token 切的，`` ``` `` 与 `voice`
 *   很可能落在两个 delta 里（实测形态：`"```"` → `"voice"` → `"\n…"`）。不按住的话
 *   第一帧就把半截围栏当正文吐给 TTS，用户会听到一句「反引号反引号」。
 *
 * 纯函数 + 纯状态机，零依赖：守卫 `scripts/guards/11z-voice-call.mjs` 直接 import 跑真值表
 * （含 delta 切分形态）。
 */
import { createSpeakFilter } from "./speak-text.mjs";
import { splitSentences } from "./voice-summary.mjs";

/** 围栏语言标签。⛔ 这是**跨文件契约**的一部分：指令里写的、这里认的、守卫查的必须是同一个词。 */
export const VOICE_FENCE_LANG = "voice";

/** 建议播报稿上限（字符）。超过这个量就不再叫「播报」了（念起来十几秒）。 */
export const VOICE_SCRIPT_MAX_CHARS = 240;

/**
 * 硬上限（字符）：模型没听话写了一大段时的**安全网**（防止一段 2000 字的「播报」念两分钟）。
 * 正常路径在句边界处就截止了，走不到这里。
 */
export const VOICE_SCRIPT_HARD_CAP = 600;

/** 围栏行（可带语言标注）：`​`` ` 或 `~~~`，最多 3 个前导空格，语言标签后无其他内容。 */
const FENCE_LINE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([A-Za-z][\w-]*)?\s*$/;
/** 「可能是围栏、但还没写完」的形态：1~3 个反引号 + 语言标签的前缀（token 切分时会出现）。 */
const PARTIAL_FENCE_RE = /^\s{0,3}(`{1,3}|~{1,3})\s*([A-Za-z]{0,8})$/;

/** 这一行是不是**播报稿的开围栏**（```voice）。 */
export function isVoiceFence(line) {
  const match = FENCE_LINE_RE.exec(String(line ?? ""));
  return Boolean(match) && String(match[2] ?? "").toLowerCase() === VOICE_FENCE_LANG;
}

/** 这一行是不是**收围栏**（裸围栏、无语言标注）。 */
export function isBareFence(line) {
  const match = FENCE_LINE_RE.exec(String(line ?? ""));
  return Boolean(match) && String(match[2] ?? "").length === 0;
}

/**
 * 这一行**有可能是**播报稿围栏的开头（还没写完，例如 `` ``` `` / ```` ```vo ````）。
 * ⛔ 只有「语言标签是 voice 的前缀」才算 —— ```` ```js ```` 这种必须立刻放行，
 *   它是普通代码块、由下游的朗读清洗去处理。
 */
export function isPartialVoiceFence(line) {
  const match = PARTIAL_FENCE_RE.exec(String(line ?? ""));
  if (!match) return false;
  return VOICE_FENCE_LANG.startsWith(String(match[2] ?? "").toLowerCase());
}

/**
 * 抽取播报稿正文（整段文本用）。
 * ⛔ 未闭合也照样取 —— 流式阶段（回复还没写完）也能拿到已写的部分。
 * @param {string} raw
 * @returns {{ text: string; present: boolean }}
 */
export function extractVoiceScript(raw) {
  const buf = [];
  let inBlock = false;
  let present = false;
  for (const line of String(raw ?? "").split("\n")) {
    if (inBlock) {
      if (isBareFence(line)) { inBlock = false; continue; }
      buf.push(line);
      continue;
    }
    if (isVoiceFence(line)) { inBlock = true; present = true; }
  }
  return { text: buf.join("\n").trim(), present };
}

/**
 * 把播报稿整块剥掉（含围栏行），用于**屏幕显示**。
 * ⛔ 未闭合时从开围栏剥到结尾：流式期间用户看不到半截草稿（这是「按住」的整段版）。
 * @param {string} raw
 * @returns {string}
 */
export function stripVoiceScript(raw) {
  const kept = [];
  let inBlock = false;
  for (const line of String(raw ?? "").split("\n")) {
    if (inBlock) {
      if (isBareFence(line)) inBlock = false;
      continue;
    }
    if (isVoiceFence(line)) { inBlock = true; continue; }
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\s+$/, "");
}

/**
 * 流式剥离器（按 delta 喂）。
 *
 * 与 `stripVoiceScript` 的区别：整段版只看「已经拿到全文」，流式版必须处理**半截行**
 * —— 这就是上面那段「按住」注释说的问题。
 *
 * ⛔ 只吐「确定不在播报稿里」的文本；残余（无换行的那半行）如果可能是围栏开头就按住，
 *   等下一帧（或 `flush()`）再定。块内的残余直接丢。
 * @returns {{ push(delta: string): string; flush(): string; reset(): void; readonly inVoiceBlock: boolean }}
 */
export function createVoiceScriptStripper() {
  let buf = "";
  let inBlock = false;

  /** 吃一整行（不含换行）：返回 null = 属于播报稿、不吐 */
  const consumeLine = (text) => {
    if (inBlock) {
      if (isBareFence(text)) inBlock = false;
      return null;
    }
    if (isVoiceFence(text)) { inBlock = true; return null; }
    return text + "\n";
  };

  return {
    get inVoiceBlock() { return inBlock; },
    reset() { buf = ""; inBlock = false; },
    push(delta) {
      buf += String(delta ?? "");
      let out = "";
      for (;;) {
        const at = buf.indexOf("\n");
        if (at < 0) break;
        const line = buf.slice(0, at);
        buf = buf.slice(at + 1);
        const kept = consumeLine(line);
        if (kept) out += kept;
      }
      if (inBlock) return out;                     // 块内残余（无换行）本来就是播报稿
      if (isPartialVoiceFence(buf)) return out;    // 可能是围栏写了一半 ⇒ 按住，下一帧再说
      out += buf;
      buf = "";
      return out;
    },
    /** 回合结束时把按住的内容定下来（不是围栏就补吐出去，是围栏就吞掉）。 */
    flush() {
      const rest = buf;
      const wasInBlock = inBlock;
      /* ⛔ flush = 「输入到此为止」⇒ **状态必须归位**：停在播报稿里（模型没写收围栏就结束了）
         时不归位的话，这个剥离器会永久停在块内 —— 之后喂什么都当播报稿丢掉。 */
      buf = "";
      inBlock = false;
      if (wasInBlock || !rest) return "";
      return consumeLine(rest) ?? "";
    },
  };
}

/**
 * 播报稿清洗：复用「朗读视图」的块级 + 行内清洗（markdown 记号 / 链接 / 路径 / emoji /
 * 数字中文化），再按**句边界**截到预算内。
 *
 * ⛔ 不在这里另造一套清洗 —— 与实时播报、通话播报共用 `speak-text.mjs`（单一真相源）。
 * ⛔ 截断优先落在句末：模型写长了也不能从句子中间砍（听起来像被掐断）。
 * @param {string} text
 * @param {{ maxChars?: number }} [options]
 * @returns {string}
 */
export function cleanVoiceScript(text, options = {}) {
  const maxChars = Math.max(20, Math.trunc(Number(options.maxChars) || VOICE_SCRIPT_MAX_CHARS));
  const filter = createSpeakFilter({ codeNotice: "", tableNotice: "" });
  const spoken = String(filter.push(String(text ?? "")) ?? "").trim();
  if (!spoken) return "";
  let out = "";
  for (const sentence of splitSentences(spoken)) {
    if (out && out.length + sentence.length > maxChars) break;
    out += sentence;
  }
  if (!out) out = spoken;
  if (out.length > VOICE_SCRIPT_HARD_CAP) {
    out = out.slice(0, VOICE_SCRIPT_HARD_CAP).replace(/[，,、；;]$/, "") + "…";
  }
  return out;
}

/**
 * 播报**去重键**：同一段内容经不同触发源（`voice_announce` 工具 / 正文实时 / 结束汇总稿）
 * 进入播报管线时，字面几乎必然有出入（句尾标点、空白、数字读法前的写法差异）——
 * 直接拿原文比对永远对不上。这里归一成「只留字母与数字（含 CJK）、忽略大小写」的键：
 *   「已修复 3 个问题。」 ≡ 「已修复3个问题」 ≡ 「已修复 3 个问题！」
 * ⛔ 纯函数：守卫 11z 直接 import 跑真值表（10-09 用户报「同一段音频连续播放两次」后立）。
 * @param {string} text
 * @returns {string}
 */
export function spokenDedupeKey(text) {
  return String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * 句子级去重：把 `text` 按句切开，剔掉**本回合已经念过**的句子，返回「还剩哪些要念」。
 *
 * ⛔ 为什么不能只按「整段文本」比对（10-09 用户报「同一段播报内容重复播放好几次」的根因）：
 *    三条入口喂给 `speak()` 的文本**切分粒度不同** —— 正文实时是**逐句**喂（断句器已经切好），
 *    工具插播与结束稿是**整段**喂。整段算键时键是「好几句拼起来的串」，
 *    永远对不上逐句喂时那句单独的键 ⇒ 同一句话先被工具念一遍、又被正文念一遍、结束稿再第三遍。
 *    按句切分后，无论从哪条入口来，命中的都是同一把键。
 * ⛔ 同一次调用内部也去重（`keys.includes`）：同一段里重复出现的句子只念一次。
 * @param {string} text
 * @param {Set<string>} seen 本回合已念过的键（调用方在**确认出声后**登记）
 * @returns {{ text: string; keys: string[] }} `text` = 仍需念的句子（全重复则是空串）；`keys` = 它们的键
 */
export function dedupeSpokenSentences(text, seen) {
  const kept = [];
  const keys = [];
  for (const sentence of splitSentences(String(text ?? ""))) {
    const key = spokenDedupeKey(sentence);
    if (!key) continue;
    if ((seen && seen.has(key)) || keys.includes(key)) continue;
    kept.push(sentence);
    keys.push(key);
  }
  return { text: kept.join(""), keys };
}

/**
 * 回合结束时「该念什么」的唯一裁决点。
 *
 * ⛔ **只念模型写的播报稿**，没写就是空（调用方什么都不念）。
 *    10-09 第二轮用户令：「运行的正文和汇总正文不用播报了 —— 只播报 Codex 写的内容」
 *    ⇒ 原先把「本机压缩摘要」当回退的那条路**整条删除**（压缩器也已随之删掉）。
 * ⛔ 清空成空串也要返回空（清洗后没内容 = 没得念，调用方别再拼别的兜底文案）。
 * @param {string} raw 最终回复原文
 * @param {{ maxChars?: number }} [options]
 * @returns {{ text: string; present: boolean }} `present` = 回复里到底有没有那个围栏块
 */
export function resolveAnnounceSummary(raw, options = {}) {
  const script = extractVoiceScript(String(raw ?? ""));
  return { text: script.text ? cleanVoiceScript(script.text, options) : "", present: script.present };
}
