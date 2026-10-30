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
import { storedReportsForThread } from "../turn-file-watch";

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
};

type MonitorFile = { threadId: string; turns: MonitorTurn[] };

/** 每个会话最多留 40 轮（用户：产物最多展示 30~40 个） */
const MAX_TURNS = 40;
const FILE_NAME = (threadId: string) => `${threadId.replace(/[^\w.-]+/g, "_").slice(0, 80)}.json`;
const dirOf = () => path.join(app.getPath("userData"), "task-monitor");

const store = new Map<string, MonitorTurn[]>();
/** 正在累积的回合：key = `${threadId}:${turnId}` */
const live = new Map<string, { threadId: string; turnId: string; skills: Set<string>; mcp: Set<string>; plugins: Set<string> }>();

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

const skillOfCommand = (text: string): string => {
  const hit = /[\\/]skills[\\/]([^\\/"'\s]+)[\\/]SKILL\.md/i.exec(text);
  return hit ? hit[1] : "";
};

/**
 * 引擎事件钩子（boot 在 event 分发给渲染层之前调用；⛔ 同步、不 await）。
 * 只关心两类：item/*（累积工具使用）、turn/completed（结算 + 触发建议）。
 */
export function noteEngineEvent(method: string, params: any): void {
  try {
    const threadId = String(params?.threadId ?? "");
    if (!threadId) return;
    const turnId = String(params?.turnId ?? params?.turn?.id ?? "");
    if (!turnId) return;
    const key = `${threadId}:${turnId}`;

    if (method === "item/started" || method === "item/completed") {
      const item = params?.item ?? params;
      const bucket = live.get(key) ?? { threadId, turnId, skills: new Set<string>(), mcp: new Set<string>(), plugins: new Set<string>() };
      live.set(key, bucket);
      const type = String(item?.type ?? "");
      const name = String(item?.name ?? item?.toolName ?? item?.command ?? "");
      /* 技能：引擎里没有"技能调用"事件，靠 `…/skills/<名>/SKILL.md` 字面特征认（与渲染层同一口径）。 */
      const fromCmd = skillOfCommand(`${item?.command ?? ""} ${item?.filePath ?? ""} ${item?.path ?? ""}`);
      if (fromCmd) bucket.skills.add(fromCmd);
      /* MCP：工具名带 mcp__ 前缀，或引擎直接给 mcpToolCall 类型。 */
      if (/^mcp__/.test(name) || /mcp/i.test(type)) {
        const label = name.replace(/^mcp__/, "").replace(/__/g, " · ") || type;
        if (label) bucket.mcp.add(label.slice(0, 60));
      }
      /* 插件/宿主能力：声明插件的工具与网关工具统一归到这一类（用户口径："插件"）。 */
      if (/^harness_/.test(name)) bucket.plugins.add(name.replace(/^harness_/, "").slice(0, 40));
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

/** 回合结算：把这一轮的使用情况 + 产物落成一条记录，并在「有动作」时异步生成建议。 */
async function settleTurn(threadId: string, turnId: string, bucket?: { skills: Set<string>; mcp: Set<string>; plugins: Set<string> }) {
  const turns = await load(threadId);
  if (turns.some((t) => t.turnId === turnId)) return;      // 幂等：重放事件不重复记

  /* 产物：走既有真相源（turn-file-watch 的落盘报告），⛔ 不在这里重复扫盘。 */
  let artifacts: MonitorArtifact[] = [];
  try {
    const report = storedReportsForThread(threadId).find((r) => r.turnId === turnId);
    artifacts = (report?.files ?? []).map((f: any) => ({
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
  if (acted) void generateSuggestion(threadId, turnId);
}

/** 用**本会话的模型**生成 1~3 条可执行的改进建议（复用记忆蒸馏的一次性内部会话通道）。 */
async function generateSuggestion(threadId: string, turnId: string) {
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
  ].join("\n");

  try {
    const text = await distillSummarize(
      "你是这个桌面助手的内省模块。基于「这一轮干了什么」，给出 1~3 条**可执行的自我改进建议**。"
      + "要求：每条一行、以「- 」开头、不超过 40 字、针对具体动作（流程/命令/验证/协作），"
      + "不要复述做了什么，不要客套，不要编号说明。只输出这几行。",
      digest,
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

export const taskMonitorFeature = defineFeature<null>({
  id: "monitor",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("monitor: 缺少 ipc 服务（宿主未提供）");
    ipcHost.handle("monitor:read", async (_event: unknown, threadId?: string) => {
      const id = String(threadId ?? "").trim();
      /* ⛔ 按会话独立：没有 threadId 就给空表，绝不"猜一个最近的"。 */
      if (!id) return { threadId: "", turns: [] as MonitorTurn[] };
      return { threadId: id, turns: await load(id) };
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
  },
});
