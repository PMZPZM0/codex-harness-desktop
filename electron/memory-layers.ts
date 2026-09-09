import fs from "node:fs/promises";
import path from "node:path";

/**
 * 记忆分层（对齐 WorkBuddy 的三层 + 碎片池）
 *
 * L0 用户档案：跨所有项目，只在设置页手动维护
 *   → {userData}/memory/USER.md
 * L1 项目长期记忆：跟随工作区，只由蒸馏或手动置顶写入
 *   → {workspace}/.codex-harness/memory/MEMORY.md
 * L2 每日日志：append-only，只回灌最近 N 天
 *   → {workspace}/.codex-harness/memory/YYYY-MM-DD.md
 * L3 碎片检索池：沿用既有 memory.json（MemoryStore），本模块不接管
 *
 * 写入门禁（这套能不能用的生死线）：
 *   - 自动捕获永远只进 L2
 *   - L1 只能由蒸馏或手动写入，自动流程绝不直接写 L1
 *   - L0 只能由用户手动写入
 */

const MEMORY_DIR = ".codex-harness";
const MEMORY_SUB = "memory";
const ARCHIVE_DIR = "archive";

/** 注入预算（字符）：超出即提示蒸馏，不做静默截断丢失 */
export const MEMORY_BUDGET = {
  user: 1500,
  background: 2000,
  project: 3000,
  logPerDay: 800,
  logDays: 3,
  total: 6000,
} as const;

/** 蒸馏阈值：日志满 30 天进入可蒸馏状态 */
const DISTILL_AFTER_DAYS = 30;
/** 自动蒸馏节流：同一工作区 6 小时内最多跑一次，避免每个会话都烧 token */
const AUTO_DISTILL_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 日志太短不值得调模型 */
const DISTILL_MIN_CHARS = 200;

export type MemoryLayersSnapshot = {
  user: string;
  background: string;
  project: string;
  /** 工作区为空时 project 不可用 */
  hasWorkspace: boolean;
  paths: { user: string; projectDir: string; background: string; project: string; logDir: string };
  logs: { date: string; chars: number }[];
  budget: { user: number; background: number; project: number; logs: number; total: number; over: boolean };
  pendingDistill: { dates: string[]; chars: number };
  lastDistillAt?: number;
};

export type DistillPick = {
  dates: string[];
  text: string;
  chars: number;
};

export type DistillResult = {
  ok: boolean;
  dates: string[];
  added: number;
  reason?: string;
};

const DISTILL_PROMPT = `你是记忆蒸馏器。下面是某个项目过去的工作日志，请把它们提炼成「长期有效的项目记忆」。

保留：
- 项目约束、架构约定、技术选型及其理由
- 反复踩过的坑和对应的解法
- 用户明确表达过的偏好与禁忌
- 固定流程、命令、脚本的可靠用法

丢弃：
- 一次性任务细节、临时路径、中间过程
- 寒暄、重复内容、当天即失效的状态

输出要求：
- Markdown 短句列表，按主题分组（## 主题）
- 不超过 40 行，每行一句话，信息密度优先
- 不要写开场白、不要写总结、不要有任何客套话
- 直接输出提炼结果`;

function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function daysBetween(date: string, base: string): number {
  const a = Date.parse(`${date}T00:00:00`);
  const b = Date.parse(`${base}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / 86_400_000);
}

/** 超预算时从头部保留（人工维护的记忆，前面是重点），尾部给提示 */
function clamp(text: string, budget: number): { text: string; over: boolean } {
  if (text.length <= budget) return { text, over: false };
  return { text: `${text.slice(0, budget).trimEnd()}\n\n…（已超出 ${budget} 字预算，请到设置 → 记忆做一次蒸馏）`, over: true };
}

export class MemoryLayers {
  private readonly userFile: string;

  constructor(private readonly userDataDir: string) {
    this.userFile = path.join(userDataDir, MEMORY_SUB, "USER.md");
  }

  private projectDir(workspace?: string): string | null {
    if (!workspace) return null;
    return path.join(workspace, MEMORY_DIR, MEMORY_SUB);
  }

  async readText(file: string): Promise<string> {
    try { return await fs.readFile(file, "utf8"); }
    catch (error: any) { if (error.code !== "ENOENT") throw error; return ""; }
  }

  private async writeText(file: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf8");
  }

  // ── L0 用户档案 ────────────────────────────────────────────────
  readUser() { return this.readText(this.userFile); }

  async writeUser(content: string): Promise<void> {
    await this.writeText(this.userFile, content.trim() ? content.trim() + "\n" : "");
  }

  // ── L1 项目长期记忆 ────────────────────────────────────────────
  async readProject(workspace?: string): Promise<string> {
    const dir = this.projectDir(workspace);
    if (!dir) return "";
    return this.readText(path.join(dir, "MEMORY.md"));
  }

  /** 当前工作区的项目背景：面向该项目下所有会话的快速入门约束。 */
  async readBackground(workspace?: string): Promise<string> {
    const dir = this.projectDir(workspace);
    if (!dir) return "";
    return this.readText(path.join(dir, "BACKGROUND.md"));
  }

  async writeBackground(workspace: string, content: string): Promise<void> {
    const dir = this.projectDir(workspace);
    if (!dir) throw new Error("尚未选择工作区，无法保存项目背景");
    await this.writeText(path.join(dir, "BACKGROUND.md"), content.trim() ? content.trim() + "\n" : "");
  }

  async writeProject(workspace: string, content: string): Promise<void> {
    const dir = this.projectDir(workspace);
    if (!dir) throw new Error("尚未选择工作区，无法保存项目记忆");
    await this.writeText(path.join(dir, "MEMORY.md"), content.trim() ? content.trim() + "\n" : "");
  }

  // ── L2 每日日志 ────────────────────────────────────────────────
  /** 自动捕获的唯一落点：往当天日志追加一行摘要 */
  async appendLog(workspace: string, summary: string): Promise<void> {
    const dir = this.projectDir(workspace);
    if (!dir || !summary.trim()) return;
    const file = path.join(dir, `${today()}.md`);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const line = `\n## ${stamp}\n${summary.trim()}\n`;
    const existing = await this.readText(file);
    if (!existing.trim()) {
      await this.writeText(file, `# ${today()}\n${line}`);
      return;
    }
    await fs.appendFile(file, line, "utf8");
  }

  private async listLogDates(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir);
      return entries
        .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
        .map((name) => name.replace(/\.md$/, ""))
        .sort();
    } catch { return []; }
  }

  /** 最近 N 天日志，供注入回灌（不回灌全部，否则上下文爆炸） */
  async recentLogs(workspace: string | undefined, days = MEMORY_BUDGET.logDays): Promise<{ date: string; text: string }[]> {
    const dir = this.projectDir(workspace);
    if (!dir) return [];
    const dates = (await this.listLogDates(dir)).slice(-days);
    const out: { date: string; text: string }[] = [];
    for (const date of dates) {
      const text = await this.readText(path.join(dir, `${date}.md`));
      if (text.trim()) out.push({ date, text });
    }
    return out;
  }

  // ── 注入上下文 ─────────────────────────────────────────────────
  /** 拼装常驻记忆块：L0 + L1 常驻，L2 只回灌最近 3 天 */
  async context(workspace?: string, includeWorkspace = true): Promise<{ text: string; stats: { chars: number; over: boolean } }> {
    const userRaw = (await this.readUser()).trim();
    const backgroundRaw = includeWorkspace ? (await this.readBackground(workspace)).trim() : "";
    const projectRaw = includeWorkspace ? (await this.readProject(workspace)).trim() : "";
    const user = clamp(userRaw, MEMORY_BUDGET.user);
    const background = clamp(backgroundRaw, MEMORY_BUDGET.background);
    const project = clamp(projectRaw, MEMORY_BUDGET.project);
    const logs = includeWorkspace ? await this.recentLogs(workspace) : [];

    const blocks: string[] = [];
    if (user.text) blocks.push(`## 用户档案\n${user.text}`);
    if (background.text) blocks.push(`## 项目背景\n${background.text}`);
    if (project.text) blocks.push(`## 项目记忆\n${project.text}`);
    if (logs.length) {
      const logBlocks = logs.map((entry) => {
        const trimmed = clamp(entry.text, MEMORY_BUDGET.logPerDay);
        return `### ${entry.date}\n${trimmed.text}`;
      });
      blocks.push(`## 近期工作日志（最近 ${logs.length} 天）\n${logBlocks.join("\n\n")}`);
    }
    if (!blocks.length) return { text: "", stats: { chars: 0, over: false } };

    let body = blocks.join("\n\n");
    const over = user.over || background.over || project.over || body.length > MEMORY_BUDGET.total;
    if (body.length > MEMORY_BUDGET.total) body = `${body.slice(0, MEMORY_BUDGET.total).trimEnd()}\n\n…（常驻记忆超预算，请蒸馏）`;
    return { text: `\n\n[Harness 常驻记忆 · 以下为已确认的长期上下文，与当前请求冲突时以当前请求为准]\n${body}\n[常驻记忆结束]\n`, stats: { chars: body.length, over } };
  }

  // ── 蒸馏 ──────────────────────────────────────────────────────
  private stateFile(workspace: string): string | null {
    const dir = this.projectDir(workspace);
    return dir ? path.join(dir, ".distill-state.json") : null;
  }

  private async readState(workspace: string): Promise<{ lastDistillAt?: number }> {
    const file = this.stateFile(workspace);
    if (!file) return {};
    try { return JSON.parse(await fs.readFile(file, "utf8")); }
    catch { return {}; }
  }

  private async writeState(workspace: string, state: { lastDistillAt?: number }): Promise<void> {
    const file = this.stateFile(workspace);
    if (!file) return;
    await this.writeText(file, JSON.stringify(state, null, 2));
  }

  /** 挑出满 30 天的日志，打包成待蒸馏文本（不调模型） */
  async pickDistill(workspace?: string): Promise<DistillPick | null> {
    const dir = this.projectDir(workspace);
    if (!dir) return null;
    const base = today();
    const dates = (await this.listLogDates(dir)).filter((date) => daysBetween(date, base) >= DISTILL_AFTER_DAYS);
    if (!dates.length) return null;
    const chunks: string[] = [];
    for (const date of dates) {
      const text = (await this.readText(path.join(dir, `${date}.md`))).trim();
      if (text) chunks.push(`# ${date}\n${text}`);
    }
    const text = chunks.join("\n\n");
    if (text.length < DISTILL_MIN_CHARS) return null;
    return { dates, text, chars: text.length };
  }

  /**
   * 执行蒸馏：把提炼结果追加进 L1，原文移入 archive/。
   * summarize 由调用方注入（主进程用一次性 codex 会话实现），本模块不依赖模型。
   */
  async distill(workspace: string, summarize: (prompt: string, body: string) => Promise<string>, force = false): Promise<DistillResult> {
    const dir = this.projectDir(workspace);
    if (!dir) return { ok: false, dates: [], added: 0, reason: "尚未选择工作区" };
    const pick = await this.pickDistill(workspace);
    if (!pick) return { ok: false, dates: [], added: 0, reason: "没有需要蒸馏的日志" };
    if (!force) {
      const state = await this.readState(workspace);
      if (state.lastDistillAt && Date.now() - state.lastDistillAt < AUTO_DISTILL_INTERVAL_MS) {
        return { ok: false, dates: pick.dates, added: 0, reason: "距上次蒸馏不足 6 小时，已跳过" };
      }
    }

    const summary = (await summarize(DISTILL_PROMPT, pick.text)).trim();
    if (!summary) return { ok: false, dates: pick.dates, added: 0, reason: "模型没有返回提炼结果" };

    const memoryFile = path.join(dir, "MEMORY.md");
    const existing = (await this.readText(memoryFile)).trim();
    const section = `## 蒸馏 ${today()}\n${summary}\n`;
    await this.writeText(memoryFile, existing ? `${existing}\n\n${section}` : `# 项目记忆\n\n${section}`);

    // 原文归档：移动而非删除，蒸馏失败也可回溯
    const archiveDir = path.join(dir, ARCHIVE_DIR);
    await fs.mkdir(archiveDir, { recursive: true });
    for (const date of pick.dates) {
      const from = path.join(dir, `${date}.md`);
      const to = path.join(archiveDir, `${date}.md`);
      try { await fs.rename(from, to); }
      catch (error: any) { if (error.code !== "ENOENT") throw error; }
    }
    await this.writeState(workspace, { lastDistillAt: Date.now() });
    return { ok: true, dates: pick.dates, added: summary.length };
  }

  /** 会话结束时调用：节流 + 全异常兜底，绝不影响主流程 */
  async autoDistill(workspace: string | undefined, summarize: (prompt: string, body: string) => Promise<string>): Promise<DistillResult | null> {
    if (!workspace) return null;
    try { return await this.distill(workspace, summarize); }
    catch { return null; }
  }

  // ── 设置页快照 ─────────────────────────────────────────────────
  async snapshot(workspace?: string): Promise<MemoryLayersSnapshot> {
    const dir = this.projectDir(workspace);
    const user = await this.readUser();
    const background = await this.readBackground(workspace);
    const project = await this.readProject(workspace);
    const logs = dir ? await this.listLogDates(dir) : [];
    const logStats = dir
      ? await Promise.all(logs.slice(-7).map(async (date) => ({ date, chars: (await this.readText(path.join(dir, `${date}.md`))).length })))
      : [];
    const pending = dir ? await this.pickDistill(workspace) : null;
    const logsChars = logStats.reduce((sum, entry) => sum + entry.chars, 0);
    const total = user.length + background.length + project.length + logsChars;
    return {
      user,
      background,
      project,
      hasWorkspace: Boolean(dir),
      paths: {
        user: this.userFile,
        projectDir: dir ?? "",
        background: dir ? path.join(dir, "BACKGROUND.md") : "",
        project: dir ? path.join(dir, "MEMORY.md") : "",
        logDir: dir ?? "",
      },
      logs: logStats,
      budget: {
        user: user.length,
        background: background.length,
        project: project.length,
        logs: logsChars,
        total,
        over: user.length > MEMORY_BUDGET.user || background.length > MEMORY_BUDGET.background || project.length > MEMORY_BUDGET.project || total > MEMORY_BUDGET.total,
      },
      pendingDistill: { dates: pending?.dates ?? [], chars: pending?.chars ?? 0 },
      lastDistillAt: workspace ? (await this.readState(workspace)).lastDistillAt : undefined,
    };
  }
}
