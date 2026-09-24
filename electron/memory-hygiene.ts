/**
 * 记忆整洁与清理规则（09-22 用户：「记忆管理和记忆整洁，记忆清理规则都要写好」）。
 *
 * 三条原则（写进规则表，UI 与引擎都读它，别再各写一份）：
 *  ① **能归档就不删**：被压缩掉的内容先移进 L6 冷存档（可回溯）；只有"冷存档本身"允许被用户清空；
 *  ② **保护项永不自动清**：L0 用户手写内容、L2 的「用户纠错」、pinned 碎片 —— 自动流程一律不碰；
 *  ③ **清理要留痕**：淘汰写 `pruned.jsonl`，蒸馏把原文移进 `archive/`；谁被清、何时清，事后查得到。
 *
 * 分工：
 *  · 本模块 = **规则 + 判定**（纯函数、无 IO，预检可 require 产物直接跑）；
 *  · 执行动作在 `memory-layers`（归档/整理自研层）与 `MemoryStore.pruneNow()`（碎片池）；
 *  · 危险动作的**二次确认**在 IPC 层强校验（`confirm !== true` 直接拒），守卫【107】断言这条。
 */
import type { PyramidLayerId, PyramidLayerStatus } from "./memory-layers";

export type CleanupRule = {
  layer: PyramidLayerId;
  name: string;
  /** 什么时候整理 / 清理 */
  when: string;
  /** 允许的动作（含明确禁止项） */
  action: string;
  /** 保护项：这部分永不自动清 */
  protect: string;
  /** 留痕落点（事后可查） */
  trace: string;
};

/** 八层的清理规则（与 `MEMORY_PYRAMID` 同 id；加层必须同步加行 —— 守卫【107】断言齐全） */
export const CLEANUP_RULES: readonly CleanupRule[] = [
  {
    layer: "L0",
    name: "用户档案",
    when: "只有用户主动改；系统永不触发",
    action: "仅允许用户手改；禁止任何自动压缩/删除",
    protect: "整层都是用户手写 ⇒ 全保护",
    trace: "设置 → 记忆的编辑记录",
  },
  {
    layer: "L1",
    name: "项目宪法",
    when: "水位 ≥90%，或用户点「蒸馏」",
    action: "原地压缩：合并同主题、删已过时；被删内容**先移进 L6**",
    protect: "用户手写段落（以 `#` 标题开头且带「手写」标记）",
    trace: "archive/ + `.distill-state.json`",
  },
  {
    layer: "L2",
    name: "纪律与记忆",
    when: "水位 ≥90%，或同现象重复写入时",
    action: "同现象只留一条（去重）；超 120 行提示整理；升级为技能后在行尾标「已升级为技能」",
    protect: "**「用户纠错」整类**（只许压缩措辞，不许删条）",
    trace: "LESSONS 行内标注 + 蒸馏记录",
  },
  {
    layer: "L3",
    name: "项目背景",
    when: "水位 ≥90%",
    action: "合并同主题；稳定下来的约束**升格**进 L1（不是删）",
    protect: "用户手写段落",
    trace: "L1 的蒸馏记录",
  },
  {
    layer: "L4",
    name: "每日日志",
    when: "满 30 天，或水位 ≥90%（自动，取最老一半）",
    action: "蒸馏成纪要进 L5、仍然成立的事实进 L1；原文**移动**进 L6",
    protect: "无（但只移动、不删除）",
    trace: "archive/YYYY-MM-DD.md",
  },
  {
    layer: "L5",
    name: "月度卷宗",
    when: "水位 ≥90%",
    action: "压缩进 L1；月卷本身保留（作为回溯层）",
    protect: "无（保留不删）",
    trace: "L1 的蒸馏记录",
  },
  {
    layer: "L6",
    name: "冷存档",
    when: "**只在用户手动清空**时",
    action: "默认永久保留、不参与注入；用户可「清空冷存档」释放空间（需二次确认，清空后不可回溯）",
    protect: "无（清空是用户显式决定）",
    trace: "清空动作写 pruned.jsonl（记文件数/字节数）",
  },
  {
    layer: "L7",
    name: "碎片池",
    when: "每 6 小时自动检查一次；或用户点「清理过期碎片」",
    action: "过期（临时上下文超 14 天）与超容量（500 条）按价值淘汰",
    protect: "`pinned` 与分类「用户纠错」永不淘汰",
    trace: "pruned.jsonl（一行一条，含 workspace）",
  },
];

/** 允许通过 IPC 触发的清理动作（**白名单**：未知动作一律拒绝，守卫【107】） */
export const HYGIENE_ACTIONS = ["purge-archive", "prune-pool", "tidy-lessons"] as const;
export type HygieneAction = (typeof HYGIENE_ACTIONS)[number];

export function isHygieneAction(value: unknown): value is HygieneAction {
  return typeof value === "string" && (HYGIENE_ACTIONS as readonly string[]).includes(value);
}

/** 二次确认文案（危险动作必须让用户知道后果；UI 与 IPC 用同一份措辞） */
export const HYGIENE_ACTION_LABEL: Record<HygieneAction, { title: string; danger: string }> = {
  "purge-archive": { title: "清空冷存档", danger: "删除后无法回溯（被压缩掉的原文将永久消失）" },
  "prune-pool": { title: "清理过期碎片", danger: "按规则淘汰碎片池条目（pinned 与「用户纠错」豁免）" },
  "tidy-lessons": { title: "整理纪律格式", danger: "只规范空白/空行，不改写任何内容" },
};

export type HygieneIssue = {
  severity: "info" | "warn";
  layer: PyramidLayerId | "-";
  code: string;
  message: string;
  count?: number;
};

const LESSON_MAX_CHARS = 320;
const LESSON_MAX_LINES = 120;
const LESSON_MARKS = ["⚠️ 纠错：", "⚠️ 坑：", "约定：", "偏好："];

/**
 * 纪律行的整洁检查（纯函数）：把**格式不齐**的条目抓出来。
 * ⛔ 只报告、不改内容 —— 自动改写用户/引擎写下的纪律文本风险太高（可能改掉语义）。
 *    真正要改的是"规范空白"这种无损操作，那由 `tidy-lessons` 动作做。
 */
export function lintLessonLines(text: string): HygieneIssue[] {
  const issues: HygieneIssue[] = [];
  const lines = String(text ?? "").split("\n");
  const entries = lines.filter((line) => /^\s*-\s+/.test(line));
  let noDate = 0;
  let noMark = 0;
  let tooLong = 0;
  for (const line of entries) {
    if (!/\d{4}-\d{2}-\d{2}/.test(line)) noDate += 1;
    if (!LESSON_MARKS.some((mark) => line.includes(mark))) noMark += 1;
    if (line.length > LESSON_MAX_CHARS) tooLong += 1;
  }
  if (noDate) issues.push({ severity: "warn", layer: "L2", code: "lesson-no-date", message: `有条目缺日期（YYYY-MM-DD），蒸馏时无法判断新旧`, count: noDate });
  if (noMark) issues.push({ severity: "warn", layer: "L2", code: "lesson-no-mark", message: `有条目缺分类标记（⚠️ 纠错：/⚠️ 坑：/约定：/偏好：），无法判断该进哪一类`, count: noMark });
  if (tooLong) issues.push({ severity: "warn", layer: "L2", code: "lesson-too-long", message: `有条目超过 ${LESSON_MAX_CHARS} 字，建议拆成多条短句`, count: tooLong });
  if (entries.length > LESSON_MAX_LINES) issues.push({ severity: "warn", layer: "L2", code: "lesson-over-lines", message: `条目已超过 ${LESSON_MAX_LINES} 行，建议整理（合并同现象 / 升级为技能）`, count: entries.length });
  return issues;
}

/**
 * 汇总整洁报告：把「哪层满了、哪里该整理、能清什么」算成一张待办清单。
 * 纯函数（输入是各层现状快照）⇒ 预检【107】直接真跑，不依赖文件系统。
 */
export function planHygiene(input: {
  layers?: PyramidLayerStatus[];
  lessonText?: string;
  archive?: { files: number; bytes: number };
  fragments?: { total: number; expiring: number; expired: number };
  hasWorkspace?: boolean;
  /** 阈值可由调用方覆盖（预检要造超限场景） */
  archiveWarnFiles?: number;
  archiveWarnBytes?: number;
}): HygieneIssue[] {
  const issues: HygieneIssue[] = [];
  if (input.hasWorkspace === false) {
    issues.push({ severity: "info", layer: "-", code: "no-workspace", message: "当前会话没有工作区：项目级记忆（L1–L6）不参与，只有 L0 用户档案生效" });
  }
  for (const layer of input.layers ?? []) {
    if (!layer.needDistill) continue;
    issues.push({
      severity: "warn",
      layer: layer.id,
      code: "layer-over",
      message: `${layer.id} ${layer.name} 已到 ${Math.round((layer.ratio ?? 0) * 100)}% ⇒ ${layer.sink}`,
      count: layer.used,
    });
  }
  issues.push(...lintLessonLines(input.lessonText ?? ""));

  const archive = input.archive;
  if (archive) {
    const filesLimit = input.archiveWarnFiles ?? 200;
    const bytesLimit = input.archiveWarnBytes ?? 2 * 1024 * 1024;
    if (archive.files > filesLimit || archive.bytes > bytesLimit) {
      issues.push({
        severity: "info",
        layer: "L6",
        code: "archive-large",
        message: `冷存档 ${archive.files} 个文件 / ${(archive.bytes / 1024).toFixed(0)} KB，可「清空冷存档」释放空间（清空后不可回溯）`,
        count: archive.files,
      });
    }
  }
  const fragments = input.fragments;
  if (fragments && fragments.expired > 0) {
    issues.push({
      severity: "warn",
      layer: "L7",
      code: "fragments-expired",
      message: `碎片池有 ${fragments.expired} 条已过期（pinned 与「用户纠错」豁免）⇒ 可「清理过期碎片」`,
      count: fragments.expired,
    });
  }
  return issues;
}

/** 待办清单里"可以点一下"的动作（按优先级）：供 UI 显示按钮，供引擎参考 */
export function suggestedActions(issues: HygieneIssue[]): HygieneAction[] {
  const out: HygieneAction[] = [];
  for (const issue of issues) {
    if (issue.code === "fragments-expired" && !out.includes("prune-pool")) out.push("prune-pool");
    if (issue.code === "lesson-no-date" || issue.code === "lesson-no-mark") {
      if (!out.includes("tidy-lessons")) out.push("tidy-lessons");
    }
    if (issue.code === "archive-large" && !out.includes("purge-archive")) out.push("purge-archive");
  }
  return out;
}
