/**
 * 记忆工具执行端（memory_recall / memory_write / memory_forget）—— 模型侧的**唯一**记忆入口。
 *
 * 为什么要有它（11-10 用户令「记忆和记忆工具配套更新」）：
 *   之前模型只能靠"手写 md 文件"来记东西 —— 写错位置、格式不对、下次又读不到，
 *   是这套记忆最常失败的地方。现在给它三个语义化工具：**查、写、作废**。
 *
 * ⛔ 三条硬口径：
 *   ① 写入必须过 `writableCheck`（群型/座位决定能写哪个域）—— 越权当场拒，并给出人话原因；
 *   ② 写入落 `entries/<scope>/[<group>/]<id>.md` 并重建 INDEX —— ⛔ 不许只写文件不重建索引；
 *   ③ 作废不改正文语义：标 `status: superseded/expired`，保留可查（⛔ 不做物理删除）。
 */

import { isInjectable, normalizeId, oneLineSummary, toMeta, type AtomMeta, type AtomScope } from "./atoms-format";
import { readAtoms, regenerateIndex, writeAtom } from "./atoms-store";
import { selectAtoms } from "./atoms-select";
import { budgetOf, policyOf, writableCheck, type GroupKind, type GroupSeat } from "./group-memory-policy";

export type MemoryToolResult = { ok: boolean; output?: string; error?: string };

const WRITE_TYPES = new Set(["fact", "decision", "rule", "preference", "runbook"]);
const WRITE_SCOPES = new Set(["project", "rule", "session"]);

/** 从参数里取工作区与群归属（⛔ 工作区只能由宿主注入，不许模型自报）。 */
export type MemoryToolInput = {
  name: string;
  args: Record<string, unknown>;
  workspace: string;
  /** 群聊里由宿主注入：写 session 域时用它做归属，读时用它做隔离。 */
  groupId?: string;
  /* ⛔⛔ 11-11 验收发现：原来 policyOf 写死 ("plain","member")，连**主会话**也被当群成员，
     用户让模型「记住这条口径」时写 project 域被拒 —— 工具与界面（可写 project）口径不一致。
     ⇒ 身份只能由宿主注入（⛔ 不许模型自报），缺省仍是最小权限 member。 */
  kind?: GroupKind;
  seat?: GroupSeat;
};

/** 模型侧记忆工具的统一执行入口（三条工具共用一套口径，⛔ 不各写一份）。 */
export async function runMemoryTool(input: MemoryToolInput): Promise<MemoryToolResult> {
  const workspace = String(input.workspace ?? "").trim();
  if (!workspace) return { ok: false, error: "无法确定工作目录 —— 记忆是项目级的，请先选择工作文件夹" };
  const args = input.args ?? {};
  const policy = policyOf(input.kind ?? "plain", input.seat ?? "member");
  const budget = budgetOf(policy);

  if (input.name === "memory_recall") {
    const { docs } = await readAtoms(workspace);
    const groupId = String(args.group ?? input.groupId ?? "");
    const live = docs.filter((d) => isInjectable(d.meta) && (d.meta.scope !== "session" || !d.meta.group || d.meta.group === groupId));
    if (!live.length) return { ok: true, output: "（这个项目还没有记忆条目。需要时用 memory_write 记一条。）" };
    const picked = selectAtoms(live, { query: String(args.query ?? ""), workspace, now: Date.now() }, {
      indexMaxChars: budget.index, recallLimit: Number(args.limit) || policy.recallLimit, bodyMaxChars: budget.perBody,
    });
    const rows = picked.recalled.map((r) => `### ${r.meta.id}（${r.meta.type} · ${r.meta.confidence === "tentative" ? "待验证" : "已确认"}）\n${r.body}`);
    const head = picked.indexText ? `索引：\n${picked.indexText}` : "";
    return { ok: true, output: [head, rows.length ? `命中正文：\n${rows.join("\n\n")}` : ""].filter(Boolean).join("\n\n") };
  }

  if (input.name === "memory_write") {
    const scope = String(args.scope ?? "project").trim() as AtomScope;
    const targetScope: AtomScope = WRITE_SCOPES.has(scope) ? scope : "project";
    const gate = writableCheck(policy, targetScope);
    if (!gate.ok) return { ok: false, error: gate.reason };
    const body = String(args.body ?? args.text ?? "").trim();
    if (!body) return { ok: false, error: "正文不能为空（写清楚：什么时候、在哪、测出什么）" };
    const summary = oneLineSummary(args.summary ?? args.title ?? body, 40);
    if (!summary) return { ok: false, error: "缺少摘要（索引里显示的那一行）" };
    const type = WRITE_TYPES.has(String(args.type)) ? (String(args.type) as AtomMeta["type"]) : "fact";
    const group = targetScope === "session" ? String(args.group ?? input.groupId ?? "") : "";
    const meta = toMeta({
      id: normalizeId(args.id ?? summary),
      summary,
      group,
      type,
      scope: targetScope,
      confidence: String(args.confidence) === "tentative" ? "tentative" : "confirmed",
      created: new Date().toISOString().slice(0, 10),
      updated: new Date().toISOString().slice(0, 10),
      source: { kind: "session", ref: String(args.origin ?? "模型在会话里写入") },
      tags: Array.isArray(args.tags) ? args.tags : String(args.tags ?? "").split(/[,，\s]+/).filter(Boolean),
      supersedes: Array.isArray(args.supersedes) ? args.supersedes : [],
      expiresAt: String(args.expiresAt ?? ""),
      evidence: Array.isArray(args.evidence) ? args.evidence : [],
    });
    if (!meta) return { ok: false, error: "id 或摘要不合法" };
    const outcome = await writeAtom(workspace, meta, body, "capture");
    await regenerateIndex(workspace);
    if (outcome === "skipped") return { ok: false, error: "没有写成（id 为空或文件不可写）" };
    return {
      ok: true,
      output: `${outcome === "same" ? "内容已是最新，未改动" : "已记下"}：${meta.id}（${meta.type} · ${meta.scope}${meta.group ? ` · 群 ${meta.group}` : ""}）。索引已重建。`,
    };
  }

  if (input.name === "memory_forget") {
    const id = normalizeId(args.id ?? args.key ?? "");
    if (!id) return { ok: false, error: "要作废哪一条？给 id（在记忆索引里是 [[id]]）" };
    /* ⛔⛔ 11-11 审查发现：`entries/session/<群id>/<id>.md` 允许**同一 id 在不同群各存一份**，
       只按 id 找会命中错误的那一条（或漏掉本群那条）⇒ 作废必须支持按群精确定位。
       group 为空 = 作废工作区级 / 唯一 id 的条目（旧行为零变化）。 */
    const group = String(args.group ?? "").trim();
    const { docs } = await readAtoms(workspace);
    const hit = docs.find((d) => d.meta.id === id
      && String(d.meta.group ?? "").trim() === group);
    if (!hit) return { ok: false, error: `找不到条目 ${id}${group ? `（群 ${group}）` : ""} —— 先用 memory_recall 查准确的 id${group ? "" : "；群记忆请带 group"}` };
    hit.meta.status = String(args.reason ?? "").includes("过期") ? "expired" : "superseded";
    hit.meta.updated = new Date().toISOString().slice(0, 10);
    const note = String(args.reason ?? "").trim();
    const outcome = await writeAtom(workspace, hit.meta, `${hit.body}\n\n> ${hit.meta.status === "expired" ? "已过期" : "已作废"}${note ? `：${note}` : ""}`, "manual");
    await regenerateIndex(workspace);
    if (outcome === "skipped") return { ok: false, error: "没有写成（文件不可写）" };
    return { ok: true, output: `已标记为 ${hit.meta.status}：${id}（文件保留，可查；不再注入）。` };
  }

  return { ok: false, error: `不认识的内存工具：${input.name}` };
}
