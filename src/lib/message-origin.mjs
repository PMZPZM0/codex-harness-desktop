/**
 * 消息发送者身份 · 单一真相源（11-07 用户令）
 *
 * 问题：调度链的输入里从来**没有「谁发的」**，只有 `originThreadId`（而且空串被一律当成
 * 「本地用户」）。于是主对话模型自派、专家团主理人派成员、中枢派群成员、群聊用户 @、
 * 群聊伙伴互 @、定时任务 —— 六种真实来源全被拼成同一句「发起方交给你的任务」，
 * 消费侧只能靠 `[SYSTEM TASK · …]` 标签白名单 + 正文正则去猜「是不是上级派发」。
 * ⇒ 猜不准的地方（成员会话首条、定时任务、伙伴转交）就默认按用户消息处理。
 *
 * 解法：身份作为**结构化对象**沿调用链传，并在宿主拼装首任务时写一行协议
 * `发件人：<kind> · <name>`（放在需求体第一行）；`parseUserRefs` 统一解析它，
 * 渲染层、群聊、专家团、中枢会话都读同一份 `sender`。
 *
 * ⛔ 向后兼容：老会话没有这行协议 ⇒ `parseSenderFromText` 从老标记
 *    （`上级：` / `发起方交给你的任务` / `主理人分配的子任务` / `用户任务`）推导；
 *    什么都推不出来 ⇒ 回落 `user`（用户自己打的字，不左移、不伪造成上级）。
 * ⛔ 纯函数、零依赖；类型在 message-origin.d.mts。
 */
export const SENDER_KINDS = ["user", "supervisor", "automation", "member", "system"];

/** 五种身份的中文标签（UI 头部、气泡署名、群消息来源标签同源）。 */
function labelOf(kind, name) {
  switch (kind) {
    case "supervisor": return name ? `上级 · ${name}` : "上级（主会话）";
    case "automation": return name || "定时任务";
    case "member": return name ? `伙伴 · ${name}` : "伙伴";
    case "system": return name || "系统";
    default: return "用户";
  }
}

export function senderLabelOf(raw) {
  const obj = raw && typeof raw === "object" ? raw : {};
  const kind = SENDER_KINDS.includes(String(obj.kind)) ? String(obj.kind) : "user";
  return labelOf(kind, String(obj.name ?? "").trim());
}

/** 容错归一：脏值 / 旧字段 / 缺字段一律回落 user，⛔ 不让一条坏数据把整条消息判成上级。 */
export function normalizeSender(raw) {
  const obj = raw && typeof raw === "object" ? raw : {};
  const kind = SENDER_KINDS.includes(String(obj.kind)) ? String(obj.kind) : "user";
  const id = String(obj.id ?? "").trim();
  const name = String(obj.name ?? "").trim();
  return {
    kind,
    id,
    name,
    label: labelOf(kind, name),
    isUser: kind === "user",
    /** 非用户发出的都算「上级侧」：左对齐、不套用户气泡、被调度方按上级指令处理。 */
    isSuperior: kind === "supervisor" || kind === "automation" || kind === "member" || kind === "system",
  };
}

/**
 * 从调度上下文推导发送者（调用方只给得出这些字段时用它，别各自写一遍 if）。
 * · 显式 source 最优先（automation / partner 没有 origin 也能判）；
 * · 有 originThreadId ⇒ 发起方本身是一条会话（主对话 / 专家团主理人 / 中枢）＝ 上级；
 * · 都没有 ⇒ 本地用户（兼容现状，⛔ 不是「猜不到就当上级」）。
 */
export function senderFromDispatch(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const source = String(src.source ?? "").trim();
  if (source === "automation") return normalizeSender({ kind: "automation", name: String(src.name ?? "定时任务") });
  if (source === "partner" || source === "member") return normalizeSender({ kind: "member", name: String(src.callerName ?? src.name ?? "") });
  if (source === "system") return normalizeSender({ kind: "system", name: String(src.name ?? "") });
  if (source === "user") return normalizeSender({ kind: "user", name: String(src.name ?? "") });
  const origin = String(src.originThreadId ?? "").trim();
  if (origin) {
    return normalizeSender({
      kind: "supervisor",
      id: origin,
      name: String(src.name ?? src.supervisor ?? "").trim() || "主会话",
    });
  }
  return normalizeSender({ kind: "user", name: String(src.name ?? "") });
}

/** 写进 SYSTEM TASK 需求体第一行的协议行（⛔ 名字可含空格与「·」，所以名字放最后、整段读）。 */
export function senderLineOf(raw) {
  const s = normalizeSender(raw);
  return `发件人：${s.kind}${s.name ? ` · ${s.name}` : ""}`;
}

/** 按身份给出任务措辞：被调度方据此知道「这是谁交给我的」，而不是一律「用户需求」。 */
export function taskLineOf(raw, query) {
  const s = normalizeSender(raw);
  const body = String(query ?? "").trim();
  switch (s.kind) {
    case "supervisor": return `上级交给你的任务：${body}`;
    case "automation": return `定时任务交给你的任务：${body}`;
    case "member": return `伙伴 ${s.name || "群成员"} 交给你的任务：${body}`;
    case "system": return `系统交给你的任务：${body}`;
    default: return `用户任务：${body}`;
  }
}

const PROTOCOL_LINE = /^\s*发件人\s*[：:]\s*(user|supervisor|automation|member|system)(?:\s*[·|]\s*(.+?))?\s*$/;
const OLD_TASK_LABEL = /^\s*(?:发起方交给你的任务|主理人分配的子任务|用户任务|上级交给你的任务|定时任务交给你的任务|伙伴\s*[^\n：:]{1,40}?交给你的任务)\s*[：:]\s*/;

/**
 * 从需求体**第一行**解析发送者：新协议行优先，其次兼容老标记。
 * ⛔ 只认第一行 —— 用户正文里随手写的「上级：…」「发件人：…」不能被当成宿主元信息
 *    （11-03 审查收紧过同一条边界，别退回任意行匹配）。
 */
export function parseSenderFromText(text) {
  const first = String(text ?? "").split(/\r?\n/, 1)[0] ?? "";
  const protocol = first.match(PROTOCOL_LINE);
  if (protocol) return normalizeSender({ kind: protocol[1], name: (protocol[2] ?? "").trim() });
  const supervisor = first.match(/^\s*上级(?:主管)?\s*[：:]\s*(.+?)\s*$/);
  if (supervisor) return normalizeSender({ kind: "supervisor", name: supervisor[1].trim() });
  if (/^\s*定时任务交给你的任务\s*[：:]/.test(first)) return normalizeSender({ kind: "automation" });
  if (/^\s*伙伴\s*[^\n：:]{1,40}?交给你的任务\s*[：:]/.test(first)) {
    const who = first.match(/^\s*伙伴\s*([^\n：:]{1,40}?)\s*交给你的任务/);
    return normalizeSender({ kind: "member", name: (who?.[1] ?? "").trim() });
  }
  if (/^\s*(?:发起方交给你的任务|主理人分配的子任务|上级交给你的任务)\s*[：:]/.test(first)) {
    return normalizeSender({ kind: "supervisor" });
  }
  if (/^\s*用户任务\s*[：:]/.test(first)) return normalizeSender({ kind: "user" });
  return null;
}

/** 需求体里剥掉协议行 / 上级行 / 任务标签，留下真正的任务正文（气泡显示用）。 */
export function stripSenderMeta(text) {
  return String(text ?? "")
    .replace(/^\s*发件人\s*[：:][^\n]*(?:\r?\n|$)/, "")
    .replace(/^\s*上级(?:主管)?\s*[：:][^\n]*(?:\r?\n|$)/, "")
    .replace(OLD_TASK_LABEL, "")
    .trim();
}

export { OLD_TASK_LABEL };
