/**
 * memory/layers-budget.ts —— 记忆分层的**目录布局 + 预算 + 纯函数**。
 *
 * 从 electron/memory-layers.ts（1129 行）切出（P2 批次 4）：这一段无 fs / path / this 依赖，
 * 是「布局常量 / 注入预算 / 金字塔表 / 水位 / 蒸馏切分 / scratch 判定」—— 纯逻辑，可单测。
 * ⛔ 对外仍经 memory-layers.ts 重导出 —— 调用方零改动。
 */
import { CORRECTION_CATEGORY, PITFALL_CATEGORY, PREFERENCE_CATEGORY, SOP_CATEGORY } from "../memory-lessons";

export const MEMORY_DIR = ".codex-harness";
export const MEMORY_SUB = "memory";
export const ARCHIVE_DIR = "archive";

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
export const PROJECT_DIR = "project";
export const LESSONS_DIR = "lessons";
export const LOGS_DIR = "logs";
export const ROLLUP_DIR = "rollups";
export const MEMORY_FILE = "MEMORY.md";
export const BACKGROUND_FILE = "BACKGROUND.md";
/** L2 分类 → 文件名（键直接用 memory-lessons 的分类常量，保证两处永远同名） */
export const LESSON_FILES: Record<string, string> = {
  [CORRECTION_CATEGORY]: "corrections.md",
  [PITFALL_CATEGORY]: "pitfalls.md",
  [SOP_CATEGORY]: "sop.md",
  [PREFERENCE_CATEGORY]: "preferences.md",
};
export const LESSON_MISC_FILE = "misc.md";
/** MCP 后端下自动捕获的 lesson 候选落点（仍写进 lessons/misc.md，由 Codex 下一轮落 MCP 后删除）。 */
export const PENDING_MCP_SECTION = "待入 MCP（自动捕获，落库后删除）";
/** 迁移源：v1 摊在 memory/ 根的旧纪律文件名（v2 起改为 lessons/<分类>.md） */
export const LEGACY_LESSONS = "LESSONS.md";
export const LEGACY_MARK = ".layout-v2-done";

/** 注入预算（字符）：超出即提示蒸馏，不做静默截断丢失。
 *  口径 = **重度开发者**（2026-09-22 用户定：一天几十轮、多会话并行、大项目），
 *  旧值（800/1500/…）六七轮就触 90% 蒸馏线，太紧。各层不会同时满，total 是总闸。
 *
 *  ⛔⛔ 2026-10-10 修「记忆库很快被占满」：改前 total=30000 **恰好等于**常驻四层之和
 *  （4000+6000+12000+8000）⇒ **日志段从来没有过预算** —— 超限时走 `body.slice(0, total)`，
 *  而日志拼在**最后**，于是每一轮注入被砍掉的都是日志（用户症状：容量小、很快占满、
 *  新日志/新记忆看不见）。根因不是"总量小"，是**两个数字不自洽**：各层独立预算之和
 *  远大于总闸。⇒ 现在 total 显式 = 常驻四层上限 + 日志段上限（logs），三者算术自洽
 *  （守卫【104】有算术断言盯住，防止以后再把它们改到互相打架）。
 *  ⛔ 2026-10-10 同日（用户：「现在初始容量太小了，先扩大一下」）：常驻四层与日志段
 *  **整体翻倍**（基准容量），total 随之 = 60000 + 30000 = 90000。用户级倍率（见
 *  MEMORY_SCALE_OPTIONS）在这个基准上继续放大 —— 改基准时两处一起看。 */
export const MEMORY_BUDGET = {
  user: 8000,
  background: 12000,
  project: 24000,
  /** L1.5 坑与纪律：独立预算，注入时排在最前（纪律比背景更容易被反复踩） */
  lessons: 16000,
  /** L4 每日日志：注入时每天钳 logPerDay、回灌最近 logDays 天；
   *  L4 水位预算 = logPerDay × logDays（满了自动蒸最老一半，不丢内容） */
  logPerDay: 8000,
  logDays: 5,
  /** 日志段**整体**注入上限（区别于 L4 的「存储水位」logPerDay×logDays：存储可以攒满 5 天，
   *  注入只给 logs 这么多 —— 超了**按天从最旧丢**，⛔ 不按字符砍尾）。 */
  logs: 30000,
  /** 总闸 = 常驻四层（user+background+project+lessons = 60000）+ 日志段（logs）。 */
  total: 90000,
} as const;

/* ── 容量倍率（2026-10-10 用户：「记忆库容量增加倍率功能」）────────────────────────
   用途：**按倍数扩展记忆库容量**（长周期 / 大项目一次性把预算放宽，不必逐层手改）。
   ⛔ 只放大**字符**类预算：`logDays`（回灌几天）不参与放大 —— ×16 会变成 80 天日志，
   那是"回灌窗口"不是"容量"。各层与 total **同比**放大 ⇒ 预算自洽关系
   （四层之和 + logs = total）在任意倍率下都成立（守卫【104】按倍率逐档验算）。 */
export const MEMORY_SCALE_OPTIONS = [1, 2, 4, 8, 10, 16] as const;
export const DEFAULT_MEMORY_SCALE = 1;

/** 倍率归一化：只接受选项里的值，其余（手改配置 / 旧版本残留 / NaN）一律回基准。 */
export function normalizeMemoryScale(value: unknown): number {
  const n = Math.round(Number(value));
  return (MEMORY_SCALE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_MEMORY_SCALE;
}

/** 注入预算的形状（基准 MEMORY_BUDGET 与放大后的版本共用）。 */
export type MemoryBudget = {
  user: number; background: number; project: number; lessons: number;
  logPerDay: number; logDays: number; logs: number; total: number;
};

/** 按倍率放大后的预算（基准 = MEMORY_BUDGET；k=1 时与基准逐字段相同）。 */
export function scaledMemoryBudget(scale: unknown = DEFAULT_MEMORY_SCALE): MemoryBudget {
  const k = normalizeMemoryScale(scale);
  if (k === 1) return { ...MEMORY_BUDGET };
  return {
    user: MEMORY_BUDGET.user * k,
    background: MEMORY_BUDGET.background * k,
    project: MEMORY_BUDGET.project * k,
    lessons: MEMORY_BUDGET.lessons * k,
    logPerDay: MEMORY_BUDGET.logPerDay * k,
    logDays: MEMORY_BUDGET.logDays,            // ⛔ 不放大（回灌窗口，不是容量）
    logs: MEMORY_BUDGET.logs * k,
    total: MEMORY_BUDGET.total * k,
  };
}

/** 纪律文件行数上限：超了不自动删（用户数据），只在文件头提示整理/蒸馏 */
export const LESSONS_MAX_LINES = 120;

/** 蒸馏阈值：日志满 30 天进入可蒸馏状态 */
export const DISTILL_AFTER_DAYS = 30;
/** 自动蒸馏节流：同一工作区 6 小时内最多跑一次，避免每个会话都烧 token */
export const AUTO_DISTILL_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 日志太短不值得调模型 */
export const DISTILL_MIN_CHARS = 200;

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
export const ROLLUP_BUDGET = 12000;

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

/** 按「层 id → 当前字符数」算水位（**纯函数**：预检【104】直接真跑它，不依赖文件系统）。
 *  ⛔ scale 只作用于**输出**的 budget（MEMORY_PYRAMID 仍是基准值）—— 水位统一按当前倍率算，
 *  否则容量放大后水位条还按旧预算画，会出现"明明没用多少却报 95%"的假警报。 */
export function layerWatermarks(used: Partial<Record<PyramidLayerId, number>> = {}, scale: unknown = DEFAULT_MEMORY_SCALE): PyramidLayerStatus[] {
  const k = normalizeMemoryScale(scale);
  return MEMORY_PYRAMID.map((layer) => {
    const cur = Math.max(0, Math.round(used[layer.id] ?? 0));
    const budget = layer.budget > 0 ? layer.budget * k : 0;
    /* 外部层（budget 0：冷存档 / 碎片池）不按字符算比例，也就永远不触发蒸馏 */
    if (budget <= 0) return { ...layer, budget, used: cur, ratio: null, needDistill: false };
    const ratio = cur / budget;
    return { ...layer, budget, used: cur, ratio, needDistill: ratio >= MEMORY_DISTILL_THRESHOLD };
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

export const DISTILL_PROMPT = `你是记忆蒸馏器。下面是某个项目过去的工作日志（可能附「现有踩坑与纪律」清单），请把它们提炼成「长期有效的项目记忆」。

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

export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function daysBetween(date: string, base: string): number {
  const a = Date.parse(`${date}T00:00:00`);
  const b = Date.parse(`${base}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / 86_400_000);
}

/** 超预算时从头部保留（人工维护的记忆，前面是重点），尾部给提示 */
/** 预算钳制。⛔ 截断必须**可见**：返回 cut = 被砍掉的字符数，调用方在注入块里标注
 *  「本节被截断 N 字」—— 静默砍尾部 = 引擎在盲区里干活，还以为看到的是全部。 */
export function clamp(text: string, budget: number): { text: string; over: boolean; cut: number } {
  if (text.length <= budget) return { text, over: false, cut: 0 };
  return { text: `${text.slice(0, budget).trimEnd()}\n\n…（已超出 ${budget} 字预算，请到设置 → 记忆做一次蒸馏）`, over: true, cut: text.length - budget };
}

/** scratch 会话识别（09-22 实测教训）：cwd 落在 scratch/chat-… 的工作区不是真项目 ——
 *  记忆写进去 = 构建即清。projectDir 对它返回 null ⇒ 项目层记忆（L1-L6）一律不写不读。
 *  纯函数，守卫【108】直接真跑。 */
export function isScratchWorkspace(workspace: string): boolean {
  return /[\\/]scratch[\\/]chat-\d{8}-/.test(workspace);
}
