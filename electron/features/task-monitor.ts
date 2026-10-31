/**
 * 任务监控（10-30 用户令）：右栏「监控」页的数据源 —— **按会话独立**。
 *
 * 用户原话：「右侧栏加一个任务监控按键……下面依次是技能 / MCP / 插件（本回合用了什么）、
 * 再下面是会话产物（每回合，最多 30~40，分页）；
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
 *  ② **绝不阻塞回合**：所有采集同步完成、写盘走 async，任何失败只记日志。
 *  ③ **只做记录，不再"自动复盘"**：10-31 用户令「自我进化建议这个板块和配套删了，不要了」——
 *     原来每轮结束都会起一条内省会话让模型写改进建议（外加自噬环事故），整条链已删除。
 *     ⛔ 别再把"回合结束顺手调一次模型"加回来：它既烧 token，又会让侧栏冒出内部会话。
 */
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import { liveFilesOf, storedReportsForThread } from "../turn-file-watch";
import { engineActiveTurnIds, internalThreads } from "../runtime-refs";
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
  /** true = 这一轮还在跑（面板据此标「本轮进行中」；结算后落盘的记录没有这个字段） */
  running?: boolean;
};

type MonitorFile = { threadId: string; turns: MonitorTurn[] };

/** 每个会话最多留 40 轮（用户：产物最多展示 30~40 个） */
const MAX_TURNS = 40;
const FILE_NAME = (threadId: string) => `${threadId.replace(/[^\w.-]+/g, "_").slice(0, 80)}.json`;
const dirOf = () => path.join(app.getPath("userData"), "task-monitor");

const store = new Map<string, MonitorTurn[]>();
/** 正在累积的回合：key = `${threadId}:${turnId}` */
const live = new Map<string, Bucket>();

/** 进行中回合的累积桶。 */
type Bucket = { threadId: string; turnId: string; skills: Set<string>; mcp: Set<string>; plugins: Set<string> };

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
    /* ⛔⛔ 10-31 用户（截图 +「有病吗」）：**内部会话的回合不参与复盘**。
       不加这道闸就是一个自噬环：某轮结束 → 生成建议 → `distillSummarize` 建一条内省会话
       → 内省会话的回合结束又触发复盘 → 再建一条 …… 实测 30 秒刷出 9 条会话，侧栏被
       「你是这个桌面助手的…」刷屏。⛔ 别只在「生成建议」里判重（每条新会话的 store 都是空的，
       判重在**会话维度**上永远不命中）。 */
    if (internalThreads.has(threadId)) return;
    /* ⛔ turnId 的取法与 boot / turn-end 同源：`turn.id` 优先，其次 turnId / id。
       只认 turnId（原先的写法）会漏掉带 `turn:{id}` 的形态 ⇒ 整轮 bucket 建不起来。 */
    const turnId = String(params?.turn?.id ?? params?.turnId ?? params?.id ?? "");
    if (!turnId) return;
    const key = `${threadId}:${turnId}`;

    if (method === "item/started" || method === "item/completed") {
      const item = params?.item ?? params;
      const bucket = live.get(key) ?? { threadId, turnId, skills: new Set<string>(), mcp: new Set<string>(), plugins: new Set<string>() };
      live.set(key, bucket);
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
    /* ⛔ 面板据此标「本轮进行中」：不标的话用户分不清"还没跑完"和"没采到"。 */
    running: true,
  };
}

/** 回合结算：把这一轮的使用情况 + 产物落成一条记录。 */
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
  };
  const next = [...turns, record].slice(-MAX_TURNS);
  store.set(threadId, next);
  await persist(threadId, next);
}

/** 找一个线程当前活跃的回合 id（没有则空串）。与 boss-groups runner 的取法同源。 */
function activeTurnOf(threadId: string): string {
  for (const [turnId, owner] of engineActiveTurnIds) if (owner === threadId) return turnId;
  return "";
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
      /* ★ 10-31 用户实测「回合结束后刷新还显示下一回合」：引擎那边已经没有活动回合，但 bucket
         还在（turn 收尾事件丢了 / 回放时序错位）⇒ 面板会一直把它当「本轮进行中」，并且每 3s
         轮询一次、看起来像"自动刷新出下一回合"。这里补一次幂等结算，然后按已结算读。 */
      const stale = liveTurnOf(id);
      if (stale && !activeTurnOf(id)) {
        const staleBucket = live.get(`${id}:${stale.turnId}`);
        live.delete(`${id}:${stale.turnId}`);
        await settleTurn(id, stale.turnId, staleBucket);
      }
      const settled = await load(id);
      /* 进行中那一轮也要给出去（用户：「完全没有跟当前会话联动」）—— 已结算的不重复追加。 */
      const ongoing = liveTurnOf(id);
      const turns = ongoing && !settled.some((t) => t.turnId === ongoing.turnId) ? [...settled, ongoing] : settled;
      return { threadId: id, turns, ongoingTurnId: ongoing?.turnId ?? "" };
    });
  },
});
