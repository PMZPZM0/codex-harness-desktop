/**
 * 任务监控（10-30 用户令）：右栏「监控」页的数据源 —— **按会话独立**。
 *
 * 用户原话：「右侧栏加一个任务监控按键……第一个进化建议（自我改进建议）可以同步给 Agent，
 * 由本会话当前 Codex 输出；一键净化就带上自我进化技能发给 Codex，内容可改；
 * 下面依次是技能 / MCP / 插件（本回合用了什么）、再下面是会话产物（每回合，最多 30~40，分页）；
 * 技能最多 5 个/页、只看当前回合与上回合；都要每回合更新；每个会话独立，不要串。」
 *
 * ── 为什么采集放主进程 ──────────────────────────────────────────────
 * 渲染层拿不到「完整的一轮都调了什么」：工具项分散在回合槽里，历史回合还可能被折叠/卸载。
 * 主进程在**引擎事件流**上本来就看得见每一条 item（boot 的 event 分发），且回合产物已经有
 * `turn-file-watch.storedReportsForThread()` 这个真相源 ⇒ 在这里聚合最省、也最不会漏。
 *
 * ── 三条硬约束 ──────────────────────────────────────────────────────
 *  ① **按会话独立**：一切状态以 threadId 为键，落盘 `<userData>/task-monitor/<id>.json`，
 *     读取端只认传入的 threadId（⛔ 不许"取最近一个"这种跨会话兜底）。
 *  ② **绝不阻塞回合**：所有采集同步完成、生成走 async，任何失败只记日志。
 *  ③ 建议由**本会话的模型**产出（复用 `distillSummarize` 的一次性内部会话），且只在
 *     「这轮有动作（工具/改文件/技能）」时才跑 —— 纯聊天轮不烧 token。
 */
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { distillSummarize } from "../main/03-turn-summary";
import { liveFilesOf, storedReportsForThread } from "../turn-file-watch";
import { engineActiveTurnIds, server } from "../runtime-refs";
import { GROUP_EVENT_TAG, hostQueueMessageId } from "../../src/lib/host-queue.mjs";
/* 技能/插件的识别口径与**技能卡完全同源**（src/lib/tool-display.mjs）；⛔ 不要在这里另写正则。 */
import { pluginOfItem, skillOfItem } from "../../src/lib/tool-display.mjs";

export type MonitorArtifact = { path: string; added: number; deleted: number; status?: string };

export type MonitorTurn = {
  turnId: string;
  at: number;
  /** 本回合命中的技能名（去重，最多 20） */
  skills: string[];
  /** 本回合调用的 MCP 工具（去重，最多 20） */
  mcp: string[];
  /** 本回合调用的宿主能力/插件类工具（harness_* / 声明插件） */
  plugins: string[];
  /** 本回合改动的文件（新增/修改/删除都算，口径与消息底部「已更改 N 个文件」一致） */
  artifacts: MonitorArtifact[];
  /** 本轮由模型产出的自我改进建议（可被用户编辑后覆盖） */
  suggestion: string;
  /** 建议是否正在生成 / 生成失败原因（前端据此显示状态，不用猜） */
  suggestionState: "idle" | "running" | "ready" | "failed";
  suggestionError?: string;
  /** true = 这一轮还在跑（面板据此标「本轮进行中」；结算后落盘的记录没有这个字段） */
  running?: boolean;
  /** 用户采纳这条建议的时刻（采纳 = 注入一条 `[群事件]` 让 Codex 把它沉淀成经验） */
  adoptedAt?: number;
};

type MonitorFile = { threadId: string; turns: MonitorTurn[] };

/** 每个会话最多留 40 轮（用户：产物最多展示 30~40 个） */
const MAX_TURNS = 40;
const FILE_NAME = (threadId: string) => `${threadId.replace(/[^\w.-]+/g, "_").slice(0, 80)}.json`;
const dirOf = () => path.join(app.getPath("userData"), "task-monitor");

const store = new Map<string, MonitorTurn[]>();
/** 正在累积的回合：key = `${threadId}:${turnId}` */
const live = new Map<string, Bucket>();

/** 进行中回合的累积桶；reply = 本轮最后一条模型回复（给「自我改进建议」当上下文，不落盘）。 */
type Bucket = { threadId: string; turnId: string; skills: Set<string>; mcp: Set<string>; plugins: Set<string>; reply: string };

const log = (...args: unknown[]) => console.log("[monitor]", ...args);

/* ── 落盘（原子写：先写 .tmp 再 rename，避免强杀留 0 字节）──────────────── */
async function persist(threadId: string, turns: MonitorTurn[]) {
  try {
    await fs.mkdir(dirOf(), { recursive: true });
    const file = path.join(dirOf(), FILE_NAME(threadId));
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ threadId, turns } satisfies MonitorFile, null, 1), "utf8");
    await fs.rename(tmp, file);
  } catch (error: any) {
    log("落盘失败（不影响本轮展示）", threadId.slice(0, 8), error?.message ?? error);
  }
}

async function load(threadId: string): Promise<MonitorTurn[]> {
  const cached = store.get(threadId);
  if (cached) return cached;
  let turns: MonitorTurn[] = [];
  try {
    const raw = await fs.readFile(path.join(dirOf(), FILE_NAME(threadId)), "utf8");
    const parsed = JSON.parse(raw) as MonitorFile;
    /* ⛔ 只认自己的：文件里写着别人的 threadId 就当损坏（换机器/手改过的兜底） */
    if (parsed && parsed.threadId === threadId && Array.isArray(parsed.turns)) turns = parsed.turns;
  } catch { /* 没有历史 = 空 */ }
  store.set(threadId, turns);
  return turns;
}

/**
 * 一条 item → 「它是技能 / MCP / 插件」的归类。
 *
 * ⛔⛔ 10-30 用户截图（「用了浏览器自动化，面板里一格都没有」）根因：这里原来只看
 *   `item.command / filePath / path` 找 `…/skills/<名>/SKILL.md`。而引擎把绝大多数工具调用
 *   报成 `mcpToolCall`（字段是 server / tool）或 `dynamicToolCall`（字段是 tool + arguments），
 *   技能路径往往在 **arguments 里**（`run_skill_script` 之类）—— 于是整轮一条都认不出来。
 * ⇒ 直接复用渲染层的单一真相源 `skillOfItem` / `pluginOfItem`（技能卡用的就是它们），
 *   ⛔ 不在这里另写一套正则（两套口径必然漂移，用户看到的就是"卡上有、面板没有"）。
 */
function classifyItem(item: any): { skill: string; mcp: string; plugin: string } {
  const type = String(item?.type ?? "");
  const skillHit = (() => { try { return skillOfItem(item); } catch { return null; } })();
  const pluginHit = (() => { try { return pluginOfItem(item); } catch { return null; } })();
  const skill = skillHit ? String(skillHit.label || skillHit.skill || "").slice(0, 40) : "";
  /* MCP：mcpToolCall 的真实字段是 server / tool（⛔ 不是 name）；也兼容模型侧 mcp__ 前缀。 */
  const rawTool = String(item?.tool ?? item?.name ?? "");
  const mcp = type === "mcpToolCall"
    ? `${String(item?.server ?? "")} · ${String(item?.tool ?? "")}`.replace(/^ · | · $/g, "").slice(0, 60)
    : /^mcp__/.test(rawTool) ? rawTool.replace(/^mcp__/, "").replace(/__/g, " · ").slice(0, 60) : "";
  /* 插件 / 宿主能力：声明插件的路径命中，或网关工具（harness_*）。
     ⛔ 网关工具的真实能力名在 `arguments.tool`（`harness_tools{ tool: "knowledge_search" }`）——
     直接剥前缀只会得到 "tools"，等于没信息。 */
  const argTool = String((item?.arguments as any)?.tool ?? (item?.arguments as any)?.name ?? "").trim();
  const plugin = skill ? ""
    : pluginHit ? String(pluginHit.plugin ?? "").slice(0, 40)
      : /^harness_/.test(rawTool) ? (argTool || rawTool.replace(/^harness_/, "")).slice(0, 40) : "";
  return { skill, mcp, plugin };
}

/**
 * 引擎事件钩子（boot 在 event 分发给渲染层之前调用；⛔ 同步、不 await）。
 * 关心两类：item/*（**逐条累积**，所以进行中的回合也能被面板读到）、turn 收尾（结算 + 触发建议）。
 */
export function noteEngineEvent(method: string, params: any): void {
  try {
    const threadId = String(params?.threadId ?? "");
    if (!threadId) return;
    /* ⛔ turnId 的取法与 boot / turn-end 同源：`turn.id` 优先，其次 turnId / id。
       只认 turnId（原先的写法）会漏掉带 `turn:{id}` 的形态 ⇒ 整轮 bucket 建不起来。 */
    const turnId = String(params?.turn?.id ?? params?.turnId ?? params?.id ?? "");
    if (!turnId) return;
    const key = `${threadId}:${turnId}`;

    if (method === "item/started" || method === "item/completed") {
      const item = params?.item ?? params;
      const bucket = live.get(key) ?? { threadId, turnId, skills: new Set<string>(), mcp: new Set<string>(), plugins: new Set<string>(), reply: "" };
      live.set(key, bucket);
      /* 本轮最终回复：建议生成要看着它自己说了什么来提，不能只给工具清单。 */
      if (String(item?.type ?? "") === "agentMessage") {
        const text = String(item?.text ?? "").trim();
        if (text) bucket.reply = text.slice(0, 1200);
      }
      const hit = classifyItem(item);
      if (hit.skill) bucket.skills.add(hit.skill);
      if (hit.mcp) bucket.mcp.add(hit.mcp);
      if (hit.plugin) bucket.plugins.add(hit.plugin);
      return;
    }

    if (method === "turn/completed" || method === "turn/aborted" || method === "turn/failed" || method === "turn/interrupted") {
      const bucket = live.get(key);
      live.delete(key);
      void settleTurn(threadId, turnId, bucket);
    }
  } catch (error: any) {
    log("事件采集异常（忽略）", error?.message ?? error);
  }
}

/**
 * **进行中**那一轮的快照（10-30 用户：「完全没有跟当前会话联动」）。
 *
 * 原来只在 `turn/completed` 结算 ⇒ 正在跑的这一轮面板是 0 轮、无技能、无文件 —— 用户看到的就是「一个壳」。
 * 现在读的时候把 live bucket 也交出去：技能/MCP/插件从逐条 item 累积，产物取文件追踪的实时快照。
 * ⛔ 不做跨会话兜底：只挑与传入 threadId 相符的 bucket。
 */
function liveTurnOf(threadId: string): MonitorTurn | null {
  let bucket: { threadId: string; turnId: string; skills: Set<string>; mcp: Set<string>; plugins: Set<string> } | null = null;
  for (const entry of live.values()) if (entry.threadId === threadId) bucket = entry;   // Map 保持插入序 ⇒ 最后一条是最新回合
  if (!bucket) return null;
  const liveFiles = liveFilesOf(threadId);
  const artifacts: MonitorArtifact[] = (liveFiles && (!liveFiles.turnId || liveFiles.turnId === bucket.turnId) ? liveFiles.files : [])
    .map((f: any) => ({ path: String(f?.path ?? ""), added: Number(f?.added ?? 0) || 0, deleted: Number(f?.deleted ?? 0) || 0, status: String(f?.status ?? "") }))
    .filter((f) => f.path);
  return {
    turnId: bucket.turnId,
    at: Date.now(),
    skills: [...bucket.skills].slice(0, 20),
    mcp: [...bucket.mcp].slice(0, 20),
    plugins: [...bucket.plugins].slice(0, 20),
    artifacts,
    suggestion: "",
    suggestionState: "idle",
    /* ⛔ 面板据此标「本轮进行中」：不标的话用户分不清"还没跑完"和"没采到"。 */
    running: true,
  };
}

/** 回合结算：把这一轮的使用情况 + 产物落成一条记录，并在「有动作」时异步生成建议。 */
async function settleTurn(threadId: string, turnId: string, bucket?: Bucket) {
  const turns = await load(threadId);
  if (turns.some((t) => t.turnId === turnId)) return;      // 幂等：重放事件不重复记

  /* 产物：走既有真相源（turn-file-watch 的落盘报告），⛔ 不在这里重复扫盘。
     ⛔ 10-30：报告落盘有延迟（或本机没开文件追踪）时，退回**这一轮的实时快照** ——
     否则用户看到"本轮改了 13 个文件、面板里 0 个"。只在 turnId 相同时才用，绝不张冠李戴。 */
  let artifacts: MonitorArtifact[] = [];
  try {
    const report = storedReportsForThread(threadId).find((r) => r.turnId === turnId);
    const liveShot = report ? null : liveFilesOf(threadId);
    const files = report?.files ?? (liveShot && (!liveShot.turnId || liveShot.turnId === turnId) ? liveShot.files : []);
    artifacts = files.map((f: any) => ({
      path: String(f?.path ?? ""),
      added: Number(f?.added ?? 0) || 0,
      deleted: Number(f?.deleted ?? 0) || 0,
      status: String(f?.status ?? ""),
    })).filter((f) => f.path);
  } catch { /* 没有报告 = 这轮没动文件 */ }

  const record: MonitorTurn = {
    turnId,
    at: Date.now(),
    skills: [...(bucket?.skills ?? [])].slice(0, 20),
    mcp: [...(bucket?.mcp ?? [])].slice(0, 20),
    plugins: [...(bucket?.plugins ?? [])].slice(0, 20),
    artifacts,
    suggestion: "",
    suggestionState: "idle",
  };
  const next = [...turns, record].slice(-MAX_TURNS);
  store.set(threadId, next);
  await persist(threadId, next);

  /* ⛔ 纯聊天轮（没工具、没改文件）不生成 —— 用户要的是"改进建议"，没有动作就没有可改进的动作面。 */
  const acted = record.skills.length + record.mcp.length + record.plugins.length + record.artifacts.length > 0;
  /* ⛔ 10-30 用户：「让 codex 在回合快结束时自己输出」⇒ 每轮（有动作时）自动复盘，
     并把本轮回复一起交给它，产出才有针对性（原来只给工具清单，写出来必然是模板话）。 */
  if (acted) void generateSuggestion(threadId, turnId, String(bucket?.reply ?? ""));
}

/** 用**本会话的模型**生成 1~3 条可执行的改进建议（复用记忆蒸馏的一次性内部会话通道）。 */
async function generateSuggestion(threadId: string, turnId: string, reply = "") {
  const turns = await load(threadId);
  const target = turns.find((t) => t.turnId === turnId);
  if (!target || target.suggestionState === "running") return;
  target.suggestionState = "running";
  store.set(threadId, turns);

  const digest = [
    `技能：${target.skills.join("、") || "（未使用技能）"}`,
    `MCP：${target.mcp.join("、") || "（未调用）"}`,
    `插件/宿主能力：${target.plugins.join("、") || "（未调用）"}`,
    `改动文件：${target.artifacts.slice(0, 20).map((a) => `${a.path} +${a.added}/-${a.deleted}`).join("、") || "（无）"}`,
    reply ? `本轮我的回复（节选）：${reply.slice(0, 700)}` : "",
  ].filter(Boolean).join("\n");

  try {
    const text = await distillSummarize(
      "你是这个桌面助手的内省模块。基于「这一轮干了什么」，给出 1~3 条**可执行的自我改进建议**。"
      + "要求：每条一行、以「- 」开头、不超过 40 字、针对具体动作（流程/命令/验证/协作），"
      + "不要复述做了什么，不要客套，不要编号说明。只输出这几行。"
      /* ⛔ 配套 self-review 的四个检查面（10-30 用户：「工具配套好」）：不给检查面，模型只会写空话。 */
      + "\n重点看这四处：① 该验证却没验证（改了没跑/没看输出）；② 同一处反复失败才改对；"
      + "③ 该同步/该提交的改动留在工作区；④ 对用户原话的理解有偏差（要返工的那种）。",
      digest,
      /* ⛔ 带上会话 id：没有自定义模型时用**本会话自己的模型**（否则官方供应商用户永远暂无建议）。 */
      { threadId },
    );
    const clean = String(text || "").split(/\r?\n/).map((line) => line.trim())
      .filter((line) => line && !/^```/.test(line))
      .slice(0, 3).join("\n");
    target.suggestion = clean;
    target.suggestionState = clean ? "ready" : "failed";
    if (!clean) target.suggestionError = "模型没有返回内容";
  } catch (error: any) {
    target.suggestionState = "failed";
    target.suggestionError = String(error?.message ?? error).slice(0, 200);
  }
  store.set(threadId, turns);
  await persist(threadId, turns);
}

/** 找一个线程当前活跃的回合 id（没有则空串）。与 boss-groups runner 的取法同源。 */
function activeTurnOf(threadId: string): string {
  for (const [turnId, owner] of engineActiveTurnIds) if (owner === threadId) return turnId;
  return "";
}

/**
 * 往会话里投一条**宿主事件**（`[群事件]` 文本 + `host:` 队列 id）。
 *
 * ⛔⛔ 10-30 用户令：「点击以消息事件通知样式通知到 codex，**不是以用户消息**，跟群聊那个一样」。
 *   所以这里必须复用群聊那条通道（`turn/steer` 追加进当前回合 / 空闲时走 `thread/queue/add`
 *   + `queue/start`），并且文本带 `GROUP_EVENT_TAG` —— 渲染层据此按**事件块**渲染，
 *   `clientUserMessageId` 的 `host:` 前缀让排队面板不把它当"用户消息"。
 * ⛔ 不用 `turn/start`：那会打断正在跑的回合（用户正在看的那一轮会被掐掉）。
 */
async function deliverHostEvent(threadId: string, text: string): Promise<boolean> {
  try {
    const turnId = activeTurnOf(threadId);
    if (turnId) {
      const steered = await server.request("turn/steer", {
        threadId,
        expectedTurnId: turnId,
        input: [{ type: "text", text, text_elements: [] }],
      }).then(() => true).catch(() => false);
      if (steered) return true;
      /* steer 失败（回合刚好结束）⇒ 落到下面的队列路径。 */
    }
    await server.request("thread/queue/add", {
      threadId,
      input: [{ type: "text", text }],
      clientUserMessageId: hostQueueMessageId("evolve"),
    }).catch(() => null);
    const list: any = await server.request("thread/queue/list", { threadId, limit: 1 }).catch(() => null);
    const head = list?.data?.[0];
    if (head?.id) await server.request("thread/queue/start", { threadId, queuedSubmissionId: head.id }).catch(() => undefined);
    return true;
  } catch (error: any) {
    log("事件投递失败", String(error?.message ?? error).slice(0, 160));
    return false;
  }
}

/**
 * 「采取建议」下发给 Codex 的事件正文。
 *
 * ⛔ 要求它**沉淀**而不是复述：用户的目的（原话）是「codex 就开始自我学习进步，反思自己的不足，
 *   逐渐提升自己能力，减少犯错」—— 只说"好的我记住了"等于什么都没发生，必须落到记忆 / 技能 / AGENTS。
 */
function adoptEventText(suggestion: string): string {
  const body = String(suggestion ?? "").trim().slice(0, 2000);
  return [
    `${GROUP_EVENT_TAG}【自我进化 · 采纳建议】`,
    "用户采纳了下面这条关于你上一轮工作的改进建议：",
    "",
    body,
    "",
    "请把它转成**可复用的经验**，而不是回一句「好的」：",
    "① 判断它属于哪一类：流程 / 命令 / 验证 / 协作；",
    "② 落到对应的地方 —— 值得长期记住的写进记忆（memory_write，或项目 AGENTS.md 里对应段落）；",
    "   属于某个技能的写进那个技能的 SKILL.md（⛔ 别写进一次性对话里）；",
    "③ 之后的同类任务**先按它做**，并在收尾时自检有没有守住；",
    "④ 只回一句：已沉淀到哪里 + 这条经验的一句话摘要。",
  ].join("\n");
}

export const taskMonitorFeature = defineFeature<null>({
  id: "monitor",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("monitor: 缺少 ipc 服务（宿主未提供）");
    ipcHost.handle("monitor:read", async (_event: unknown, threadId?: string) => {
      const id = String(threadId ?? "").trim();
      /* ⛔ 按会话独立：没有 threadId 就给空表，绝不"猜一个最近的"。 */
      if (!id) return { threadId: "", turns: [] as MonitorTurn[], ongoingTurnId: "" };
      const settled = await load(id);
      /* 进行中那一轮也要给出去（用户：「完全没有跟当前会话联动」）—— 已结算的不重复追加。 */
      const ongoing = liveTurnOf(id);
      const turns = ongoing && !settled.some((t) => t.turnId === ongoing.turnId) ? [...settled, ongoing] : settled;
      return { threadId: id, turns, ongoingTurnId: ongoing?.turnId ?? "" };
    });

    ipcHost.handle("monitor:save-suggestion", async (_event: unknown, input?: { threadId?: string; turnId?: string; text?: string }) => {
      const id = String(input?.threadId ?? "").trim();
      const turnId = String(input?.turnId ?? "").trim();
      if (!id || !turnId) return { ok: false, error: "缺少会话或回合 id" };
      const turns = await load(id);
      const target = turns.find((t) => t.turnId === turnId);
      if (!target) return { ok: false, error: "这一轮还没有记录" };
      target.suggestion = String(input?.text ?? "").slice(0, 4000);
      target.suggestionState = target.suggestion ? "ready" : "idle";
      target.suggestionError = undefined;
      await persist(id, turns);
      return { ok: true };
    });

    ipcHost.handle("monitor:regenerate", async (_event: unknown, input?: { threadId?: string; turnId?: string }) => {
      const id = String(input?.threadId ?? "").trim();
      const turnId = String(input?.turnId ?? "").trim();
      if (!id || !turnId) return { ok: false, error: "缺少会话或回合 id" };
      void generateSuggestion(id, turnId);
      return { ok: true };
    });

    /**
     * 采纳建议（10-30 用户令）：「如果用户觉得进化建议可以，就采取建议……点击以消息事件通知样式
     * 通知到 codex，不是以用户消息」。
     * ⇒ ① 建议落盘并标 adoptedAt（面板显示「已采取」）；
     *   ② 往**本会话**投一条 `[群事件]`（与群聊同一通道、同一渲染块），Codex 收到后自己去沉淀经验。
     * ⛔ 不发 turn/start（会打断正在跑的回合），也不伪造用户消息。
     */
    ipcHost.handle("monitor:adopt", async (_event: unknown, input?: { threadId?: string; turnId?: string; text?: string }) => {
      const id = String(input?.threadId ?? "").trim();
      const turnId = String(input?.turnId ?? "").trim();
      const text = String(input?.text ?? "").trim();
      if (!id || !turnId) return { ok: false, error: "缺少会话或回合 id" };
      if (!text) return { ok: false, error: "这条建议是空的 —— 先让它生成一版，或自己写一条" };
      const turns = await load(id);
      const target = turns.find((t) => t.turnId === turnId);
      if (!target) return { ok: false, error: "这一轮还没有记录" };
      target.suggestion = text.slice(0, 4000);
      target.suggestionState = "ready";
      target.suggestionError = undefined;
      target.adoptedAt = Date.now();
      store.set(id, turns);
      await persist(id, turns);
      const delivered = await deliverHostEvent(id, adoptEventText(text));
      return { ok: true, delivered, error: delivered ? undefined : "建议已保存，但事件没送进会话（可能会话正在重启）" };
    });
  },
});
