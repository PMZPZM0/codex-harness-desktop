/**
 * Laya 判断工具 · 请求构造与结果格式化（10-18 用户：「给 codex 加一个调用 laya 判断的工具…
 * 看看那些场景下可以利用起来 laya 模型做判断，如果安装了 laya 模型，就再暴露这个工具给 codex」）。
 *
 * ⛔ 本文件是**纯函数叶子**（无 Electron / 无 IO）：守卫可直接真跑真值表，主进程只做「组装 → 调 Laya」。
 *
 * 能力边界（10-05 校准结论沿用）：
 *   · Laya 是**短文本多选一分类器**，不是生成模型，也不是安全/事实核查器；
 *   · 可靠场景 = 知识/闲聊二分类、重复/新增二分类、以及固定选项的粗分类；
 *   · ⛔ 开放生成、长文本理解、安全/法律/医疗/财务/不可逆操作的决定不要交给它；
 *   · 低置信一律弃权（返回明确文案），调用方不得把「弃权」当成一个选项使用。
 */
export type LayaJudgeInput = {
  preset?: string;
  state?: string;
  reference?: string;
  instructions?: string;
  criteria?: Record<string, string>;
  minConfidence?: number;
  timeoutMs?: number;
};

export type LayaJudgeRequest = {
  preset: string;
  state: string;
  instructions: string;
  criteria: Record<string, string>;
  minConfidence: number;
  timeoutMs: number;
};

const MAX_STATE = 4000;
const MAX_REFERENCE = 1500;
const MAX_INSTRUCTIONS = 500;
const MAX_OPTION_NAME = 30;
const MAX_OPTION_DESC = 200;
const MIN_CONFIDENCE = 0.5;
const MAX_CONFIDENCE = 0.95;
const MIN_TIMEOUT_MS = 3_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 15_000;

export const LAYA_PRESETS = ["knowledge_gate", "duplicate", "custom"] as const;

/** 知识入库门禁（与 knowledge_add 内部使用同一份判据 —— 单一真相源，⛔ 不各写一份）。 */
export const KNOWLEDGE_GATE_INSTRUCTIONS = "下面是一条用户想让 AI 存进项目知识库的内容。判断它属于哪一类。";
export const KNOWLEDGE_GATE_CRITERIA: Record<string, string> = {
  knowledge: "项目知识：开发规范、技术结论、踩坑经验、配置或接口说明、决策记录，有实质信息量。",
  chatter: "非知识：寒暄、闲聊、情绪表达、口头招呼、无实义内容。",
};

/** 重复内容判断（与 knowledge_add 内部使用同一份判据）。 */
export const DUPLICATE_CRITERIA: Record<string, string> = {
  duplicate: "重复：讲的是同一件事，已有条目已覆盖，没有新增信息",
  new: "新知识：内容不同或有新增信息，值得另存一条",
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fail(message: string): never {
  throw new Error(message);
}

function normalizeCriteria(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("criteria 必须是对象：{ 选项名: 含义 }，2~6 个选项");
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, desc]) => [asText(key), asText(desc)] as const)
    .filter(([key, desc]) => key || desc);
  if (entries.length < 2 || entries.length > 6) {
    fail("criteria 需要 2~6 个选项（键=选项名，值=含义）");
  }
  const out: Record<string, string> = {};
  for (const [key, desc] of entries) {
    if (!key) fail("criteria 里每个选项都要有名字");
    if (!desc) fail(`criteria 选项「${key}」缺少含义说明`);
    if (key.length > MAX_OPTION_NAME) fail(`criteria 选项名「${key.slice(0, 20)}…」太长（≤${MAX_OPTION_NAME} 字）`);
    if (desc.length > MAX_OPTION_DESC) fail(`criteria 选项「${key}」的含义太长（≤${MAX_OPTION_DESC} 字）`);
    if (key === "__proto__" || key === "prototype" || key === "constructor") fail(`criteria 选项名「${key}」不合法`);
    out[key] = desc;
  }
  return out;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 把模型传来的参数收敛成一次 Laya 请求；非法输入**抛中文原因**（执行端原样回给模型）。
 * 默认 preset=knowledge_gate（最常用、且经过校准）；duplicate 必须给 reference；custom 必须给 instructions + criteria。
 */
export function resolveLayaJudgeRequest(input: LayaJudgeInput | null | undefined): LayaJudgeRequest {
  const raw = input && typeof input === "object" ? input : {};
  const preset = asText(raw.preset) || "knowledge_gate";
  if (!(LAYA_PRESETS as readonly string[]).includes(preset)) {
    fail(`未知 preset「${preset}」：可用 ${LAYA_PRESETS.join(" / ")}`);
  }
  const state = asText(raw.state);
  if (!state) fail("state 不能为空：把要判断的文本放进来");
  if (state.length > MAX_STATE) fail(`state 太长（${state.length} 字，上限 ${MAX_STATE}）；请先提炼要点再判断`);

  const minConfidence = clampNumber(raw.minConfidence, MIN_CONFIDENCE, MAX_CONFIDENCE, MIN_CONFIDENCE);
  const timeoutMs = clampNumber(raw.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  if (preset === "knowledge_gate") {
    return { preset, state, instructions: KNOWLEDGE_GATE_INSTRUCTIONS, criteria: { ...KNOWLEDGE_GATE_CRITERIA }, minConfidence, timeoutMs };
  }

  if (preset === "duplicate") {
    const reference = asText(raw.reference);
    if (!reference) fail("preset=duplicate 需要 reference：把已有条目/已有内容放进来");
    if (reference.length > MAX_REFERENCE) fail(`reference 太长（${reference.length} 字，上限 ${MAX_REFERENCE}）`);
    if (reference.length + state.length > MAX_STATE) {
      fail(`duplicate 的 reference + state 合计不能超过 ${MAX_STATE} 字（当前 ${reference.length + state.length}）`);
    }
    return {
      preset,
      /* ⛔ state 只放**要判的新内容**，已有条目放 instructions —— 与 knowledge_add 内部验证过的
         问法同形。10-18 实测：把两段都塞进 state 时，Laya 会把这种"对照"判成 new（0.94），
         问法改成"已有内容在说明里"才符合它的训练分布。 */
      state,
      instructions: `已有内容：\n${reference}\n\n判断新内容相对已有内容是否重复。`,
      criteria: { ...DUPLICATE_CRITERIA },
      minConfidence,
      timeoutMs,
    };
  }

  const instructions = asText(raw.instructions);
  if (!instructions) fail("preset=custom 需要 instructions：说明要让 Laya 判断什么");
  if (instructions.length > MAX_INSTRUCTIONS) fail(`instructions 太长（${instructions.length} 字，上限 ${MAX_INSTRUCTIONS}）`);
  return {
    preset,
    state,
    instructions,
    criteria: normalizeCriteria(raw.criteria),
    minConfidence,
    timeoutMs,
  };
}

/**
 * 结果文案：**低置信必须明确写「弃权」** —— 模型很容易把 38% 的猜测当结论；
 * 弃权文案里不给「建议选项」，只告诉它别依赖这次判断。
 */
export function formatLayaVerdict(
  choice: string,
  confidence: number,
  criteria: Record<string, string>,
  minConfidence: number,
): { abstained: boolean; text: string } {
  const pct = Math.round(Math.min(1, Math.max(0, Number(confidence) || 0)) * 100);
  if (!(confidence >= minConfidence)) {
    return {
      abstained: true,
      text: `Laya 弃权：置信只有 ${pct}%，低于 ${Math.round(minConfidence * 100)}% 阈值。不要依据这次判断做决定，改用你自己的判断或向用户确认。`,
    };
  }
  const meaning = criteria[choice] ? `\n含义：${criteria[choice]}` : "";
  return { abstained: false, text: `Laya 判断：${choice}（置信 ${pct}%）${meaning}` };
}
