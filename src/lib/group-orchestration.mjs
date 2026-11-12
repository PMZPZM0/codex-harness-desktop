/**
 * 群聊编排三条机制（2026-11-12 立）—— **宿主侧纯函数**，不落盘、不广播、不读存储。
 *
 * 来源（用户令「去 GitHub 看看成熟群聊系统，把值得抄的三条拿出来」）：
 *   · `yetone/cumora` docs/COORDINATION.md —— "never add a prompt rule when a code
 *     mechanism is the right fix"；完成由真实 posted state / 任务项数定义，不来自自报
 *     （"COUNT THE ITEMS, NOT THE HEADS"）；乐观发言 + 服务端安全网（seen-cursor
 *     freshness gate / HELD / atomic verbatim-dup / hold token）；HELD budget 与
 *     decline cap 由服务端兜底。
 *   · Microsoft AgentChat（AutoGen 继任者）的 speaker selection + termination condition。
 *   · MetaGPT 的 Environment 共享消息池：角色按订阅消费，动作执行与消息发布分离。
 *
 * 三条机制在本项目里的落点：
 *   ① 执行与汇报分离 —— `verifyProgressClaim`：模型写「已派出 / 进度到第二环」时，
 *      必须有本回合真实的 `team_member_invoke` / `team_phase_invoke` 调用或成员产出。
 *      ⛔ 只给可见回执，不替模型改正文（10-26 看门狗事故的边界）。
 *   ② 共享消息总线 + 显式发言权 —— `canSpeak` / `selectNextSpeakers`：谁下一个说由宿主
 *      按事实（本轮已发言、每人回合上限、名册）决定，不靠模型自觉写行首 @。
 *   ③ 宿主判定终止 —— `shouldStopGroupTurn`：完成 = 任务项数 / 硬上限 / 预算耗尽，
 *      ⛔ 不是「每人都发过一次」，也不是模型说「做完了」。
 *
 * ⛔ `ORCHESTRATION_RULES` 是拓展接口：加同类约束只往表里添一项，不改调用方结构。
 * ⛔ 判据一律保守：宁可放过，不可误吞用户能看见的正文（防丢数据是硬要求）。
 */

/** 拓展接口：逐条可灰度 / 回退。 */
export const ORCHESTRATION_RULES = Object.freeze({
  progressClaim: Object.freeze({ id: "progressClaim", enabled: true, label: "自报进度必须有真实派活/产出证据" }),
  speakerSelection: Object.freeze({ id: "speakerSelection", enabled: true, label: "发言权由宿主按事实仲裁" }),
  hostTermination: Object.freeze({ id: "hostTermination", enabled: true, label: "完成由任务项数与硬上限判定" }),
});

/** 真派活工具名（⛔ 与 group-talk / team-tools 的 schema 同名，别另写一份）。 */
export const DISPATCH_TOOL_NAMES = Object.freeze(["team_member_invoke", "team_phase_invoke", "agent_invoke"]);

/**
 * ④ 编排主体识别（11-12 补，① ~ ③ 的前置条件）。
 *
 * ⛔⛔ 背景（真机故障）：整套编排（工具面 / 催办 / 回交 / 收口 / handoffTo）原来只认
 *   「群里有整团槽」（`targetKind === "team"`）。但用户建群的主流方式是从 @ 面板**逐个拉人**：
 *   群里坐着一个团的**主理人**（`targetKind === "expert"`，`targetKey = "<teamId>:<leadId>"`）
 *   加若干成员 ⇒ 判定为"非团群" ⇒ 主理人工具面只剩 group_say/group_read/group_members，
 *   它只能把任务书写进正文（"这一轮派给：显影"），成员从未被唤醒 —— 用户看到的就是"说了没人干"。
 *
 * ⇒ 编排主体按**座位**解析，三种形态同一口径：
 *   ① 整团槽（`targetKind === "team"`）—— 原路径，优先；
 *   ② 主持人座位（`adminId` 指向的 expert，其 targetKey 拆出的 lead 与该团 lead 一致）；
 *   ③ 群里唯一的团主理人座位（② 没命中时的兜底）。
 * ⛔ 多个团主理人同群且都不是主持人 ⇒ 返回 null（判不准就不猜，保持旧行为）。
 *
 * @param {{ members?: Array<{ id?: string, targetKind?: string, targetKey?: string }>,
 *           adminId?: string, teams?: Array<{ teamId?: string, lead?: { id?: string } }> }} input
 * @returns {{ seatId: string, teamId: string, via: "team-slot" | "admin-seat" | "lead-seat" } | null}
 */
export function resolveGroupTeamSeat(input = {}) {
  const rows = (Array.isArray(input?.members) ? input.members : []).filter(Boolean);
  const slot = rows.find((m) => String(m.targetKind ?? "") === "team");
  if (slot) {
    const teamId = String(slot.targetKey ?? "");
    return teamId ? { seatId: String(slot.id ?? ""), teamId, via: "team-slot" } : null;
  }
  const teamById = new Map(
    (Array.isArray(input?.teams) ? input.teams : []).filter(Boolean)
      .map((t) => [String(t.teamId ?? ""), t]),
  );
  const seatOf = (m, via) => {
    if (!m || String(m.targetKind ?? "") !== "expert") return null;
    const key = String(m.targetKey ?? "");
    const cut = key.indexOf(":");
    if (cut <= 0) return null;
    const teamId = key.slice(0, cut);
    const leadId = key.slice(cut + 1);
    const team = teamById.get(teamId);
    if (!team || !leadId || String(team?.lead?.id ?? "") !== leadId) return null;
    return { seatId: String(m.id ?? ""), teamId, via };
  };
  const byAdmin = seatOf(rows.find((m) => String(m.id ?? "") === String(input?.adminId ?? "")), "admin-seat");
  if (byAdmin) return byAdmin;
  const hits = rows.map((m) => seatOf(m, "lead-seat")).filter(Boolean);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 「自报进度」文案特征。⛔ 只收集**明确宣称已执行动作/进度**的句式；
 * 不碰「我建议 / 可以派 / 下一步」这类未宣称完成的表达，避免误伤。
 */
export const PROGRESS_CLAIM_RE = /(?:已经|已|刚)?(?:派出|派发|分派|派给|交给|下发)(?:了)?[^。！？\n]{0,40}|进度(?:到|已到|已经到|：|:)\s*第?\s*[一二三四五六七八九十\d]+\s*(?:环|步|阶段|轮)|(?:全部|已经全部|均已)(?:完成|交付|收齐)|(?:已|已经)(?:收齐|汇总完)|完成\s*\d+\s*\/\s*\d+/;

/**
 * ① 执行与汇报分离。
 * @param {{ text?: string, toolCalls?: Array<{name?: string}|string>, memberOutputs?: unknown[] }} input
 * @returns {{ claim: boolean, evidence: number, ok: boolean, notice: string }}
 */
export function verifyProgressClaim(input = {}) {
  const text = String(input?.text ?? "");
  const claim = PROGRESS_CLAIM_RE.test(text);
  const calls = Array.isArray(input?.toolCalls) ? input.toolCalls : [];
  const dispatchCalls = calls.filter((call) => DISPATCH_TOOL_NAMES.includes(typeof call === "string" ? call : String(call?.name ?? ""))).length;
  const outputs = Array.isArray(input?.memberOutputs) ? input.memberOutputs.filter(Boolean).length : 0;
  const evidence = dispatchCalls + outputs;
  const enabled = ORCHESTRATION_RULES.progressClaim.enabled;
  const ok = !enabled || !claim || evidence > 0;
  return {
    claim,
    evidence,
    ok,
    notice: ok ? "" : "本轮没有实际派活或成员产出记录，上面关于「已派出 / 进度」的说法不可核实；请以工具调用回执和成员消息为准。",
  };
}

/**
 * ② 单个成员此刻能不能发言（宿主侧显式仲裁）。
 * @param {{ memberId?: string, spokeSince?: string[], ranCount?: number,
 *           maxTurnsPerMember?: number, known?: string[] }} input
 */
export function canSpeak(input = {}) {
  if (!ORCHESTRATION_RULES.speakerSelection.enabled) return true;
  const id = String(input?.memberId ?? "").trim();
  if (!id) return false;
  const known = Array.isArray(input?.known) ? input.known.map(String) : [];
  if (known.length && !known.includes(id)) return false;           // 名册里没有的人不发言
  const spoke = Array.isArray(input?.spokeSince) ? input.spokeSince.map(String) : [];
  if (spoke.includes(id)) return false;                           // 本轮已发过言（seen-cursor 口径）
  const max = Number(input?.maxTurnsPerMember ?? 0);
  if (max > 0 && Number(input?.ranCount ?? 0) >= max) return false; // 每人回合上限
  return true;
}

/**
 * ② 从候选里选出本轮真实可发言的人，按 chainBudget 截断。
 * ⛔ 只做「去重 + 事实过滤 + 预算截断」，不替模型决定说什么。
 */
export function selectNextSpeakers(input = {}) {
  const candidates = Array.isArray(input?.candidates) ? input.candidates : [];
  const budget = Math.max(0, Number(input?.budget ?? 0));
  const spokeSince = Array.isArray(input?.spokeSince) ? input.spokeSince.map(String) : [];
  const known = Array.isArray(input?.known) ? input.known.map(String) : [];
  const runs = input?.ranCount instanceof Map ? input.ranCount : new Map(Object.entries(input?.ranCount ?? {}));
  const max = Number(input?.maxTurnsPerMember ?? 0);
  const out = [];
  const seen = new Set();
  for (const raw of candidates) {
    if (out.length >= budget) break;
    const id = String((typeof raw === "string" ? raw : raw?.id) ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (canSpeak({ memberId: id, spokeSince, ranCount: Number(runs.get(id) ?? 0), maxTurnsPerMember: max, known })) out.push(id);
  }
  return out;
}

/**
 * ③ 终止条件由宿主判定。
 * ⛔ 完成看任务项数（itemsDone >= itemsTotal），**不是**「每人都发过一次」；
 *    没登记任务项时退到预算 / 回合上限这类硬边界，⛔ 不采信模型自报。
 * @returns {{ stop: boolean, reason: string }}
 */
export function shouldStopGroupTurn(input = {}) {
  if (!ORCHESTRATION_RULES.hostTermination.enabled) return { stop: false, reason: "rule-disabled" };
  const total = Math.max(0, Number(input?.itemsTotal ?? 0));
  const done = Math.max(0, Number(input?.itemsDone ?? 0));
  if (total > 0 && done >= total) return { stop: true, reason: "task-items-complete" };
  const budget = Number(input?.chainBudget ?? Infinity);
  if (Number.isFinite(budget) && budget <= 0) return { stop: true, reason: "budget-exhausted" };
  const max = Number(input?.maxTurnsPerMember ?? 0);
  const runs = input?.ranCount instanceof Map ? [...input.ranCount.values()] : Object.values(input?.ranCount ?? {});
  if (max > 0 && runs.length && runs.every((n) => Number(n) >= max)) return { stop: true, reason: "all-members-at-cap" };
  const declined = Math.max(0, Number(input?.declined ?? 0));
  if (declined >= 3) return { stop: true, reason: "decline-cap" };  // 与 Cumora decline cap 同口径
  return { stop: false, reason: "continue" };
}
