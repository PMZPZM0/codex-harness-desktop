/**
 * 回合「输出被上游截断」检测（09-19 用户实测「思考内容过长会被截断，运行状态就断了」）。
 *
 * 背景（真机取证，会话 01a0b515 回合 8「鹈鹕骑自行车」）：
 *   应用侧配置 model_max_output_tokens=393216，但当时的商汤网关把单次响应**钳到 8192 tokens**；
 *   模型思考（reasoning）与输出共享这 8192 预算 —— 思考 16365 字符（≈8000+ tokens）把预算几乎
 *   吃光 ⇒ 正文一个字都没输出 ⇒ 引擎把「空输出」当 task_complete 正常收尾 ⇒ 用户看到的就是
 *   「思考很久然后断了，什么都没发生」。rollout 铁证：output_tokens=8192（撞满）、reasoning 16.4KB、
 *   assistant 正文 0 字符、0 工具调用。
 *
 * 这个模块做的事：在回合收尾时，用**渲染层已经拿到的 items** 判定「这一回合是不是被截断的空转」，
 * 把"莫名断掉"变成"知道为什么断、下一步怎么办"。
 *
 * 纯函数、无副作用 —— 可被 check-preflight 直接 import 跑行为断言。
 */

/** 多长的思考算「深思很久」：≈3000+ tokens（中文约 0.6~1 字符/token）的思考体量。 */
export const TRUNCATE_REASONING_MIN_CHARS = 6000;
/** 正文少于多少字符视为「没有产出」。⛔ 收紧为 ~0（严格零产出）：只容忍空白/零字符——
 *  正常收尾哪怕只回一句"好的"也是几十字符，绝不能误判成截断（误判 → 自动续接 → 空转）。 */
export const TRUNCATE_OUTPUT_MAX_CHARS = 20;

/** 归一化：把引擎不同命名（reasoning / reasoning_summary 等）统一成纯文本。 */
function textOf(part) {
  if (part == null) return "";
  if (typeof part === "string") return part;
  if (typeof part.text === "string") return part.text;
  return "";
}

/** 计算一个回合（turn 对象）的思考 / 正文 / 工具项统计。
 *  ⛔ 关键形态（真实 rollout 实证，会话 01a0b515 回合 8）：引擎在「思考吃满输出预算被截断」
 *  时，会把 reasoning 摘要**逐字复制**成 agentMessage 当最后的正文（task_complete 的
 *  last_agent_message 就是这段）。所以「正文非空」不等于「有产出」——正文若与某条思考摘要
 *  逐字相同/高度相似，是「复述思考」，不算真实产出。 */
export function turnOutputStats(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  const summaries = [];
  const agentTexts = [];
  let toolItems = 0;
  for (const item of items) {
    const type = item?.type ?? "";
    if (type === "reasoning") {
      const summary = Array.isArray(item.summary) ? item.summary.map(textOf).join("") : "";
      const content = Array.isArray(item.content) ? item.content.map(textOf).join("") : "";
      summaries.push(summary + content);
    } else if (type === "agentMessage" || type === "message") {
      const text =
        typeof item.text === "string"
          ? item.text
          : Array.isArray(item.content)
            ? item.content.map(textOf).join("")
            : "";
      agentTexts.push(text);
    } else if (
      type === "functionCallOutput" ||
      type === "commandExecution" ||
      type === "mcpToolCall" ||
      type === "dynamicToolCall" ||
      type === "webSearch" ||
      type === "imageGeneration" ||
      type === "sleep" ||
      type === "collabAgentToolCall" ||
      type === "subAgentActivity" ||
      type === "fileChange"
    ) {
      toolItems++;
    }
  }
  const reasoningChars = summaries.join("").length;
  // 正文：排除「与某条思考摘要逐字相同 / 高度相似」的复述段
  let outputChars = 0;
  for (const a of agentTexts) {
    if (!a) continue;
    const isEcho = summaries.some((r) => r.length > 0 && (a === r || (a.length >= r.length * 0.9 && r.includes(a))));
    if (!isEcho) outputChars += a.length;
  }
  return { reasoningChars, outputChars, toolItems };
}

/**
 * 判定回合是否「被截断的空转」：
 *  思考很长（≥ TRUNCATE_REASONING_MIN_CHARS）且 正文为空/极短（< TRUNCATE_OUTPUT_MAX_CHARS）
 *  且 全程没有工具动作 —— 三者同时成立 = 模型思考吃光了输出预算，没来得及做任何事。
 *  ⛔ 保守原则：有工具调用或正文的回合一律不判（宁可漏报不可误报——误报会把正常回合标成异常）。
 */
export function isTruncatedEmptyTurn(turn) {
  const { reasoningChars, outputChars, toolItems } = turnOutputStats(turn);
  return reasoningChars >= TRUNCATE_REASONING_MIN_CHARS && outputChars < TRUNCATE_OUTPUT_MAX_CHARS && toolItems === 0;
}

/** 给用户看的说明（中文，一句话讲清原因；⛔ 不给"减少思考"的建议——用户明确要求长思考不受限）。 */
export function truncationNotice() {
  return "本回合思考很长但正文为空：是供应商的单次输出上限把它截断了（思考耗尽了单次输出预算），应用没有对思考或输出做任何限制。可换用支持更大单次输出（max_tokens）的供应商/模型，或把任务拆小分步发。";
}

/** 同一会话在多少毫秒内最多自动续跑几次（防「思考→截断→又思考」死循环烧钱）。 */
export const AUTO_CONTINUE_WINDOW_MS = 15 * 60 * 1000;
export const AUTO_CONTINUE_MAX_ATTEMPTS = 2;

/** 自动续跑时发给引擎的指令：从上次中断处**承接续写**（不是"重新做一遍任务"）。
 *  ⛔ 用户明确要求：不能让思考中断、输出要承接（本地部署模型同样有单次输出上限）。
 *  引擎无回合内承接通道（turn/steer 需 active turn，截断后已 task_complete 无 active turn），
 *  故承接落成新回合，但指令必须让模型"接着上次没写完的往下输出"而不是重新规划。
 */
export function autoContinuePrompt() {
  return "（自动续接）你的上一条回复被供应商的单次输出上限截断了（思考或正文写到一半就没有输出预算了，应用未做任何限制）。请直接从上次中断处继续，把剩余内容写完：不要重新思考、不要重复已经说过的部分，接着没写完的地方往下输出。";
}
