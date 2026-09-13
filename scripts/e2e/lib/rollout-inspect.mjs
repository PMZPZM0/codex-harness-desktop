// scripts/e2e/lib/rollout-inspect.mjs
//
// rollout(JSONL) 取证小工具：给场景判断「引擎到底注入没注入某段指令」用。
//
// ⚠️ 为什么必须按 role 判、不能对整份文本做 `includes("初次见面")`（09-12 实测踩坑）：
// 本项目的 `AGENTS.md` **本身**就有一段身份引导的文档（「首次对话身份引导：只打一次招呼…
// 首会话 rollout 有『初次见面』」），而 e2e 把测试工作区设成项目根目录 → 引擎会把项目
// AGENTS.md 一起注入**每个**会话的上下文。于是「整份文本里有没有『初次见面』」对**每个**
// 会话都为真 —— 断言恒定假绿/假红，完全测不出真东西（实测：修复后次会话被判成仍有引导）。
//
// 权威判据只有一条：rollout 里 **role === "developer" 的 message** 是否带着引导指令。
// 引导指令走 `thread/start` 的 developerInstructions，落盘就是一条 developer 消息；
// 项目 AGENTS.md 走的是 `role: "user"` 的「# AGENTS.md instructions」消息，形态完全不同。

/** 引导指令的**唯一标记**（取自 App.tsx 的 IDENTITY_ONBOARD_INSTRUCTIONS 首句）。
 *  改那句话时这里要一起改——preflight 会盯着两边一致。 */
export const GREETING_MARKER = "【初次见面（第一条回复就把招呼和提问全部完成）】";

/** 一条 rollout 里所有 role === "developer" 消息的文本（半截行自动跳过） */
export function developerMessages(rolloutText) {
  const out = [];
  for (const line of String(rolloutText ?? "").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue; // 回合正在写：末行可能是半截 JSON
    }
    const payload = row?.payload;
    if (payload?.type === "message" && payload?.role === "developer") {
      const text = Array.isArray(payload.content)
        ? payload.content.map((c) => c?.text ?? "").join("\n")
        : "";
      if (text) out.push(text);
    }
  }
  return out;
}

/** 该 rollout 是否被注入了身份引导指令（只看 developer 消息，避免撞上项目 AGENTS.md 的文档文本） */
export function greetingInjected(rolloutText) {
  return developerMessages(rolloutText).some((t) => t.includes(GREETING_MARKER));
}
