/**
 * 回合失败文案归一（11-03 立，起因：终端用户收到一整段上游 JSON）。
 *
 * ⛔⛔ 事实：上游（自建网关 → 火山/字节）把错误原样塞进 `turn.error.message`，形如
 *   {"error":{"code":"prompt_too_long","gateway_hint":"...","message":"{\"code\":11115,
 *   \"msg\":\"prompt is too long: 3326093 tokens > 1048576 maximum\"}",
 *   "displayMsg":{"zh":"内容过长，请精简或新建任务"},...}}
 *   本仓三个出口（bot-stream / channel-bot / 渲染层 toast）原来都是**直接贴原文**：
 *   用户看到一坨机器串，既读不懂，也不知道该做什么。实测该错误在用户侧复现过一次。
 *
 * ⛔ 本文件是**主进程**那份；渲染层有等价实现 `src/lib/turn-error-text.mjs`。
 *   两份是故意的：守卫【159】禁止 electron/ 与 src/ 互相 import，只能各写一份
 *   （同自动压缩默认值的处理方式）。⛔ 改这里必须同步改那边，函数名与输出字段保持一致。
 *
 * ⛔ 只做「把话说人话」，不改任何判定与重试逻辑（重试策略在 event-router 里）。
 */

export type TurnErrorText = { title: string; detail: string };

/** 上下文超限的各种上游写法（含网关自己的 code 与中文提示）。 */
const OVER_LIMIT = /prompt_too_long|context_length_exceeded|prompt is too long|maximum context length|exceeds the model's limit|too many tokens|内容过长|超出模型上限/i;

function tryJson(text: string): any {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 从上游错误对象里挑一句人能读的话。
 * 顺序有讲究：上游自己给的 `displayMsg.zh` 比我们意译更准，优先用它；
 * `extError.message` 次之；最后才是通用的 `msg` / `message`。
 * ⛔ 上游会**嵌套**：`message` 字段本身又是 JSON 字符串（本例就是），要递归一层。
 */
function pickHuman(node: any, depth = 0): string {
  if (!node || depth > 4) return "";
  if (typeof node === "string") {
    const inner = tryJson(node.trim());
    return inner ? pickHuman(inner, depth + 1) : node.trim();
  }
  if (typeof node !== "object") return "";
  const zh = node.displayMsg?.zh ?? node.displayMsg?.["zh-hant"] ?? node.display_msg?.zh;
  if (typeof zh === "string" && zh.trim()) return zh.trim();
  for (const key of ["extError", "error"]) {
    const got = pickHuman(node[key], depth + 1);
    if (got) return got;
  }
  for (const key of ["message", "msg"]) {
    const got = pickHuman(node[key], depth + 1);
    if (got) return got;
  }
  return "";
}

/** 以「万」为单位，避免让用户去数 7 位数字。非法值返回空串。 */
function wan(raw: string): string {
  const v = Number(raw.replace(/,/g, ""));
  return Number.isFinite(v) && v > 0 ? `${Math.round(v / 10000)} 万` : "";
}

/**
 * 把 `turn.error.message` 原文归一成 { title, detail }。
 * ⛔ detail 控制在 300 字内：它会被塞进飞书消息 / toast，太长等于没修。
 */
/** JSON.stringify 的安全版：对象里有循环引用 / BigInt 时不让它抛。 */
function safeStringify(node: any): string {
  try {
    return JSON.stringify(node);
  } catch {
    return String(node);
  }
}

export function describeTurnError(raw: unknown): TurnErrorText {
  /* ⛔ 审查补充：raw 可能是**对象**（调用方把整个 error 传进来，而不是 error.message）。
     直接 String(obj) 只会得到 "[object Object]" —— 等于把一句能读的话变成噪声。
     对象入参时正文为空，所以"判超限"必须用序列化后的全文，否则会漏判。 */
  const isObject = Boolean(raw) && typeof raw === "object";
  const text = isObject ? "" : String(raw ?? "").trim();
  const parsed = isObject ? (raw as any) : tryJson(text);
  const haystack = parsed ? safeStringify(parsed) : text;
  if (!haystack.trim()) {
    return { title: "任务失败", detail: "引擎没有给出失败原因。可以重试一次；反复出现请导出日志。" };
  }

  if (OVER_LIMIT.test(haystack)) {
    const nums = haystack.match(/(\d[\d,]{3,})\s*tokens?\s*>\s*(\d[\d,]{3,})/i);
    const used = nums ? wan(nums[1]) : "";
    const max = nums ? wan(nums[2]) : "";
    const size = used && max ? `本次约 ${used} tokens，模型上限 ${max}。` : "";
    return {
      title: "内容超出模型上限",
      detail: `${size}新建一个会话再来；大段内容先存成文件（.md / .txt）再让我读，比直接粘贴省很多。`,
    };
  }

  const human = parsed ? pickHuman(parsed) : "";
  const detail = String(human || haystack).replace(/\s+/g, " ").trim().slice(0, 300);
  return { title: "任务失败", detail };
}
