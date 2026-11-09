/**
 * 回合失败文案归一（渲染层那份，11-03 立）。
 *
 * ⛔ 主进程那份是 `electron/turn-error-text.ts`，逻辑与本文件**逐行等价**。
 *   两份是故意的：守卫【159】禁止 electron/ 与 src/ 互相 import（会破坏渲染层沙箱面），
 *   所以字面量与规则只能各存一份（同自动压缩默认值的处理方式）。
 *   ⛔ 改这里必须同步改那边，函数名与返回字段（title / detail）保持一致。
 *
 * 为什么需要它：上游把错误原样塞进 `turn.error.message`（一整段嵌套 JSON）。
 * 三个出口（飞书通道 / 手机通道 / 桌面 toast）原来都直接贴原文，
 * 终端用户看到的是一坨机器串 —— 读不懂，也不知道下一步该干什么。
 */

const OVER_LIMIT = /prompt_too_long|context_length_exceeded|prompt is too long|maximum context length|exceeds the model's limit|too many tokens|内容过长|超出模型上限/i;

function tryJson(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function pickHuman(node, depth = 0) {
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

function wan(raw) {
  const v = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(v) && v > 0 ? `${Math.round(v / 10000)} 万` : "";
}

function safeStringify(node) {
  try {
    return JSON.stringify(node);
  } catch {
    return String(node);
  }
}

export function describeTurnError(raw) {
  /* ⛔ 与主进程那份同步：raw 可能是对象（整个 error），String(obj) 只会得到 "[object Object]"。
     对象入参时正文为空，所以判超限要用序列化后的全文。 */
  const isObject = Boolean(raw) && typeof raw === "object";
  const text = isObject ? "" : String(raw ?? "").trim();
  const parsed = isObject ? raw : tryJson(text);
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
      detail: `${size}先手动压缩：点输入框旁的上下文环 → 压缩，或输入 /compact（会保留摘要）；也可以新建会话。大段内容先存成文件（.md / .txt）再让我读，比直接粘贴省很多。`,
    };
  }

  const human = parsed ? pickHuman(parsed) : "";
  const detail = String(human || haystack).replace(/\s+/g, " ").trim().slice(0, 300);
  return { title: "任务失败", detail };
}
