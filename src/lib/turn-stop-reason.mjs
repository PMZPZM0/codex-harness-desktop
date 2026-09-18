/**
 * src/lib/turn-stop-reason.mjs —— 「这一回合为什么结束了」的**纯函数**（无 React、无 DOM）。
 *
 * ⛔ 由来（09-18 用户实测「跑长任务老是中途自动停止」）：
 *   引擎其实把原因写得很清楚 —— `turn.error` 是 `TurnError { message, codexErrorInfo, additionalDetails,
 *   misalignment }`，其中 `codexErrorInfo` 是**分类枚举**（contextWindowExceeded / sandboxError /
 *   rateLimitExceeded …），`misalignment.steer.message` 甚至是引擎给的「确认继续时就把这条作为
 *   下一回合输入」的恢复指令。而界面只判断 `turn.error` 存不存在 → 一律显示「处理出错」四个字，
 *   用户既不知道是上下文满了、被沙箱拒了，还是被中断了，也不知道能不能接着跑。
 *
 *   另一个更隐蔽的漏判：被中断的回合 `status === "interrupted"`、`error === null`
 *   （真机实测：`{status:"interrupted", error:null}`）→ 走的是「耗时 3s」分支，
 *   界面上**完全看不出这是被中断的**，用户只能理解成「自己停了」。
 *
 * 取值依据：`.workbuddy/codex-schema/*.schemas.json` 的 TurnStatus / TurnError / CodexErrorInfo。
 */

/** CodexErrorInfo → 中文归类 + 给用户的处置提示。键与引擎枚举一一对应。 */
const ERROR_KINDS = {
  contextWindowExceeded: { label: "上下文超限", hint: "这条会话的上下文已经装不下新内容：开一条新会话，或先 /compact 压缩上下文再继续。" },
  sessionBudgetExceeded: { label: "会话额度用尽", hint: "本会话的预算额度用完了，开新会话可以继续。" },
  usageLimitExceeded: { label: "用量超限", hint: "账户用量已达上限（等额度恢复或在设置里换供应商）。" },
  rateLimitExceeded: { label: "被限流", hint: "上游限流，稍等片刻重发即可。" },
  serverOverloaded: { label: "上游过载", hint: "模型服务端繁忙，稍后重发。" },
  sandboxError: { label: "沙箱拒绝", hint: "命令被沙箱策略拒绝（常见于复杂的 cmd 嵌套引号、路径含空格/中文）。换个写法重试。" },
  cyberPolicy: { label: "安全策略拦截", hint: "请求被安全策略拦截。" },
  misalignmentPolicyViolation: { label: "安全策略拦截", hint: "请求被安全策略拦截。" },
  threadRollbackFailed: { label: "回滚失败", hint: "会话回滚失败，建议新建会话继续。" },
  unauthorized: { label: "鉴权失败", hint: "模型供应商鉴权失败，检查密钥/登录状态。" },
  badRequest: { label: "请求被拒", hint: "上游拒绝了本次请求（400）。" },
  internalServerError: { label: "服务端错误", hint: "上游内部错误，重发可能就好了。" },
  other: { label: "处理出错", hint: "" },
};

const RUNNING_STATUS = new Set(["inProgress", "running"]);

/**
 * 解析一个回合的结束原因。
 * @returns {{kind:string, label:string, detail:string, continueText:string}}
 *   kind        —— 归一化的分类（completed / interrupted / failed / 具体的 codexErrorInfo / running）
 *   label       —— 直接能显示的中文短标签（running 与 completed 时为空串，由调用方决定文案）
 *   detail      —— 完整原因（分类提示 + 引擎 message + additionalDetails）
 *   continueText—— 引擎给出的「继续指令」（misalignment.steer.message，没有就是空串）
 */
export function describeTurnStop(turn) {
  const empty = { kind: "unknown", label: "", detail: "", continueText: "" };
  if (!turn || typeof turn !== "object") return empty;
  const status = String(turn.status ?? "");
  if (RUNNING_STATUS.has(status)) return { ...empty, kind: "running" };

  const err = turn.error && typeof turn.error === "object" ? turn.error : null;
  const rawInfo = err?.codexErrorInfo ?? null;
  // 引擎把 code 放在字符串里；某些变体是对象（带 httpStatusCode），取其中的 code 字段
  const code = typeof rawInfo === "string" ? rawInfo : String(rawInfo?.code ?? rawInfo?.type ?? "");
  const steer = err?.misalignment?.steer;
  const continueText = String((steer && (steer.message ?? steer.input)) ?? "").trim();

  if (err || status === "failed") {
    const info = ERROR_KINDS[code] ?? ERROR_KINDS.other;
    const engineMessage = String(err?.message ?? "").trim();
    const extra = String(err?.additionalDetails ?? "").trim();
    const detail = [info.hint, engineMessage, extra].filter(Boolean).join("\n");
    return {
      kind: code || "error",
      label: info.label,
      // label 已是「处理出错」时仍保留引擎原文（用户要的就是"到底为什么"）
      detail: detail || info.label,
      continueText,
    };
  }
  if (status === "interrupted") {
    return {
      kind: "interrupted",
      label: "已停止",
      detail: "这一回合被中断：你点了停止、语音插话、手机端停止，或客户端主动中止（引擎 status=interrupted）。接着发一条消息即可继续。",
      continueText: "",
    };
  }
  return { ...empty, kind: "completed" };
}

/** 合成回合标题：分类标签优先，没有原因就退回「耗时 X / 已处理」。 */
export function turnHeadline(turn, durationLabel) {
  const stop = describeTurnStop(turn);
  if (stop.label) return durationLabel ? `${stop.label} · 耗时 ${durationLabel}` : stop.label;
  return durationLabel ? `耗时 ${durationLabel}` : "已处理";
}

/**
 * 「正文已经给完了，回合却还没结束」—— GPT 系模型的收尾等待（09-18 用户实测：
 * 「怎么回复完了还没结束」）。真机实测 gpt-5.6-sol：正文最后一条 message 落盘后
 * **28 秒零事件**（无思考、无工具、无 delta），上游才发 usage/finish → task_complete。
 * 引擎只能干等上游的流结束信号，这不是 bug；但界面在这个状态下还说「正在生成回复」
 * 就是误导 —— 用户会以为正文还没写完。
 *
 * 判据（保守，宁可不显示也不能误报）：
 *   ① 回合必须还在跑（已结束的回合不算「等待收尾」）；
 *   ② 回合内**任何** item 还在跑 → false。这一条必须扫全量、不能只看到正文为止：
 *      否则「正文已完成 + 后面还有一条在跑的命令」会同时显示「正在执行命令」和
 *      「正文已完整，等待模型收尾」，两条自相矛盾。
 *   ③ 倒序找最后一条**有正文的 agentMessage** 且它不在流式中 → true（正文给完了，就差结束信号）。
 *      「不看有没有工具、只看最后那条正文」：正文之后的工具调用会由 ② 挡掉。
 */
export function isAwaitingTurnClose(turn) {
  if (!turn || typeof turn !== "object") return false;
  const status = String(turn.status ?? "");
  if (status !== "inProgress" && status !== "running") return false;
  const items = Array.isArray(turn.items) ? turn.items : [];
  for (const item of items) {
    if (item?.status === "inProgress" || item?.status === "running") return false;
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.type === "agentMessage" && String(item.text ?? "").trim()) return true;
  }
  return false;
}
