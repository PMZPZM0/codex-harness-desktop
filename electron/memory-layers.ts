import fs from "node:fs/promises";
import path from "node:path";
import {
  CORRECTION_CATEGORY, PITFALL_CATEGORY, PREFERENCE_CATEGORY, SOP_CATEGORY,
  appendLessonLine, groupLessonSections, lessonSectionTitle, sortLessonSections, splitLessonSections,
} from "./memory-lessons";
import { effectiveMemoryBackend } from "./memory-backend";

/**
 * 记忆分层（对齐 WorkBuddy 的三层 + 碎片池）
 *
 * L0 用户档案：跨所有项目，只在设置页手动维护
 *   → {userData}/memory/USER.md
 * L1 项目长期记忆：跟随工作区，只由蒸馏或手动置顶写入
 *   → {workspace}/.codex-harness/memory/MEMORY.md
 * L1.5 坑与纪律：**踩过的坑与用户纠错**，半自动追加（捕获链写入，现象去重），独立于日志归档
 *   → {workspace}/.codex-harness/memory/LESSONS.md
 * L2 每日日志：append-only，只回灌最近 N 天
 *   → {workspace}/.codex-harness/memory/logs/YYYY-MM-DD.md
 * L3 碎片检索池：沿用既有 memory.json（MemoryStore），本模块不接管
 *
 * 写入门禁（这套能不能用的生死线）：
 *   - 自动捕获永远只进 L2（+ 命中纠错/失败时进 L1.5）
 *   - L1 只能由蒸馏或手动写入，自动流程绝不直接写 L1
 *   - L0 只能由用户手动写入
 *
 * 为什么单列 L1.5（09-22 用户实测痛点：「犯的错、踩的坑不记」）：
 *   坑只写进当天日志 → 日志 30 天后被蒸馏、注入只回灌最近 3 天 ⇒ 坑会**自然消失**，下一轮照踩。
 *   所以坑要单独成层：注入时**放在最前**（纪律优先于背景），不参与日志归档，蒸馏时要求原样保留。
 */

const MEMORY_DIR = ".codex-harness";
const MEMORY_SUB = "memory";
const ARCHIVE_DIR = "archive";

/**
 * ── 记忆目录布局（v2，09-22 用户：「记忆应该单独一个目录，文件夹保存不会乱」）─────────────
 * 全落在 `<workspace>/.codex-harness/memory/` **一个目录**里，按层 / 分类分子目录：
 *   `project/MEMORY.md`（L1 项目宪法）· `project/BACKGROUND.md`（L3 项目背景）
 *   `lessons/<分类>.md`（L2 纪律与坑，**一个分类一个文件**）· `logs/YYYY-MM-DD.md`（L4）
 *   `rollups/YYYY-MM.md`（L5 月度卷宗）· `archive/*.md`（L6 冷存档，原文可回溯）
 * ⛔ v1 是把 MEMORY.md / BACKGROUND.md / LESSONS.md / 日志**摊在 memory/ 根**（乱、且分类只能靠文件内标题）。
 *    升级由 migrateLayout() 搬：**移动而非复制**；LESSONS.md 按分类拆进 lessons/ 后，原件移进 archive/。
 *    整体幂等（重复调用不会重复搬），且只在"新位置还没内容"时搬 ⇒ 不覆盖任何已有数据。
 */
const PROJECT_DIR = "project";
const LESSONS_DIR = "lessons";
const LOGS_DIR = "logs";
const ROLLUP_DIR = "rollups";
const MEMORY_FILE = "MEMORY.md";
const BACKGROUND_FILE = "BACKGROUND.md";
/** L2 分类 → 文件名（键直接用 memory-lessons 的分类常量，保证两处永远同名） */
const LESSON_FILES: Record<string, string> = {
  [CORRECTION_CATEGORY]: "corrections.md",
  [PITFALL_CATEGORY]: "pitfalls.md",
  [SOP_CATEGORY]: "sop.md",
  [PREFERENCE_CATEGORY]: "preferences.md",
};
const LESSON_MISC_FILE = "misc.md";
/** 迁移源：v1 摊在 memory/ 根的旧纪律文件名（v2 起改为 lessons/<分类>.md） */
const LEGACY_LESSONS = "LESSONS.md";
const LEGACY_MARK = ".layout-v2-done";

/** 注入预算（字符）：超出即提示蒸馏，不做静默截断丢失。
 *  口径 = **重度开发者**（2026-09-22 用户定：一天几十轮、多会话并行、大项目），
 *  旧值（800/1500/…）六七轮就触 90% 蒸馏线，太紧。各层不会同时满，total 是总闸。 */
export const MEMORY_BUDGET = {
  user: 4000,
  background: 6000,
  project: 12000,
  /** L1.5 坑与纪律：独立预算，注入时排在最前（纪律比背景更容易被反复踩） */
  lessons: 8000,
  /** L4 每日日志：注入时每天钳 logPerDay、回灌最近 logDays 天；
   *  L4 水位预算 = logPerDay × logDays（满了自动蒸最老一半，不丢内容） */
  logPerDay: 8000,
  logDays: 5,
  total: 30000,
} as const;

/** 纪律文件行数上限：超了不自动删（用户数据），只在文件头提示整理/蒸馏 */
const LESSONS_MAX_LINES = 120;

/** 蒸馏阈值：日志满 30 天进入可蒸馏状态 */
const DISTILL_AFTER_DAYS = 30;
/** 自动蒸馏节流：同一工作区 6 小时内最多跑一次，避免每个会话都烧 token */
const AUTO_DISTILL_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 日志太短不值得调模型 */
const DISTILL_MIN_CHARS = 200;

/**
 * ── 记忆金字塔（L0–L7）与 90% 漏斗 ───────────────────────────────────────────────
 * 用户 09-22 要求：「每层满了 90% 就往下蒸馏一层核心记忆，而且必须让 Codex 自己完成」。
 * 于是这里定义**层表**（谁写、写在哪、多少预算、满了沉到哪），水位与"要不要蒸馏"由下面的
 * layerWatermarks 纯函数算，再由 context() 用**水位提示行**下发 —— 引擎因此不需要额外工具就知道
 * 该蒸馏哪一层（提示只在 ≥90% 时才出现，日常不占 token）。
 *
 *   L0 用户档案 USER.md            ← 用户手写（跨项目，最稳定）
 *   L1 项目宪法 MEMORY.md          ← 蒸馏产物：本项目必须遵守的约定 / 选型 / 结论
 *   L2 纪律与记忆 lessons/<分类>.md ← 捕获链自动追加 + 引擎补写（**用户纠错单独一类**；满了先升级为技能再压缩）
 *   L3 项目背景 BACKGROUND.md      ← 用户 / 引擎（本项目快速入门）
 *   L4 每日日志 YYYY-MM-DD.md      ← 捕获链自动；满 90% 或满 30 天 ⇒ 沉 L5，原文进 L6
 *   L5 月度卷宗 rollups/YYYY-MM.md ← 蒸馏产物（比日志短、比 L1 细）
 *   L6 冷存档 archive/*.md         ← 蒸馏时原文移位（可回溯，**不进注入**）
 *   L7 碎片池 memory.json          ← MemoryStore 按 TTL 淘汰（不在本模块统计字符）
 */
export const MEMORY_DISTILL_THRESHOLD = 0.9;
/** 「怎么蒸」的说明书放在按需加载的技能里（每轮指令只留触发与职责，省 token —— 与本仓渐进披露纪律一致） */
export const MEMORY_DISTILL_SKILL = "memory-distill";
const ROLLUP_BUDGET = 12000;

export type PyramidLayerId = "L0" | "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7";
export type PyramidLayerDef = {
  id: PyramidLayerId;
  name: string;
  where: string;
  /** 字符预算；0 = 不按字符统计（冷存档 / 外置池） */
  budget: number;
  writer: string;
  /** 满 90% 之后"往下沉"到哪一层 */
  sink: string;
};
export const MEMORY_PYRAMID: readonly PyramidLayerDef[] = [
  { id: "L0", name: "用户档案", where: "USER.md（userData 下，跨项目）", budget: MEMORY_BUDGET.user, writer: "用户手写", sink: "人工精简（不自动删）" },
  { id: "L1", name: "项目宪法", where: `${PROJECT_DIR}/${MEMORY_FILE}`, budget: MEMORY_BUDGET.project, writer: "蒸馏（本地 / 引擎）", sink: "同层压缩：合并同主题、删过时" },
  { id: "L2", name: "纪律与记忆", where: `${LESSONS_DIR}/<分类>.md`, budget: MEMORY_BUDGET.lessons, writer: "捕获链自动 + 引擎", sink: "先升级为技能（skill-authoring）再压缩" },
  { id: "L3", name: "项目背景", where: `${PROJECT_DIR}/${BACKGROUND_FILE}`, budget: MEMORY_BUDGET.background, writer: "用户 / 引擎", sink: "稳定下来的升格进 L1" },
  { id: "L4", name: "每日日志", where: `${LOGS_DIR}/YYYY-MM-DD.md`, budget: MEMORY_BUDGET.logPerDay * MEMORY_BUDGET.logDays, writer: "捕获链自动", sink: "沉 L5 月度卷宗（原文进 L6 冷存档）" },
  { id: "L5", name: "月度卷宗", where: `${ROLLUP_DIR}/YYYY-MM.md`, budget: ROLLUP_BUDGET, writer: "蒸馏", sink: "沉 L1 项目宪法" },
  { id: "L6", name: "冷存档", where: `${ARCHIVE_DIR}/*.md`, budget: 0, writer: "蒸馏（原文移位）", sink: "终态：可回溯，不进注入" },
  { id: "L7", name: "碎片池", where: "memory.json（MemoryStore）", budget: 0, writer: "捕获链自动", sink: "按 TTL 淘汰，淘汰记录进 pruned.jsonl" },
];

export type PyramidLayerStatus = PyramidLayerDef & { used: number; ratio: number | null; needDistill: boolean };

/** 按「层 id → 当前字符数」算水位（**纯函数**：预检【104】直接真跑它，不依赖文件系统） */
export function layerWatermarks(used: Partial<Record<PyramidLayerId, number>> = {}): PyramidLayerStatus[] {
  return MEMORY_PYRAMID.map((layer) => {
    const cur = Math.max(0, Math.round(used[layer.id] ?? 0));
    /* 外部层（budget 0：冷存档 / 碎片池）不按字符算比例，也就永远不触发蒸馏 */
    if (layer.budget <= 0) return { ...layer, used: cur, ratio: null, needDistill: false };
    const ratio = cur / layer.budget;
    return { ...layer, used: cur, ratio, needDistill: ratio >= MEMORY_DISTILL_THRESHOLD };
  });
}

export type DistillSplit = { core: string; digest: string };

/**
 * 把蒸馏输出切成两段：`## 核心`（→ L1 项目宪法）与 `## 纪要`（→ L5 月度卷宗）。
 * 纯函数，预检【104】直接真跑。
 * ⛔ 标题缺失/写错时**必须退回单段模式**（整段当核心进 L1）—— 宁可 L5 空着，也不能让内容凭空消失。
 */
export function splitDistill(text: string): DistillSplit {
  const src = String(text ?? "").trim();
  if (!src) return { core: "", digest: "" };
  const coreMatch = src.match(/^##\s*核心\s*$/m);
  if (!coreMatch) return { core: src, digest: "" };
  const coreStart = (coreMatch.index ?? 0) + coreMatch[0].length;
  const digestMatch = src.match(/^##\s*纪要\s*$/m);
  const digestStart = digestMatch?.index ?? -1;
  if (digestStart > coreStart) {
    return { core: src.slice(coreStart, digestStart).trim(), digest: src.slice(digestStart + (digestMatch as RegExpMatchArray)[0].length).trim() };
  }
  return { core: src.slice(coreStart).trim(), digest: "" };
}

export type MemoryLayersSnapshot = {
  user: string;
  background: string;
  project: string;
  /** L1.5 坑与纪律（LESSONS.md 全文） */
  lessons: string;
  /** 工作区为空时 project 不可用 */
  hasWorkspace: boolean;
  paths: { user: string; projectDir: string; background: string; project: string; lessons: string; logDir: string };
  logs: { date: string; chars: number }[];
  budget: { user: number; background: number; project: number; lessons: number; logs: number; total: number; over: boolean };
  /** 金字塔八层水位（设置页展示；needDistill = 已达 90% 蒸馏线） */
  layers: PyramidLayerStatus[];
  /** L2 纪律与坑的**分类计数**（设置页显示"用户纠错 N 条 / 任务经验 N 条 …"） */
  lessonGroups: { category: string; count: number; chars: number }[];
  pendingDistill: { dates: string[]; chars: number };
  lastDistillAt?: number;
};

export type DistillPick = {
  dates: string[];
  text: string;
  chars: number;
  /** age = 满 30 天；watermark = 该层已到 90% 蒸馏线（不足 30 天也压） */
  trigger: "age" | "watermark";
};

export type DistillResult = {
  ok: boolean;
  dates: string[];
  added: number;
  /** 本次触发的类型（age 满 30 天 / watermark 到 90% 水位） */
  trigger?: DistillPick["trigger"];
  /** 纪要落进 L5 的月卷文件（相对路径），单段模式时不写 */
  rollup?: string;
  reason?: string;
};

const DISTILL_PROMPT = `你是记忆蒸馏器。下面是某个项目过去的工作日志（可能附「现有踩坑与纪律」清单），请把它们提炼成「长期有效的项目记忆」。

保留：
- 项目约束、架构约定、技术选型及其理由
- 反复踩过的坑和对应的解法
- 用户明确表达过的偏好与禁忌
- 固定流程、命令、脚本的可靠用法

⛔ 踩坑与纪律必须完整保留：输入里附带的「现有踩坑与纪律」清单，蒸馏后**不得丢条、不得合并成笼统一句**，
  每条保持「现象 → 根因/解法」的可辨识形态；新出现的坑要补进去。

丢弃：
- 一次性任务细节、临时路径、中间过程
- 寒暄、重复内容、当天即失效的状态

输出要求（**两段式**：程序按标题切分，分别落进金字塔的两层）：
- 先输出一节「## 核心」= **长期有效的项目宪法**：项目约束、架构约定、技术选型及其理由、用户偏好与禁忌。
  不超过 20 行，每行一句话，信息密度优先。
- 再输出一节「## 纪要」= 这批日志的**阶段纪要**：做了什么、结论是什么、还有什么没做完。不超过 30 行，按主题分组。

⛔ 踩坑与纪律必须完整保留：输入里附带的「现有踩坑与纪律」清单，**不得丢条、不得合并成笼统一句**，
  归入「## 核心」里，每条保持「现象 → 根因/解法」的可辨识形态；新出现的坑要补进去。

丢弃：
- 一次性任务细节、临时路径、中间过程
- 寒暄、重复内容、当天即失效的状态

格式硬要求：
- 两节标题必须逐字为「## 核心」与「## 纪要」（写错标题 = 内容进错层，程序会退回单段模式）
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
/** 预算钳制。⛔ 截断必须**可见**：返回 cut = 被砍掉的字符数，调用方在注入块里标注
 *  「本节被截断 N 字」—— 静默砍尾部 = 引擎在盲区里干活，还以为看到的是全部。 */
function clamp(text: string, budget: number): { text: string; over: boolean; cut: number } {
  if (text.length <= budget) return { text, over: false, cut: 0 };
  return { text: `${text.slice(0, budget).trimEnd()}\n\n…（已超出 ${budget} 字预算，请到设置 → 记忆做一次蒸馏）`, over: true, cut: text.length - budget };
}

/** scratch 会话识别（09-22 实测教训）：cwd 落在 scratch/chat-… 的工作区不是真项目 ——
 *  记忆写进去 = 构建即清。projectDir 对它返回 null ⇒ 项目层记忆（L1-L6）一律不写不读。
 *  纯函数，守卫【108】直接真跑。 */
export function isScratchWorkspace(workspace: string): boolean {
  return /[\\/]scratch[\\/]chat-\d{8}-/.test(workspace);
}

export class MemoryLayers {
  private readonly userFile: string;

  constructor(private readonly userDataDir: string) {
    this.userFile = path.join(userDataDir, MEMORY_SUB, "USER.md");
  }

  private projectDir(workspace?: string): string | null {
    if (!workspace) return null;
    /* ⛔ scratch 会话（无工作区聊天）没有项目记忆：写了 = 构建即清 = 假记忆，还和真实项目记忆分叉 */
    if (isScratchWorkspace(workspace)) return null;
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

  /** ① L0 用户档案引擎自维护：发现**稳定的**用户偏好/背景事实时追加一行画像。
   *  逐行去重（归一化后已存在即跳过，返回 false）；只追加、绝不改写/删除既有行。
   *  09-22 前 USER.md 只许用户手写 ⇒ 永远是空的，跨项目画像无从积累 —— 这正是
   *  WorkBuddy 云端画像的本地等价物：谁用谁知道的信息，就该谁（引擎）来记。 */
  async appendUserProfile(line: string): Promise<boolean> {
    const text = String(line ?? "").trim();
    if (!text) return false;
    const norm = (s: string) => s.replace(/[\s，。！？、,.!?:：；;"'（）()【】\[\]0-9-]/g, "");
    const existing = (await this.readText(this.userFile)).split("\n");
    if (existing.some((l) => norm(l) && norm(l) === norm(text))) return false;
    existing.push(text);
    await this.writeText(this.userFile, existing.filter((l) => l.trim()).join("\n") + "\n");
    return true;
  }

  // ── 目录布局（v2）与迁移 ────────────────────────────────────────
  private projectFile(dir: string): string { return path.join(dir, PROJECT_DIR, MEMORY_FILE); }
  private backgroundFile(dir: string): string { return path.join(dir, PROJECT_DIR, BACKGROUND_FILE); }
  private lessonsDir(dir: string): string { return path.join(dir, LESSONS_DIR); }
  private lessonFile(dir: string, category: string): string {
    return path.join(dir, LESSONS_DIR, LESSON_FILES[category] ?? LESSON_MISC_FILE);
  }
  private logsDir(dir: string): string { return path.join(dir, LOGS_DIR); }
  private rollupDir(dir: string): string { return path.join(dir, ROLLUP_DIR); }
  private archiveDir(dir: string): string { return path.join(dir, ARCHIVE_DIR); }

  /** 迁移标记：同一进程内不重复扫（跨进程靠磁盘标记文件 + 移动语义兜底） */
  private migrated = new Set<string>();

  /**
   * 把 v1 的散文件布局搬成 v2 的分目录布局（幂等）。
   * ⛔ 三条安全线：① 只用 `rename`（移动，不复制不删）；② 目标已存在则**不覆盖**；③ 失败只记不抛
   *    （记忆是附带功能，绝不能让布局迁移把会话搞挂）。
   */
  private async migrateLayout(dir: string): Promise<void> {
    if (this.migrated.has(dir)) return;
    this.migrated.add(dir);
    try {
      const marker = path.join(dir, LEGACY_MARK);
      if (await fs.access(marker).then(() => true).catch(() => false)) return;
      await fs.mkdir(path.join(dir, PROJECT_DIR), { recursive: true });
      await fs.mkdir(this.lessonsDir(dir), { recursive: true });
      await fs.mkdir(this.logsDir(dir), { recursive: true });
      await fs.mkdir(this.archiveDir(dir), { recursive: true });
      const moveIfFree = async (from: string, to: string) => {
        try {
          await fs.access(to);
          return false; // 目标已有内容：不覆盖（新布局优先）
        } catch { /* 目标不存在，可以搬 */ }
        try { await fs.rename(from, to); return true; }
        catch { return false; }
      };
      /* ① 项目宪法 / 背景 / 日志 */
      await moveIfFree(path.join(dir, MEMORY_FILE), this.projectFile(dir));
      await moveIfFree(path.join(dir, BACKGROUND_FILE), this.backgroundFile(dir));
      for (const date of await this.listLogDatesIn(dir)) {
        await moveIfFree(path.join(dir, `${date}.md`), path.join(this.logsDir(dir), `${date}.md`));
      }
      /* ② 旧 LESSONS.md：按分类拆进 lessons/，原件归档（分节解析复用 memory-lessons 的同一套逻辑） */
      const legacy = path.join(dir, LEGACY_LESSONS);
      if (await fs.access(legacy).then(() => true).catch(() => false)) {
        const text = await this.readText(legacy);
        const sections = sortLessonSections(text);
        for (const section of splitLessonSections(sections)) {
          const body = section.lines.join("\n").replace(/\s*$/, "");
          if (!body.trim()) continue;
          const category = section.category;
          const target = category && LESSON_FILES[category] ? this.lessonFile(dir, category) : path.join(this.lessonsDir(dir), LESSON_MISC_FILE);
          const existing = (await this.readText(target)).trim();
          /* ⛔ 新位置已有内容 ⇒ **不追加、不覆盖**：旧内容以 archive/ 里的原件为准（避免新旧混成一锅、也避免重复条目） */
          if (existing) continue;
          const head = category ? `${lessonSectionTitle(category)}\n` : "";
          await this.writeText(target, `${head}${body}\n`);
        }
        await moveIfFree(legacy, path.join(this.archiveDir(dir), `legacy-${LEGACY_LESSONS}`));
      }
      await this.writeText(marker, `v2 ${today()}\n`);
    } catch { /* 迁移失败不阻塞：读路径对旧位置仍有兜底（见 readProject / readBackground / readLessons） */ }
  }

  /** 旧布局的日志日期（仅迁移用：扫 memory/ 根的 YYYY-MM-DD.md） */
  private async listLogDatesIn(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir);
      return entries
        .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
        .map((name) => name.replace(/\.md$/, ""))
        .sort();
    } catch { return []; }
  }

  /** 读一个文件：新位置优先，缺失时回落旧位置（未迁移成功的老工作区仍可用） */
  private async readWithLegacy(file: string, legacy: string): Promise<string> {
    const fresh = await this.readText(file);
    if (fresh.trim()) return fresh;
    return this.readText(legacy);
  }

  // ── L1 项目长期记忆 ────────────────────────────────────────────
  async readProject(workspace?: string): Promise<string> {
    const dir = this.projectDir(workspace);
    if (!dir) return "";
    await this.migrateLayout(dir);
    return this.readWithLegacy(this.projectFile(dir), path.join(dir, MEMORY_FILE));
  }

  /** 当前工作区的项目背景：面向该项目下所有会话的快速入门约束。 */
  async readBackground(workspace?: string): Promise<string> {
    const dir = this.projectDir(workspace);
    if (!dir) return "";
    await this.migrateLayout(dir);
    return this.readWithLegacy(this.backgroundFile(dir), path.join(dir, BACKGROUND_FILE));
  }

  async writeBackground(workspace: string, content: string): Promise<void> {
    const dir = this.projectDir(workspace);
    if (!dir) throw new Error("尚未选择工作区，无法保存项目背景");
    await this.migrateLayout(dir);
    await this.writeText(this.backgroundFile(dir), content.trim() ? content.trim() + "\n" : "");
  }

  async writeProject(workspace: string, content: string): Promise<void> {
    const dir = this.projectDir(workspace);
    if (!dir) throw new Error("尚未选择工作区，无法保存项目记忆");
    await this.migrateLayout(dir);
    await this.writeText(this.projectFile(dir), content.trim() ? content.trim() + "\n" : "");
  }

  // ── L2 纪律与记忆（lessons/<分类>.md，一个分类一个文件）────────────
  /** 读全部纪律（合成「## 分类」文本：注入 / 快照 / 蒸馏 / UI 都复用同一份解析） */
  async readLessons(workspace?: string): Promise<string> {
    const dir = this.projectDir(workspace);
    if (!dir) return "";
    await this.migrateLayout(dir);
    const parts: string[] = [];
    /* 顺序 = 注入顺序（纠错最前）；文件不存在就跳过 */
    for (const category of Object.keys(LESSON_FILES)) {
      const body = (await this.readText(this.lessonFile(dir, category))).trim();
      if (!body) continue;
      /* 文件里已带 `# 分类` 标题则原样用，否则补一个分节标题，让下游 splitLessonSections 照常工作 */
      parts.push(/^##\s+/m.test(body) ? body : `${lessonSectionTitle(category)}\n${body}`);
    }
    const misc = (await this.readText(path.join(this.lessonsDir(dir), LESSON_MISC_FILE))).trim();
    if (misc) parts.push(misc);
    if (parts.length) return `${parts.join("\n\n")}\n`;
    /* 兜底：迁移没成功时，旧 LESSONS.md 仍然可读 */
    return this.readText(path.join(dir, LEGACY_LESSONS));
  }

  /** 整体写回（设置页编辑器用）：按分类分节拆开，落进各自的文件 */
  async writeLessons(workspace: string, content: string): Promise<void> {
    const dir = this.projectDir(workspace);
    if (!dir) throw new Error("尚未选择工作区，无法保存纪律与记忆");
    await this.migrateLayout(dir);
    const buckets = new Map<string, string[]>();
    for (const section of splitLessonSections(content)) {
      const file = section.category && LESSON_FILES[section.category] ? section.category : "__misc";
      const body = section.lines.join("\n").replace(/\s*$/, "");
      if (!body.trim()) continue;
      buckets.set(file, [...(buckets.get(file) ?? []), body]);
    }
    for (const [key, bodies] of buckets) {
      const file = key === "__misc" ? path.join(this.lessonsDir(dir), LESSON_MISC_FILE) : this.lessonFile(dir, key);
      const head = key === "__misc" ? "" : `${lessonSectionTitle(key)}\n`;
      await this.writeText(file, `${head}${bodies.join("\n")}\n`);
    }
    /* 清空被删掉的分类文件（编辑器里整类删掉时不留旧内容） */
    for (const category of Object.keys(LESSON_FILES)) {
      if (buckets.has(category)) continue;
      const file = this.lessonFile(dir, category);
      if (await fs.access(file).then(() => true).catch(() => false)) await this.writeText(file, "");
    }
  }

  /**
   * 追加一条纪律/坑（捕获链调用）。**现象去重**：dedupeKey 已存在则跳过（返回 false）。
   * 09-22 起**按分类分文件**（用户要求「纠错的记忆要单独一类」「记忆应该单独一个目录，文件夹保存」）：
   * `category` 缺省按「任务经验」；纠错类由捕获链显式传入 ⇒ 落 `lessons/corrections.md`，
   * 注入时排最前、永不被淘汰。
   */
  async appendLesson(workspace: string, line: string, dedupeKey: string, category?: string): Promise<boolean> {
    /* ⛔ 09-25「记忆后端二选一」：用户启用 MCP 记忆服务**且服务确实装好**时，记忆一律走 MCP，
       内置记忆金字塔停止捕获写入 —— 否则同一条纪律会在 MCP 库里存一份、在 lessons/*.md 里再存一份。
       ⛔ 判据必须是 `effectiveMemoryBackend()`（带可用性回退），**不是** `memoryBackend()`：
       用户选了 MCP 但服务没装/装坏时（原生模块装不上的环境很常见），若这里也让位 ⇒
       记忆一处都不写 = **彻底丢记忆**。宁可回到金字塔，也不能丢。 */
    if (effectiveMemoryBackend() === "mcp") return false;
    const dir = this.projectDir(workspace);
    const text = String(line ?? "").trim();
    if (!dir || !text) return false;
    /* ⛔ 含字面块标签的纪律行会**反过来破坏剥离**（自指污染，09-23 实证）：它被注入进常驻块后，
       非贪婪成对正则在它内部提前闭合 ⇒ 只剥前半段、后半段铺进 L4「需求」/L2「现象」，并继续喂出新的垃圾行。
       在**写入这一刻**拦住，而不是事后靠自检发现。 */
    if (/\[Harness\s*(?:常驻记忆|相关记忆)|\[(?:常驻记忆结束|记忆结束)\]/.test(text)) return false;
    await this.migrateLayout(dir);
    const file = this.lessonFile(dir, category || PITFALL_CATEGORY);
    const existing = await this.readText(file);
    const key = String(dedupeKey ?? "").trim();
    /* 去重跨全部文件（同一条纪律不许在两个分类里各存一份） */
    const all = await this.readLessons(workspace);
    if (key && all.replace(/[\s，。！？、,.!?:：；;""''（）()【】\[\]]/g, "").includes(key)) return false;
    const body = appendLessonLine(existing, category || PITFALL_CATEGORY, text);
    const lines = body.split("\n").length;
    const out = lines > LESSONS_MAX_LINES && !body.includes("已超过")
      ? body.replace("# 纪律与记忆", `# 纪律与记忆\n\n> ⚠️ 条目已超过 ${LESSONS_MAX_LINES} 行，请在设置 → 记忆里整理/并入 MEMORY.md（不自动删除）。`)
      : body;
    await this.writeText(file, out);
    return true;
  }

  // ── L4 每日日志（logs/YYYY-MM-DD.md）─────────────────────────────
  /** 自动捕获的唯一落点：往当天日志追加一行摘要 */
  async appendLog(workspace: string, summary: string): Promise<void> {
    const dir = this.projectDir(workspace);
    if (!dir || !summary.trim()) return;
    await this.migrateLayout(dir);
    const file = path.join(this.logsDir(dir), `${today()}.md`);
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

  /** 日志日期（v2 在 `logs/`；迁移未完成时并上 `memory/` 根的旧日志，保证不丢） */
  private async listLogDates(dir: string): Promise<string[]> {
    const fresh = await this.listLogDatesIn(this.logsDir(dir));
    const legacy = await this.listLogDatesIn(dir);
    return [...new Set([...fresh, ...legacy])].sort();
  }

  /** 单日日志的落点：新位置优先，缺失时回落旧位置 */
  private async logFilePath(dir: string, date: string): Promise<string> {
    const fresh = path.join(this.logsDir(dir), `${date}.md`);
    if (await fs.access(fresh).then(() => true).catch(() => false)) return fresh;
    const legacy = path.join(dir, `${date}.md`);
    if (await fs.access(legacy).then(() => true).catch(() => false)) return legacy;
    return fresh;
  }

  /** 最近 N 天日志，供注入回灌（不回灌全部，否则上下文爆炸） */
  async recentLogs(workspace: string | undefined, days = MEMORY_BUDGET.logDays): Promise<{ date: string; text: string }[]> {
    const dir = this.projectDir(workspace);
    if (!dir) return [];
    await this.migrateLayout(dir);
    const dates = (await this.listLogDates(dir)).slice(-days);
    const out: { date: string; text: string }[] = [];
    for (const date of dates) {
      const text = await this.readText(await this.logFilePath(dir, date));
      if (text.trim()) out.push({ date, text });
    }
    return out;
  }

  /** 日志层（L4）字符总数 */
  private async logChars(dir: string | null): Promise<number> {
    if (!dir) return 0;
    let total = 0;
    for (const date of await this.listLogDates(dir)) total += (await this.readText(await this.logFilePath(dir, date))).length;
    return total;
  }

  /** 某子目录下 .md 的字符总数（L5 月卷 / L6 冷存档的水位；目录不存在 = 0） */
  private async dirChars(dir: string | null, sub: string): Promise<number> {
    if (!dir) return 0;
    let total = 0;
    try {
      for (const entry of await fs.readdir(path.join(dir, sub), { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        total += (await this.readText(path.join(dir, sub, entry.name))).length;
      }
    } catch { /* 目录不存在 = 0 */ }
    return total;
  }

  /** 金字塔各层当前用量（水位判定 + 设置页展示）。L7 碎片池由 MemoryStore 管，这里不统计。 */
  async layerUsage(workspace?: string): Promise<Partial<Record<PyramidLayerId, number>>> {
    const dir = this.projectDir(workspace);
    return {
      L0: (await this.readUser()).length,
      L1: dir ? (await this.readProject(workspace)).length : 0,
      L2: dir ? (await this.readLessons(workspace)).length : 0,
      L3: dir ? (await this.readBackground(workspace)).length : 0,
      L4: await this.logChars(dir),
      L5: await this.dirChars(dir, ROLLUP_DIR),
      L6: await this.dirChars(dir, ARCHIVE_DIR),
      L7: 0,
    };
  }

  /**
   * 水位提示：只列**已达 90% 蒸馏线**的层（平时返回空串，不占 token）。
   * 这是「引擎自己知道什么时候该蒸馏」的唯一通道 —— 它每轮都随常驻记忆注入。
   */
  async watermarkHint(workspace?: string): Promise<string> {
    const [statuses, pending] = await Promise.all([this.layerUsage(workspace).then(layerWatermarks), this.pickDistill(workspace)]);
    const hot = statuses.filter((s) => s.needDistill);
    if (!hot.length) return "";
    const lines = hot.map((s) => {
      const pct = Math.round((s.ratio ?? 0) * 100);
      /* ③ L1 压缩没有本地自动执行（用户数据不代删）：明确指给引擎 —— 由它直接编辑文件合并同主题 */
      const how = s.id === "L1" ? "（L1 压缩由**你**执行：直接编辑 project/MEMORY.md，合并同主题、删过时条目；本地不代删用户数据）" : "";
      return `- ${s.id} ${s.name} 已到 ${pct}%（${s.used}/${s.budget} 字）⇒ 蒸馏去向：${s.sink}${how}`;
    });
    return [
      "[Harness 记忆水位 · ⚠️ 已达 90% 蒸馏线，先蒸馏再继续干活]",
      ...lines,
      pending ? `（已为你备好待蒸馏的日志：${pending.dates.length} 天 / ${pending.chars} 字；本地蒸馏入口见指令第 9 条）` : "（先把该层压缩，再继续当前任务）",
    ].join("\n");
  }

  // ── 整洁与清理（记忆管理面用的动作；规则见 electron/memory-hygiene.ts） ──
  /** L6 冷存档概况（整洁报告用）。冷存档不参与注入，只被统计与清空。 */
  async archiveStats(workspace?: string): Promise<{ files: number; bytes: number }> {
    const dir = this.projectDir(workspace);
    if (!dir) return { files: 0, bytes: 0 };
    const archive = this.archiveDir(dir);
    let files = 0;
    let bytes = 0;
    try {
      for (const entry of await fs.readdir(archive, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        files += 1;
        bytes += (await this.readText(path.join(archive, entry.name))).length;
      }
    } catch { /* 不存在 = 0 */ }
    return { files, bytes };
  }

  /** 清理留痕：追加一行到 pruned.jsonl（与碎片池淘汰同一份账，事后可查） */
  private async tracePrune(workspace: string, entry: Record<string, unknown>): Promise<void> {
    const dir = this.projectDir(workspace);
    if (!dir) return;
    try { await fs.appendFile(path.join(dir, "pruned.jsonl"), `${JSON.stringify({ at: Date.now(), ...entry })}\n`, "utf8"); }
    catch { /* 留痕失败不阻塞动作 */ }
  }

  /**
   * 清空 L6 冷存档 —— **用户显式决定**的动作（调用方必须已拿到二次确认，IPC 层强校验）。
   * ⛔ 这是唯一允许"真删"的地方：冷存档不参与注入，清掉只影响回溯能力 ⇒ 必须先告知用户不可回溯。
   */
  async purgeArchive(workspace?: string): Promise<{ removed: number; bytes: number }> {
    const dir = this.projectDir(workspace);
    if (!dir || !workspace) return { removed: 0, bytes: 0 };
    const stats = await this.archiveStats(workspace);
    try { await fs.rm(this.archiveDir(dir), { recursive: true, force: true }); }
    catch { /* 已不存在 */ }
    await this.tracePrune(workspace, { action: "purge-archive", files: stats.files, bytes: stats.bytes });
    return { removed: stats.files, bytes: stats.bytes };
  }

  /**
   * 整理纪律格式（**无损**）：行尾空白、连续空行折叠、补末尾换行。
   * ⛔ 只动空白，不改写任何内容、不增删条目 —— 语义层面的问题由 `lintLessonLines` **报告**，
   *    改不改、怎么改由用户/引擎决定（自动改写纪律文本可能改掉语义，风险太高）。
   */
  async tidyLessons(workspace?: string): Promise<{ files: number; changed: number }> {
    const dir = this.projectDir(workspace);
    if (!dir) return { files: 0, changed: 0 };
    await this.migrateLayout(dir);
    let files = 0;
    let changed = 0;
    const targets = [...Object.keys(LESSON_FILES).map((category) => this.lessonFile(dir, category)), path.join(this.lessonsDir(dir), LESSON_MISC_FILE)];
    for (const file of targets) {
      const before = await this.readText(file);
      if (!before.trim()) continue;
      files += 1;
      const normalized = `${before
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.replace(/\s+$/, ""))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\s*$/, "")}\n`;
      if (normalized !== before) {
        await this.writeText(file, normalized);
        changed += 1;
      }
    }
    return { files, changed };
  }

  // ── 注入上下文 ─────────────────────────────────────────────────
  /** 拼装常驻记忆块：L1.5 坑与纪律（最前）+ L0 + L1 常驻，L2 只回灌最近 3 天 */
  async context(workspace?: string, includeWorkspace = true): Promise<{ text: string; stats: { chars: number; over: boolean } }> {
    const userRaw = (await this.readUser()).trim();
    const backgroundRaw = includeWorkspace ? (await this.readBackground(workspace)).trim() : "";
    const projectRaw = includeWorkspace ? (await this.readProject(workspace)).trim() : "";
    const lessonsRaw = includeWorkspace ? (await this.readLessons(workspace)).trim() : "";
    const user = clamp(userRaw, MEMORY_BUDGET.user);
    const background = clamp(backgroundRaw, MEMORY_BUDGET.background);
    const project = clamp(projectRaw, MEMORY_BUDGET.project);
    /* 注入前按分类重排（**纠错最前**）；⛔ 只重排注入文本，磁盘上的顺序不动（用户的手工组织不被覆盖） */
    const lessons = clamp(includeWorkspace && lessonsRaw ? sortLessonSections(lessonsRaw) : "", MEMORY_BUDGET.lessons);
    const logs = includeWorkspace ? await this.recentLogs(workspace) : [];

    const blocks: string[] = [];
    /* 截断标记（④ 注入不静默丢内容）：哪层被钳了多少字，直接告诉引擎 —— 它不知道自己在盲区 = 最危险 */
    const clipped = (label: string, cut: number) => `\n> ⛔ 「${label}」超出预算被截断 ${cut} 字 —— 以上不是全部内容。先蒸馏该层（指令第 9 条）再干活，否则你在盲区里。`;
    /* ⛔ 坑与纪律放最前：它是最容易被反复踩的东西，比背景/档案更该被先读到 */
    if (lessons.text) blocks.push(`## 踩坑与纪律（必须遵守，别再犯）${lessons.cut ? clipped("踩坑与纪律", lessons.cut) : ""}\n${lessons.text}`);
    if (user.text) blocks.push(`## 用户档案${user.cut ? clipped("用户档案", user.cut) : ""}\n${user.text}`);
    if (background.text) blocks.push(`## 项目背景${background.cut ? clipped("项目背景", background.cut) : ""}\n${background.text}`);
    if (project.text) blocks.push(`## 项目记忆${project.cut ? clipped("项目记忆", project.cut) : ""}\n${project.text}`);
    if (logs.length) {
      const logBlocks = logs.map((entry) => {
        const trimmed = clamp(entry.text, MEMORY_BUDGET.logPerDay);
        return `### ${entry.date}${trimmed.cut ? clipped(`${entry.date} 日志`, trimmed.cut) : ""}\n${trimmed.text}`;
      });
      blocks.push(`## 近期工作日志（最近 ${logs.length} 天）\n${logBlocks.join("\n\n")}`);
    }
    /* 水位提示：只在某层到 90% 线时才非空 —— 引擎据此自己决定"先蒸馏再干活"。
       ⛔ 必须放在 [Harness 常驻记忆 …] 标记**之内**：这段是注入给引擎的，不是给用户看的，
          显示侧按标记对整段剥离（user-refs.ts），放外面会漏进用户气泡。 */
    const hint = includeWorkspace ? await this.watermarkHint(workspace) : "";
    if (!blocks.length) return hint ? { text: `\n\n[Harness 常驻记忆]\n${hint}\n[常驻记忆结束]\n`, stats: { chars: hint.length, over: true } } : { text: "", stats: { chars: 0, over: false } };

    let body = blocks.join("\n\n");
    const over = lessons.over || user.over || background.over || project.over || body.length > MEMORY_BUDGET.total || Boolean(hint);
    if (body.length > MEMORY_BUDGET.total) body = `${body.slice(0, MEMORY_BUDGET.total).trimEnd()}\n\n> ⛔ 常驻记忆超出总预算，尾部约 ${body.length - MEMORY_BUDGET.total} 字被截断（大概率是工作日志）。先蒸馏（指令第 9 条）再干活 —— 你现在看不到全部记忆。`;
    const tail = hint ? `\n\n${hint}` : "";
    return { text: `\n\n[Harness 常驻记忆 · 以下为已确认的长期上下文，与当前请求冲突时以当前请求为准]\n${body}${tail}\n[常驻记忆结束]\n`, stats: { chars: body.length + hint.length, over } };
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

  /** 挑出待蒸馏的日志，打包成待蒸馏文本（不调模型）。附上现有坑清单，保证蒸馏时不被丢。
   *  两个触发之一：① 日志满 30 天（年龄）② **L4 已到 90% 水位**（用户 09-22 要求：满了就压）
   *  —— 水位触发时取**最老的一半**，给近处上下文留一半（否则刚聊完就被压掉）。 */
  async pickDistill(workspace?: string): Promise<DistillPick | null> {
    const dir = this.projectDir(workspace);
    if (!dir) return null;
    const base = today();
    const all = await this.listLogDates(dir);
    let trigger: DistillPick["trigger"] = "age";
    let dates = all.filter((date) => daysBetween(date, base) >= DISTILL_AFTER_DAYS);
    if (!dates.length) {
      const budget = MEMORY_BUDGET.logPerDay * MEMORY_BUDGET.logDays;
      const used = await this.logChars(dir);
      if (all.length >= 4 && budget > 0 && used / budget >= MEMORY_DISTILL_THRESHOLD) {
        dates = all.slice(0, Math.ceil(all.length / 2));
        trigger = "watermark";
      }
    }
    if (!dates.length) return null;
    const chunks: string[] = [];
    for (const date of dates) {
      const text = (await this.readText(await this.logFilePath(dir, date))).trim();
      if (text) chunks.push(`# ${date}\n${text}`);
    }
    const lessons = (await this.readLessons(workspace)).trim();
    if (lessons) chunks.push(`# 现有纪律与记忆（lessons/*.md，蒸馏后必须完整保留，「用户纠错」一条不许丢）\n${lessons}`);
    const text = chunks.join("\n\n");
    if (text.length < DISTILL_MIN_CHARS) return null;
    return { dates, text, chars: text.length, trigger };
  }

  /**
   * 执行蒸馏：把提炼结果追加进 L1，原文移入 archive/。
   * summarize 由调用方注入（主进程用一次性 codex 会话实现），本模块不依赖模型。
   */
  async distill(workspace: string, summarize: (prompt: string, body: string) => Promise<string>, force = false): Promise<DistillResult> {
    const dir = this.projectDir(workspace);
    if (!dir) return { ok: false, dates: [], added: 0, reason: "尚未选择工作区" };
    await this.migrateLayout(dir);
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

    /* 两段式切分：核心 → L1 项目宪法；纪要 → L5 月度卷宗（模型漏标题时退回单段，内容不丢） */
    const split = splitDistill(summary);

    const memoryFile = this.projectFile(dir);
    const existing = (await this.readText(memoryFile)).trim();
    const section = `## 蒸馏 ${today()}${pick.trigger === "watermark" ? "（水位触发）" : ""}\n${split.core}\n`;
    await this.writeText(memoryFile, existing ? `${existing}\n\n${section}` : `# 项目记忆\n\n${section}`);

    /* L5 月度卷宗：比日志短、比 L1 细；给后续蒸馏当输入，也给回溯留痕（**不进每轮注入**） */
    let rollupRel: string | undefined;
    if (split.digest) {
      const month = (pick.dates[pick.dates.length - 1] ?? today()).slice(0, 7);
      const rollupFile = path.join(this.rollupDir(dir), `${month}.md`);
      const before = (await this.readText(rollupFile)).trim();
      const entry = `\n## ${today()} 蒸馏（覆盖 ${pick.dates[0]} ~ ${pick.dates[pick.dates.length - 1]}）\n${split.digest}\n`;
      await this.writeText(rollupFile, `${before || `# ${month} 月度卷宗`}\n${entry}`);
      rollupRel = `${ROLLUP_DIR}/${month}.md`;
    }

    // 原文归档（L6 冷存档）：移动而非删除，蒸馏失败也可回溯
    const archiveDir = this.archiveDir(dir);
    await fs.mkdir(archiveDir, { recursive: true });
    for (const date of pick.dates) {
      const from = await this.logFilePath(dir, date);
      const to = path.join(archiveDir, `${date}.md`);
      try { await fs.rename(from, to); }
      catch (error: any) { if (error.code !== "ENOENT") throw error; }
    }
    await this.writeState(workspace, { lastDistillAt: Date.now() });
    return { ok: true, dates: pick.dates, added: split.core.length, trigger: pick.trigger, rollup: rollupRel };
  }

  /** 会话结束时调用：节流 + 全异常兜底，绝不影响主流程。
   *  ② 先试 L4 日志蒸馏；没触发（未满 30 天/未满水位/节流）再试 L5 月卷下沉 —— 八层表里
   *  「L5 满了沉 L1」从此有**执行者**，不再只是纸面规则。 */
  async autoDistill(workspace: string | undefined, summarize: (prompt: string, body: string) => Promise<string>): Promise<DistillResult | null> {
    if (!workspace) return null;
    try {
      const logs = await this.distill(workspace, summarize);
      if (logs.ok) return logs;
    } catch { /* 落到 L5 下沉再试 */ }
    try { return await this.distillRollup(workspace, summarize); }
    catch { return null; }
  }

  /** ② L5 → L1 下沉：月卷总量到 90% 线时，把**最老**一个月卷提炼进 L1。
   *  月卷原文**保留**（L5 比 L1 细，回溯仍需要；L1 自身的压缩由引擎按水位提示执行）。 */
  async distillRollup(workspace: string, summarize: (prompt: string, body: string) => Promise<string>): Promise<DistillResult> {
    const dir = this.projectDir(workspace);
    if (!dir) return { ok: false, dates: [], added: 0, reason: "尚未选择工作区" };
    const state = await this.readState(workspace);
    if (state.lastDistillAt && Date.now() - state.lastDistillAt < AUTO_DISTILL_INTERVAL_MS) {
      return { ok: false, dates: [], added: 0, reason: "距上次蒸馏不足 6 小时，已跳过" };
    }
    const rollupDir = this.rollupDir(dir);
    const months = (await this.listRollupMonths(rollupDir)).sort();
    if (!months.length) return { ok: false, dates: [], added: 0, reason: "没有月度卷宗" };
    const total = (await this.dirChars(dir, ROLLUP_DIR)) || 0;
    if (total < ROLLUP_BUDGET * MEMORY_DISTILL_THRESHOLD) {
      return { ok: false, dates: [], added: 0, reason: `月卷水位未到（${total}/${ROLLUP_BUDGET}）` };
    }
    const month = months[0];
    const text = (await this.readText(path.join(rollupDir, `${month}.md`))).trim();
    if (text.length < DISTILL_MIN_CHARS) return { ok: false, dates: [month], added: 0, reason: "最老月卷太短，不值得蒸" };

    const summary = (await summarize(DISTILL_PROMPT, text)).trim();
    if (!summary) return { ok: false, dates: [month], added: 0, reason: "模型没有返回提炼结果" };
    const split = splitDistill(summary);
    /* 沉 L1：核心 + 纪要都进项目宪法（月卷在此层的作用就是被蒸馏），标注来源月 */
    const memoryFile = this.projectFile(dir);
    const existing = (await this.readText(memoryFile)).trim();
    const section = `## 蒸馏 ${today()}（L5 月卷下沉：${month}）\n${split.core}${split.digest ? `\n\n${split.digest}` : ""}\n`;
    await this.writeText(memoryFile, existing ? `${existing}\n\n${section}` : `# 项目记忆\n\n${section}`);
    await this.writeState(workspace, { lastDistillAt: Date.now() });
    return { ok: true, dates: [month], added: split.core.length + (split.digest?.length ?? 0), trigger: "watermark", rollup: `${ROLLUP_DIR}/${month}.md` };
  }

  /** 列出 rollups/ 下已有月卷（YYYY-MM），目录不存在 = 空 */
  private async listRollupMonths(rollupDir: string): Promise<string[]> {
    try {
      return (await fs.readdir(rollupDir)).filter((name) => /^\d{4}-\d{2}\.md$/.test(name)).map((name) => name.replace(/\.md$/, ""));
    } catch { return []; }
  }

  // ── 设置页快照 ─────────────────────────────────────────────────
  async snapshot(workspace?: string): Promise<MemoryLayersSnapshot> {
    const dir = this.projectDir(workspace);
    const user = await this.readUser();
    const background = await this.readBackground(workspace);
    const project = await this.readProject(workspace);
    const lessons = await this.readLessons(workspace);
    const logs = dir ? await this.listLogDates(dir) : [];
    const logStats = dir
      ? await Promise.all(logs.slice(-7).map(async (date) => ({ date, chars: (await this.readText(path.join(dir, `${date}.md`))).length })))
      : [];
    const pending = dir ? await this.pickDistill(workspace) : null;
    const logsChars = logStats.reduce((sum, entry) => sum + entry.chars, 0);
    const lessonsChars = lessons.length;
    const total = user.length + background.length + project.length + lessonsChars + logsChars;
    return {
      user,
      background,
      project,
      lessons,
      hasWorkspace: Boolean(dir),
      paths: {
        user: this.userFile,
        projectDir: dir ?? "",
        background: dir ? this.backgroundFile(dir) : "",
        project: dir ? this.projectFile(dir) : "",
        lessons: dir ? this.lessonsDir(dir) : "",
        logDir: dir ? this.logsDir(dir) : "",
      },
      logs: logStats,
      budget: {
        user: user.length,
        background: background.length,
        project: project.length,
        lessons: lessonsChars,
        logs: logsChars,
        total,
        over: user.length > MEMORY_BUDGET.user || background.length > MEMORY_BUDGET.background || project.length > MEMORY_BUDGET.project || lessonsChars > MEMORY_BUDGET.lessons || total > MEMORY_BUDGET.total,
      },
      /* 金字塔八层水位（needDistill = 已达 90% 线）—— 设置页据此展示漏斗与"该蒸馏了" */
      layers: layerWatermarks(await this.layerUsage(workspace)),
      /* 纪律与坑的分类计数（纠错单独一类，用户 09-22 要求） */
      lessonGroups: groupLessonSections(lessons),
      pendingDistill: { dates: pending?.dates ?? [], chars: pending?.chars ?? 0 },
      lastDistillAt: workspace ? (await this.readState(workspace)).lastDistillAt : undefined,
    };
  }
}
