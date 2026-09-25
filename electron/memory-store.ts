/**
 * memory-store：L3 碎片池（自动捕获的长期记忆）—— 域文件。
 *
 * 09-22 从 electron/harness-services.ts 拆出（纯搬迁）。原文件名"服务"是个杂物袋：
 * 记忆碎片池与自动化调度器两个**无关的域**共处一文件 1080 行。以文件内的
 * 「自动化调度引擎」分隔注释为界切开，本文件只留记忆面。
 *
 * 职责：recall / search（分词召回，中文 2-gram）/ captureTurn（自动捕获，纠错优先）
 *       / pruneNow（TTL 与容量淘汰，规则在 ./memory-prune）/ upsert / remove / stats。
 * ⛔ 淘汰不静默丢：临时条目归档进 L2 当日日志，之后随日志被蒸馏接进 L1。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { safeProviderId } from "./provider-id";
import { randomUUID } from "node:crypto";
import type { CodexServer } from "./codex-server";
import { MEMORY_CATEGORY_WEIGHT, MEMORY_MAX_RECORDS, MEMORY_TTL_MS, pickPrunable } from "./memory-prune";
import { debugMemoryCapture } from "./memory-capture-debug";
import { buildLessonLine, buildLogEntry, buildUserProfileLine, shouldCapture } from "./memory-lessons";
import { isScratchWorkspace } from "./memory-layers";
export const MEMORY_CATEGORIES = ["用户偏好", "项目背景", "工作流/SOP", "任务经验", "临时上下文"] as const;
/**
 * L3 碎片池的生命周期（09-22 补）：UI 的 P3 一直写着「自动衰减 / 可清理」，实现里从来没有 ——
 * 实测 64 条里 60 条是「临时上下文」，不淘汰就会一路涨到把召回信噪比拖垮。
 * 判定规则（TTL / 容量 / pinned 保护）在 ./memory-prune（纯函数，预检【97】跑真实现），
 * 这里只管节流与落盘；⛔ 淘汰不静默丢：临时条目归档进 L2 当日日志，之后随日志被蒸馏接进 L1。
 */
const MEMORY_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** 自动捕获的简单分词：中文按 2-gram（整句一个 token 会让去重/召回对中文失效），英文按空格 */
function tokenize(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[\u3000-\u303f\uff00-\uffef]/g, "");
  const tokens: string[] = [];
  for (const chunk of cleaned.split(/[^\p{L}\p{N}]+/u)) {
    if (/\p{Script=Han}/u.test(chunk)) {
      const compact = chunk.replace(/[^\p{L}\p{N}]/gu, "");
      for (let i = 0; i + 2 <= compact.length; i++) tokens.push(compact.slice(i, i + 2));
      if (compact.length === 1) tokens.push(compact);
    } else if (chunk.length >= 2) {
      tokens.push(chunk);
    }
  }
  return tokens;
}
/**
 * 日志摘要（09-22 迁到 ./memory-lessons 纯模块，便于预检直接跑真断言）。
 * 关键变化：`结果` 取的是**结论段**（偏好末尾）而不是开头 240 字；命中纠错/失败时额外产「坑」行。
 */

export type MemoryCategory = typeof MEMORY_CATEGORIES[number];
export type MemoryRecord = {
  id: string;
  category: MemoryCategory;
  content: string;
  sourceThreadId?: string;
  sourceTurnId?: string;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  /** 所属工作区：项目记忆按此过滤/加权 */
  workspace?: string;
  /** 核心内容保护：true 的重要记忆不被自动清理、检索置顶 */
  pinned?: boolean;
};
export type MemoryRemoteConfig = { endpoint: string; apiKey: string; sessionKey: string; userId: string };

export class MemoryStore {
  private records: MemoryRecord[] = [];
  private loaded = false;
  private remote?: MemoryRemoteConfig;
  private lastPruneAt = 0;
  private prunedTotal = 0;

  /** L2 每日日志 + L1.5 坑与纪律的落点：自动捕获的唯一出口，长期记忆层（L1 MEMORY.md）不在这里写。
   *  `appendLesson` 第四参 = **分类**（「用户纠错」单独一类，正常落 `## 用户纠错` 节，注入最前）。 */
  private layers?: { appendLog(workspace: string, summary: string): Promise<void>; appendLesson?(workspace: string, line: string, dedupeKey: string, category?: string): Promise<boolean>; appendUserProfile?(line: string): Promise<boolean> };

  constructor(private readonly file: string) {}

  /** 注入记忆分层模块（结构化类型，避免与 electron/memory-layers 产生循环依赖） */
  setLayers(layers: { appendLog(workspace: string, summary: string): Promise<void>; appendLesson?(workspace: string, line: string, dedupeKey: string, category?: string): Promise<boolean>; appendUserProfile?(line: string): Promise<boolean> }) { this.layers = layers; }

  setRemote(config?: MemoryRemoteConfig) { this.remote = config?.endpoint ? config : undefined; }

  remoteStatus() { return { configured: Boolean(this.remote), endpoint: this.remote?.endpoint ?? "" }; }

  async recall(query: string, opts?: { workspace?: string }) {
    if (!this.remote) return { context: (await this.search(query, 10, opts)).map((entry) => `[${entry.category}] ${entry.content}`).join("\n"), remote: false };
    const response = await this.remoteRequest("/recall", { query, session_key: this.remote.sessionKey, user_id: this.remote.userId });
    return { context: String(response.context ?? ""), remote: true, memoryCount: response.memory_count ?? 0 };
  }

  async captureTurn(threadId: string, userContent: string, assistantContent: string, opts?: { workspace?: string; includeWorkspace?: boolean }) {
    if (!userContent.trim() && !assistantContent.trim()) return;
    if (opts?.includeWorkspace === false) return;
    // 云端模式：照旧转发给远程
    if (this.remote) {
      await this.remoteRequest("/capture", { user_content: userContent, assistant_content: assistantContent, session_key: `${this.remote.sessionKey}:${threadId}`, session_id: threadId, user_id: this.remote.userId }).catch(() => undefined);
      return;
    }
    // 本地模式：自动捕获只落 L2 日志（不依赖云端）
    await this.localCapture(userContent, assistantContent, opts?.workspace);
  }

  /**
   * 本地自动捕获：往 L2 每日日志追加一条摘要；**检测到纠错/失败时额外产出一条「坑」写进 LESSONS.md**。
   *
   * 写入门禁（这套能不能用的生死线）：
   *   · 自动流程绝不写 L1 `MEMORY.md`（旧实现把 user+assistant 截断 500 字塞进 records，噪音只进不出，
   *     两周就退化成垃圾桶）；L1 只能由蒸馏（memory-layers.distill）或用户手动写。
   *   · 09-22 新增的 **L1.5 `LESSONS.md`（坑与纪律）是唯一例外**：它只接收"现象 → 根因/解法"单行候选，
   *     带现象去重键，且是独立文件（不参与日志归档）—— 因为"踩过的坑"必须留痕，否则同样的坑会反复踩。
   */
  private async localCapture(userContent: string, assistantContent: string, workspace?: string) {
    // ⛔ 每个出口都留痕：原实现全靠 .catch(() => undefined) 吞异常，捕获链断了几周没人知道
    // 09-22：cwd 在 scratch（无工作区聊天）⇒ 视为无工作区 —— 记忆写进临时目录 = 构建即清 = 假记忆
    if (workspace && isScratchWorkspace(workspace)) workspace = undefined;
    const debug = (reason: string, extra: Record<string, unknown> = {}) => debugMemoryCapture({ method: "localCapture", reason, workspace: workspace ?? null, userLen: userContent.length, assistantLen: assistantContent.length, hasLayers: Boolean(this.layers), ...extra });
    const verdict = shouldCapture(userContent, assistantContent);
    if (!verdict.record) return debug(verdict.reason);
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    /* L0 用户档案：写在 userData、**跨工作区** ⇒ 没有工作区（含 scratch 聊天）也要积累 ——
       这正是它与 L2-L6 的根本区别，所以**必须放在 no-workspace 早退之前**。
       09-22 前 appendUserProfile 只有实现与预检【108】，**生产代码零调用点** ⇒ L0 永远是空的，
       跨项目画像无从积累（用户实测痛点）。这里就是它的执行者。 */
    if (this.layers && typeof this.layers.appendUserProfile === "function") {
      const profile = buildUserProfileLine({ userContent, date });
      if (profile) {
        await this.layers.appendUserProfile(profile.line)
          .then((added: boolean) => debug(added ? "profile-written" : "profile-duplicate", { basis: profile.basis }))
          .catch((error: any) => debug("profile-failed", { error: error?.message ?? String(error) }));
      }
    }
    if (!workspace || !this.layers) return debug("no-workspace-or-layers");
    const summary = buildLogEntry(userContent, assistantContent);
    if (!summary) return debug("empty-summary");
    await this.layers.appendLog(workspace, summary)
      .then(() => debug("written", { forced: verdict.forced }))
      .catch((error: any) => debug("append-failed", { error: error?.message ?? String(error) }));
    /* 纪律行：单独一条，写进 L1.5 的**对应分类节**（纠错单独一节；去重靠现象首句，重复出现不再追加） */
    const lesson = buildLessonLine({ userContent, assistantContent, date });
    if (!lesson) return;
    if (typeof this.layers.appendLesson !== "function") return debug("lesson-unsupported");
    await this.layers.appendLesson(workspace, lesson.line, lesson.dedupeKey, lesson.category)
      .then((added: boolean) => debug(added ? "lesson-written" : "lesson-duplicate", { basis: lesson.basis, category: lesson.category }))
      .catch((error: any) => debug("lesson-failed", { error: error?.message ?? String(error) }));
  }

  async list(category?: string) {
    await this.load();
    await this.pruneIfDue({ persist: false });
    return this.records.filter((entry) => !category || entry.category === category).sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.updatedAt - a.updatedAt);
  }

  async search(query: string, limit = 8, opts?: { workspace?: string }) {
    await this.load();
    const terms = tokenize(query);
    if (!terms.length) return [];
    const unique = [...new Set(terms)];
    const now = Date.now();
    const DAY = 86_400_000;
    const scored = this.records
      .map((entry) => {
        // 命中的**不同**查询词个数（去重后 —— 旧口径直接 reduce(terms)，同一词重复出现会重复计分）。
        // ⛔ 不要再「除以 unique.length 做归一化」：hits 的上限本来就是 unique.length，
        //    除以它对所有候选是同一个常数因子 ⇒ 排序完全不变，是空改进（09-22 评审实测证否）。
        const haystack = entry.content.toLowerCase();
        const hits = unique.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        if (!hits) return null;
        // 分类权重
        const catWeight = MEMORY_CATEGORY_WEIGHT[entry.category] ?? 1;
        // 项目记忆：同工作区命中加权，跨工作区降权
        const wsWeight = opts?.workspace
          ? (entry.workspace ? (entry.workspace === opts.workspace ? 1.4 : 0.5) : 1)
          : 1;
        // 时间衰减：越近越相关（7 天半衰）
        const age = Math.max(0, now - entry.updatedAt);
        const timeWeight = Math.pow(0.5, age / (7 * DAY));
        // pinned 置顶
        const pinBoost = entry.pinned ? 2 : 1;
        const score = hits * catWeight * wsWeight * timeWeight * pinBoost;
        return { entry, score };
      })
      .filter((x): x is { entry: MemoryRecord; score: number } => x !== null && x.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt)
      .slice(0, limit)
      .map(({ entry }) => entry);
    return scored;
  }

  /**
   * L3 生命周期清理（节流；返回本次淘汰条数）。
   * ⛔ 只淘汰非 pinned：pinned 是用户显式保护的 P0，任何自动流程都不许动它
   *    （因此 pinned 超过容量上限时上限让位，见 memory-prune 的契约说明）。
   * ⛔ persist:false（读接口路径）只做内存淘汰 + 留痕，**不写库文件**：否则 `list()` 会与
   *    `upsert()` 争同一个文件的 writeFile，两次写的完成顺序无保证 ⇒ 可能丢刚写入的记忆。
   *    落盘留给下一次写路径（upsert / remove / reset 都会全量 save）。
   * ⛔ 写盘成功后才改内存与节流位：写失败时不留「内存已截断、盘还在、且 6 小时不再重试」的不一致。
   */
  private async pruneIfDue(opts: { force?: boolean; persist?: boolean } = {}): Promise<number> {
    const now = Date.now();
    if (!opts.force && this.lastPruneAt && now - this.lastPruneAt < MEMORY_PRUNE_INTERVAL_MS) return 0;
    const { keep, dropped } = pickPrunable(this.records, { now });
    if (!dropped.length) {
      if (opts.persist !== false) this.lastPruneAt = now;
      return 0;
    }
    if (opts.persist !== false) {
      await this.save(keep);
      this.lastPruneAt = now;
    }
    this.records = keep;
    this.prunedTotal += dropped.length;
    await this.archiveDropped(dropped);
    return dropped.length;
  }

  /**
   * 记忆管理面：手动触发一次碎片池整理（跳过 6 小时节流，强制落盘 + 写 pruned.jsonl 留痕）。
   * ⛔ pinned 与「用户纠错」类永不淘汰（`isProtected`，见 memory-prune）—— 用户点这个按钮不会丢纠错记忆。
   */
  async pruneNow(): Promise<number> {
    return this.pruneIfDue({ force: true });
  }

  /**
   * 淘汰留痕：写 `{workspace}/.codex-harness/memory/pruned.jsonl`（追加，一行一条）。
   * ⛔ 不写进 L2 日志：L2 满 30 天会被蒸馏进 L1 —— 把「14 天没人用」的噪音换条路固化成永久记忆，
   *    与淘汰目的相反（09-22 评审指出）。该文件不参与注入、不参与蒸馏，只供追溯。
   * ⛔ 没有 workspace 的条目没有归档位置，只能丢弃 —— 这里诚实记录，不再声称「永不丢」。
   */
  private async archiveDropped(dropped: MemoryRecord[]) {
    const byWorkspace = new Map<string, MemoryRecord[]>();
    for (const entry of dropped) {
      if (!entry.workspace) continue;
      byWorkspace.set(entry.workspace, [...(byWorkspace.get(entry.workspace) ?? []), entry]);
    }
    const at = Date.now();
    for (const [workspace, list] of byWorkspace) {
      const file = path.join(workspace, ".codex-harness", "memory", "pruned.jsonl");
      const lines = list
        .map((entry) => JSON.stringify({ id: entry.id, category: entry.category, content: entry.content.slice(0, 200), updatedAt: entry.updatedAt, reason: entry.category === "临时上下文" ? "ttl" : "capacity", at }))
        .join("\n");
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.appendFile(file, lines + "\n", "utf8");
      } catch { /* 留痕失败不影响清理本身 */ }
    }
  }

  /** 记忆库健康度：供设置页 / 记忆中心显示（09-22 补：此前只有条数，看不见过期与淘汰） */
  async stats() {
    await this.load();
    const now = Date.now();
    const byCategory: Record<string, number> = {};
    let pinned = 0;
    let expiring = 0;
    let expiringSoon = 0;
    for (const entry of this.records) {
      byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
      if (entry.pinned) pinned += 1;
      if (entry.category === "临时上下文" && !entry.pinned) {
        const age = now - entry.updatedAt;
        if (age > MEMORY_TTL_MS) expiring += 1;
        else if (age > MEMORY_TTL_MS * 0.75) expiringSoon += 1;
      }
    }
    return { total: this.records.length, byCategory, pinned, expiring, expiringSoon, prunedTotal: this.prunedTotal, lastPruneAt: this.lastPruneAt, max: MEMORY_MAX_RECORDS, ttlDays: MEMORY_TTL_MS / 86_400_000 };
  }

  async upsert(input: Partial<MemoryRecord> & Pick<MemoryRecord, "content" | "category">) {
    await this.load();
    /* scratch 会话（无工作区聊天）的 cwd 构建即清 ⇒ 写进去就是假归属（09-23 实证：本会话开头注入的两条
       正是 scratch 归属）。守卫必须在**所有**写 L7 的入口，不是只在 layers 侧（localCapture:117 / projectDir:274）。
       ⚠️ 已知遗留（09-23 评审指出）：这里只堵住「假归属落库」。search() 对 workspace 为 undefined 的条目
          给权重 1（中性）⇒ 仍可能被任何工作区召回；真正的「按工作区隔离召回」是另一件事，本轮未改。 */
    if (input.workspace && isScratchWorkspace(input.workspace)) input = { ...input, workspace: undefined };
    const now = Date.now();
    const existing = input.id ? this.records.find((entry) => entry.id === input.id) : undefined;
    const record: MemoryRecord = existing ? { ...existing, ...input, updatedAt: now } as MemoryRecord : {
      id: input.id ?? randomUUID(),
      category: input.category,
      content: input.content.trim(),
      sourceThreadId: input.sourceThreadId,
      sourceTurnId: input.sourceTurnId,
      confidence: Math.min(1, Math.max(0, Number(input.confidence ?? 0.8))),
      workspace: input.workspace,
      pinned: input.pinned,
      createdAt: now,
      updatedAt: now,
    };
    if (!record.content) throw new Error("记忆内容不能为空");
    if (!MEMORY_CATEGORIES.includes(record.category)) throw new Error("未知记忆分类");
    this.records = existing ? this.records.map((entry) => entry.id === record.id ? record : entry) : [record, ...this.records];
    await this.save();
    await this.pruneIfDue();
    if (this.remote) await this.remoteRequest("/capture", { user_content: record.content, assistant_content: "", session_key: this.remote.sessionKey, user_id: this.remote.userId }).catch(() => undefined);
    return record;
  }

  async remove(id: string) {
    await this.load();
    this.records = this.records.filter((entry) => entry.id !== id);
    await this.save();
  }

  async reset() {
    this.records = [];
    this.loaded = true;
    await this.save();
  }

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    let raw: string;
    try {
      raw = await fs.readFile(this.file, "utf8");
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
      return;
    }
    try {
      this.records = JSON.parse(raw);
      return;
    } catch { /* 落到自愈 */ }
    // ⛔ 自愈：文件损坏（09-25 实测出现「合法 JSON 之后被并发写追加了一截文本」的撕裂形态）
    //    ⇒ 备份损坏原件，按「最长可解析前缀」恢复，绝不因坏文件让 memory:list 永远报错。
    const backup = this.file + ".corrupt-" + Date.now();
    await fs.writeFile(backup, raw, "utf8");
    let recovered = 0;
    for (let end = raw.length; end > 0; end--) {
      if (raw[end - 1] !== "]") continue; // 数组结束候选（本文件就是 JSON.stringify(list) 的形态）
      try {
        const parsed = JSON.parse(raw.slice(0, end));
        if (!Array.isArray(parsed)) continue;
        await fs.writeFile(this.file, JSON.stringify(parsed, null, 2) + "\n", "utf8"); // 原子化后的 save 会在下次写时收紧
        this.records = parsed;
        recovered = parsed.length;
        break;
      } catch { /* 继续向前找 */ }
    }
    console.warn(`[memory] memory.json 损坏已自愈：备份 ${path.basename(backup)}，恢复 ${recovered} 条` + (recovered ? "" : "（恢复失败，按空列表启动；损坏原件已保留）"));
  }

  /** ⛔ 原子写：先写同盘临时文件再 rename —— 直接 writeFile 在并发/崩溃时会留下撕裂文件
   *  （09-25 实测：memory.json 尾部被追加进另一段文本，memory:list 永远报错）。 */
  private save(list: MemoryRecord[] = this.records) {
    const tmp = this.file + ".tmp";
    return fs.writeFile(tmp, JSON.stringify(list, null, 2), "utf8").then(() => fs.rename(tmp, this.file));
  }

  private async remoteRequest(route: string, body: unknown) {
    const config = this.remote!;
    const response = await fetch(`${config.endpoint.replace(/\/$/, "")}${route}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json() as any;
    if (!response.ok) throw new Error(`Memory Gateway HTTP ${response.status}: ${result.message ?? result.error ?? JSON.stringify(result)}`);
    return result;
  }
}
