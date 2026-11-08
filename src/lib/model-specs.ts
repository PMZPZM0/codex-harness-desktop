/**
 * 已知模型规格表：按模型 id 自动匹配 推荐上下文窗口 / 最大输出 / 输入输出模态 / 思考档位。
 *
 * 用途（两处，都很关键）
 *  ① **新手快速配置**：添加模型时输入 ID 就自动回填上下文 / 最大输出 / 模态，不用去翻官方文档；
 *  ② `ids[]` 是**模型 ID 补全**的候选来源（见 `suggestModelIds`，UI 在 `ModelIdInput`）。
 *
 * ⛔ 为什么「视觉（inputTypes 含 image）」必须准 —— 它不是个徽标而已：
 *    主进程 `buildModelCatalog` 会把它翻成给引擎的 `input_modalities` 与
 *    `supports_image_detail_original`（electron/main.ts）。标错两个方向都有害：
 *    漏标 → 视觉模型发图被引擎当不支持；虚标 → 纯文本模型被允许发图、请求被供应商拒。
 *
 * 数据来源（2026-11-08 增量更新，逐条按官方文档 / 官方模型页；第三方只用于交叉印证）：
 *  · ⛔ 11-08 下架清理：GPT-4 / 4o / 4.1、o3 / o4-mini、GPT-5 / 5-mini（官方退役名单）、
 *    Claude 4.5 及更早、Kimi K2 与 moonshot-v1、GLM-4.x、豆包 1.x、MiniMax M2.7 / abab
 *    已从本表删除（旧配置创建时已把参数落库，不依赖本表；补全也不再推荐死 id）。
 *  · GPT-6 Astra / GPT-5.6 Sol·Terra·Luna：OpenAI 模型页（1.05M 上下文 / 128K 输出 / 文本+图像输入）
 *  · GPT-6.1 Sol（09-29）/ Terra（10-26）：OpenAI API 模型页（1.05M / 128K / 视觉；档位 low~max，Terra 另含 none）
 *  · Claude Fable 5 / Opus 4.8：Anthropic 文档（1M / 128K / 文本+图像）
 *  · Claude Opus 5.5（09-22）：Anthropic 官方（1M / 128K / 文本·图像·PDF）
 *  · Gemini 3.1 Pro / 3.5 Flash / 3.1 Flash-Lite：Google Cloud 模型指南（1,048,576 / 65,536 / 文本·图·音·视频）
 *  · Gemini 4 Argon（10-13）：Google 模型页（1,048,576 / 输出上限 100 万 / 思考 low·medium·high）
 *  · DeepSeek V4.1 Flash-1017（10-17 更新）/ V4-Pro-0813：官方（1M / 384K；Flash 原生视觉，Pro 纯文本；
 *    deepseek-chat / reasoner 老名 2026-07-24 已下线）
 *  · Kimi K3 / K3-256K：官方（1M / 256K；**K3 首次支持原生视觉**）
 *  · Kimi K3.1 Pro（10-24）：Kimi API 文档（1M / 输出上限 1M / low·high·max / 图片·视频）
 *  · GLM-5.3 / 5.3-Flash：Z.ai（约 1M / 128K；**5.3 纯文本，只有 5.3-Flash 是原生多模态**）
 *  · Qwen3.8-Max：阿里（约 1M / 131K；文本+图像+视频）
 *  · 豆包 Seed 2.0：字节（256K；视觉为国内第一梯队）
 *  · 豆包 Seed 2.1 Pro：火山方舟模型列表（1,048,576 / 256K / 文本+图像）
 *  · 日日新 SenseNova 6.5 Pro / Turbo：商汤大装置文档（128K(131072)；图文视频输入）
 *  · MiniMax M3.1 Flash（10-19）：官方模型卡（1M / 文本·图像·视频 / 五档思考；输出上限未公布 ⇒ 不填）
 *  · 小米 MiMo-V2.5 / Meta Muse Spark：官方发布信息（1M；全模态）
 *
 * 维护约定：**只收录有据可查的**。拿不准就不加 —— 漏加只是用户手填一次，错加会把
 * 错误的模态/额度带进引擎（比不填更糟）。用户可用 `userData/model-specs.json` 覆盖（见文件尾）。
 */
export type ModelSpec = {
  contextWindow: number;
  maxOutputTokens?: number;
  /** 支持的思考档位；空数组 = 非推理模型（不显示思考菜单） */
  efforts: string[];
  /** 输入/输出模态：视觉模型含 "image"，多模态含 "video" */
  inputTypes?: ("text" | "image" | "video")[];
  outputTypes?: ("text" | "image" | "video")[];
};

const TXT: ("text" | "image" | "video")[] = ["text"];
const VIS: ("text" | "image" | "video")[] = ["text", "image"];
const VISVIDEO: ("text" | "image" | "video")[] = ["text", "image", "video"];
const OUT_TXT: ("text" | "image" | "video")[] = ["text"];

/** 一条规则 = 正则匹配 + 补全候选 + 规格。匹配按数组顺序取第一个命中（具体型号在前、家族在后）。 */
type SpecRule = {
  match: RegExp;
  /** 补全用：该规则对应的**规范模型 id**（用户实际会填的那些） */
  ids: string[];
  vendor: string;
  /** 补全列表里显示的厂商/系列名 */
  family: string;
  spec: ModelSpec;
};

const RULES: SpecRule[] = [
  // ── OpenAI ─────────────────────────────────────────────────────────────
  /* 11-08 补充：GPT-6.1 家族（⛔ 必须排在 /gpt-6/ 之前，否则被旧规则抢走）。
     Sol 09-29 发布、Terra 10-26；两者 1.05M / 128K / 视觉。 */
  { match: /gpt-6\.1/, vendor: "OpenAI", family: "GPT-6.1（Sol / Terra）",
    ids: ["gpt-6.1-sol", "gpt-6.1-terra"],
    spec: { contextWindow: 1_050_000, maxOutputTokens: 128_000, efforts: ["low", "medium", "high", "xhigh", "max"], inputTypes: VIS, outputTypes: OUT_TXT } },
  { match: /gpt-6/, vendor: "OpenAI", family: "GPT-6（Astra）",
    ids: ["gpt-6-astra", "gpt-6"],
    spec: { contextWindow: 1_050_000, maxOutputTokens: 128_000, efforts: ["low", "medium", "high", "xhigh", "max"], inputTypes: VIS, outputTypes: OUT_TXT } },
  { match: /gpt-5[.-]6/, vendor: "OpenAI", family: "GPT-5.6（Sol / Terra / Luna）",
    ids: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6"],
    spec: { contextWindow: 1_050_000, maxOutputTokens: 128_000, efforts: ["low", "medium", "high", "xhigh", "max"], inputTypes: VIS, outputTypes: OUT_TXT } },
  { match: /gpt-5[.-](4|5)/, vendor: "OpenAI", family: "GPT-5.4 / 5.5",
    ids: ["gpt-5.5", "gpt-5.5-instant", "gpt-5.4", "gpt-5.4-mini"],
    spec: { contextWindow: 1_000_000, maxOutputTokens: 128_000, efforts: ["minimal", "low", "medium", "high", "xhigh"], inputTypes: VIS, outputTypes: OUT_TXT } },
  /* ⛔⛔ 11-08 下架清理（用户：「该删的删了，旧的模型参数」）：
     GPT-4 / 4o / 4.1 与 o 系已在官方退役名单（ChatGPT 侧 2026-02-13 停用；
     API 侧 GPT-4 系 2027-01-14 关停、o3 2026-12-11 关停），GPT-5 / 5-mini 同批关停。
     这些规则已删除 —— 旧配置创建时就把参数落库了，不依赖本表；补全也不再推荐死 id。 */

  // ── Anthropic（1M / 128K；Fable 5 与 Opus 4.8 起视觉）────────────────────
  // ⛔ 11-08：claude-sonnet-4-5（官方 2026-11-30 停用）及 Claude 4 更早家族已移除。
  { match: /claude-(fable|mythos)|claude-opus-4[-._]?8|claude-opus-5|claude-sonnet-5/,
    vendor: "Anthropic", family: "Claude 新旗舰（Fable 5 / Opus 4.8 / Opus 5 / Opus 5.5 / Sonnet 5.5）",
    ids: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5", "claude-opus-4-8", "claude-mythos-5", "claude-opus-5"],
    spec: { contextWindow: 1_000_000, maxOutputTokens: 128_000, efforts: [], inputTypes: VIS, outputTypes: OUT_TXT } },

  // ── Google（官方：1,048,576 / 65,536；文本·图像·音频·视频；四档思考）─────
  /* 11-08 补充：Gemini 4 Argon（10-13，Gemini 4 系列首款）——
     1M 上下文 + 长解码（单次输出上限 100 万）、思考 low/medium/high；⛔ 排在 /gemini/ 通用规则前。 */
  { match: /gemini-4/,
    vendor: "Google", family: "Gemini 4（Argon）",
    ids: ["gemini-4-argon"],
    spec: { contextWindow: 1_048_576, maxOutputTokens: 1_000_000, efforts: ["low", "medium", "high"], inputTypes: VISVIDEO, outputTypes: OUT_TXT } },
  { match: /gemini/, vendor: "Google", family: "Gemini 3",
    ids: ["gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite", "gemini-3-pro-preview"],
    spec: { contextWindow: 1_048_576, maxOutputTokens: 65_536, efforts: ["minimal", "low", "medium", "high"], inputTypes: VISVIDEO, outputTypes: OUT_TXT } },

  // ── DeepSeek（1M / 384K）──────────────────────────────────────────────
  // V4.1 Flash（09-10 发布；**10-17 更新为 V4.1-Flash-1017**，官方 API 名仍是 `deepseek-flash`）：
  // 原生多模态（文本+图像）、思考默认开启且强度可选 low/high/max（默认 high）、上下文 1M / 输出最大 384K。
  // ⛔ 官方 2026-09-10 起停用 deepseek-v4-flash-0731 / vision-exp，暂路由到 V4.1（按 V4.1 计价与规格）；
  //   2026-07-24 起 deepseek-chat / deepseek-reasoner 两个老名已下线 —— 下面 ids 只留现行官方名，
  //   旧名仍能被 match 命中（老配置在升级前就已落库，不影响）。
  { match: /deepseek-(v4\.1|flash|v4-flash|chat|reasoner)/, vendor: "DeepSeek", family: "DeepSeek V4.1 Flash（1017，多模态）",
    ids: ["deepseek-flash", "deepseek-v4.1-flash"],
    spec: { contextWindow: 1_048_576, maxOutputTokens: 393_216, efforts: ["low", "high", "max"], inputTypes: VIS, outputTypes: OUT_TXT } },
  // V4-Pro-0813：官方仍在售、独立计费，且官方明确**无视觉**。
  { match: /deepseek/, vendor: "DeepSeek", family: "DeepSeek V4 Pro（纯文本）",
    ids: ["deepseek-v4-pro"],
    spec: { contextWindow: 1_000_000, maxOutputTokens: 393_216, efforts: [], inputTypes: TXT, outputTypes: OUT_TXT } },

  // ── 月之暗面 Kimi（K3 = 1M 且**首次原生视觉**；K3-256k 省额度）──────────
  /* 11-08 补充：Kimi K3.1 Pro（10-24）—— 1M / 输出上限 1M / low·high·max / 图片·视频；
     ⛔ 必须排在 /kimi-k3/ 之前（K3.1 会被旧规则抢先命中）。 */
  { match: /kimi-k3\.1/, vendor: "月之暗面", family: "Kimi K3.1 Pro",
    ids: ["kimi-k3.1-pro", "kimi-k3.1-pro-highspeed"],
    spec: { contextWindow: 1_000_000, maxOutputTokens: 1_048_576, efforts: ["low", "high", "max"], inputTypes: VIS, outputTypes: OUT_TXT } },
  { match: /kimi-k3[-_.]?256k|k3[-_.]256k/, vendor: "月之暗面", family: "Kimi K3（256K 档）",
    ids: ["kimi-k3-256k"],
    spec: { contextWindow: 262_144, maxOutputTokens: 131_072, efforts: ["low", "high", "max"], inputTypes: VIS, outputTypes: OUT_TXT } },
  { match: /kimi-k3|(^|[^a-z0-9])k3(-|$)/, vendor: "月之暗面", family: "Kimi K3",
    ids: ["kimi-k3", "kimi-k3-max"],
    spec: { contextWindow: 1_000_000, maxOutputTokens: 131_072, efforts: ["low", "high", "max"], inputTypes: VIS, outputTypes: OUT_TXT } },
  /* ⛔ 11-08：Kimi K2 与更早的 moonshot-v1 系列已下架（K3 起接替）⇒ 旧规则删除。 */

  // ── 智谱 GLM（5.3 纯文本；**只有 5.3-Flash 是原生多模态**）──────────────
  { match: /glm-5\.3[-_.]?flash/, vendor: "智谱 AI", family: "GLM-5.3-Flash（多模态）",
    ids: ["glm-5.3-flash"],
    spec: { contextWindow: 1_048_576, maxOutputTokens: 131_072, efforts: [], inputTypes: VIS, outputTypes: OUT_TXT } },
  { match: /glm-5v|glm-4v|glm-5\.\dv/, vendor: "智谱 AI", family: "GLM 视觉版",
    ids: ["glm-5v-turbo"],
    spec: { contextWindow: 131_072, maxOutputTokens: 32_768, efforts: [], inputTypes: VIS, outputTypes: OUT_TXT } },
  { match: /glm-5\.[23]|glm-5\b/, vendor: "智谱 AI", family: "GLM-5.3 / 5.2",
    ids: ["glm-5.3", "glm-5.2", "glm-5-turbo"],
    spec: { contextWindow: 1_000_000, maxOutputTokens: 131_072, efforts: [], inputTypes: TXT, outputTypes: OUT_TXT } },
  /* ⛔ 11-08：GLM-4.x（4.7 / 4.6 / 4-Plus）已下架，旧规则删除。 */

  // ── 通义千问（Qwen3.8-Max 图+视频；长文 qwen-long 10M）──────────────────
  { match: /qwen3?[.\-]?(vl|omni)/, vendor: "阿里", family: "Qwen 视觉 / 全模态",
    ids: ["qwen3-vl-plus", "qwen3-vl-max", "qwen3.5-omni-plus"],
    spec: { contextWindow: 262_144, maxOutputTokens: 32_768, efforts: [], inputTypes: VISVIDEO, outputTypes: OUT_TXT } },
  { match: /qwen-long/, vendor: "阿里", family: "Qwen-Long",
    ids: ["qwen-long"],
    spec: { contextWindow: 10_485_760, maxOutputTokens: 32_768, efforts: [], inputTypes: TXT, outputTypes: OUT_TXT } },
  { match: /qwen3\.[5-9]|qwen3-max/, vendor: "阿里", family: "Qwen3.8（Max / Flash）",
    ids: ["qwen3.8-max", "qwen3.8-flash-next", "qwen3.5-397b-a17b"],
    spec: { contextWindow: 1_000_000, maxOutputTokens: 131_072, efforts: [], inputTypes: VISVIDEO, outputTypes: OUT_TXT } },
  { match: /qwen/, vendor: "阿里", family: "Qwen（早期版本）",
    ids: ["qwen-max", "qwen-plus"],
    spec: { contextWindow: 131_072, maxOutputTokens: 32_768, efforts: [], inputTypes: TXT, outputTypes: OUT_TXT } },

  // ── 豆包 / 火山方舟（视觉为国内第一梯队；Seed 2.0）─────────────────────
  /* 11-08 补充：Seed 2.1 Pro（火山方舟模型列表：1,048,576 / 256K / 文本+图像）；
     ⛔ 排在旧规则前面（/doubao[-_.]?2/ 会先命中 2.1）。 */
  { match: /doubao-seed-2[.-]1|seed-2[.-]1/, vendor: "字节跳动", family: "豆包 Seed 2.1 Pro（视觉）",
    ids: ["doubao-seed-2.1-pro", "doubao-seed-2-1-pro-260915"],
    spec: { contextWindow: 1_048_576, maxOutputTokens: 262_144, efforts: [], inputTypes: VIS, outputTypes: OUT_TXT } },
  { match: /doubao-seed|doubao[-_.]?2|seed-2/, vendor: "字节跳动", family: "豆包 Seed 2.0（视觉）",
    ids: ["doubao-seed-2.0-pro", "doubao-seed-2.0", "doubao-seed-code"],
    spec: { contextWindow: 262_144, maxOutputTokens: 32_768, efforts: [], inputTypes: VIS, outputTypes: OUT_TXT } },
  /* ⛔ 11-08：豆包 1.x（1.8 / 1.6 / pro-256k）已下架，旧规则删除。 */

  // ── 商汤日日新（128K；图文视频输入；思考模式为 on/off 而非离散档位）─────
  { match: /sensenova|日日新|sensechat/, vendor: "商汤", family: "日日新 SenseNova 6.5",
    ids: ["sensenova-v6.5-pro", "sensenova-v6.5-turbo"],
    spec: { contextWindow: 131_072, maxOutputTokens: 32_768, efforts: [], inputTypes: VISVIDEO, outputTypes: OUT_TXT } },

  // ── MiniMax（M3 原生图像+视频；H 系为视频生成线）────────────────────────
  /* 11-08 补充：M3.1 Flash（10-19，多模态编程 / 1M / 文本·图像·视频 / 五档思考）。
     官方未公布输出上限 ⇒ ⛔ 不填 maxOutputTokens（拿不准不编）。排在 /minimax-m3|m3/ 前。 */
  { match: /minimax-m3\.1|m3\.1/, vendor: "MiniMax", family: "MiniMax M3.1 Flash（多模态）",
    ids: ["minimax-m3.1-flash"],
    spec: { contextWindow: 1_048_576, efforts: ["low", "medium", "high", "xhigh", "max"], inputTypes: VISVIDEO, outputTypes: OUT_TXT } },
  { match: /minimax-m3|(^|[^a-z0-9])m3(-|$)/, vendor: "MiniMax", family: "MiniMax M3",
    ids: ["minimax-m3"],
    spec: { contextWindow: 1_048_576, maxOutputTokens: 131_072, efforts: [], inputTypes: VISVIDEO, outputTypes: OUT_TXT } },
  /* ⛔ 11-08：M2.7 / abab 已下架（M3 起接替）—— 规则整条删除，不再兜底匹配。 */

  // ── 小米 MiMo / Meta Muse（1M；全模态）─────────────────────────────────
  { match: /mimo/, vendor: "小米", family: "MiMo-V2.5（全模态）",
    ids: ["mimo-v2.5"],
    spec: { contextWindow: 1_048_576, maxOutputTokens: 131_072, efforts: [], inputTypes: VISVIDEO, outputTypes: OUT_TXT } },
  { match: /muse-spark|muse\b/, vendor: "Meta", family: "Muse Spark",
    ids: ["muse-spark-1.2"],
    spec: { contextWindow: 1_000_000, maxOutputTokens: 131_072, efforts: [], inputTypes: VISVIDEO, outputTypes: OUT_TXT } },

  // ── 独立视觉版型号（qwen-vl / glm-4v / doubao-vision / kimi-vl 等，放最后兜底）──
  { match: /-vl\b|-vision\b/, vendor: "通用", family: "视觉专用型号",
    ids: [],
    spec: { contextWindow: 131_072, maxOutputTokens: 32_768, efforts: [], inputTypes: VIS, outputTypes: OUT_TXT } },
];

/** 按模型 id 匹配已知规格；未命中返回 null（调用方用用户填写值兜底） */
export function matchModelSpec(modelId: string): ModelSpec | null {
  const id = (modelId || "").toLowerCase();
  // 外部规则优先：userData/model-specs.json（数据与代码分离，更新模型数据无需改代码重新构建）
  for (const rule of externalRules) if (rule.match.test(id)) return rule.spec;
  for (const rule of RULES) if (rule.match.test(id)) return rule.spec;
  return null;
}

// ── 补全候选（模型 ID 输入框 / 下拉用）────────────────────────────
export type ModelCatalogEntry = {
  id: string;
  vendor: string;
  family: string;
  contextWindow: number;
  maxOutputTokens?: number;
  /** 是否支持图片输入（视觉模型）—— 新手最需要一眼看到的那个标志 */
  vision: boolean;
  video: boolean;
};

/** 令牌数格式化（1_050_000 → "1.05M"，262_144 → "256K"）。 */
export function formatTokenCount(n: number | undefined | null): string {
  if (!n || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : Number(m.toFixed(2))}M`;
  }
  return `${Math.round(n / 1000)}K`;
}

function toEntry(id: string, rule: SpecRule): ModelCatalogEntry {
  const inputs = rule.spec.inputTypes ?? TXT;
  return {
    id, vendor: rule.vendor, family: rule.family,
    contextWindow: rule.spec.contextWindow,
    maxOutputTokens: rule.spec.maxOutputTokens,
    vision: inputs.includes("image"),
    video: inputs.includes("video"),
  };
}

/** 全部内置候选（顺序 = 规则顺序 = 新旗舰在前）。 */
export const MODEL_CATALOG: ModelCatalogEntry[] = RULES.flatMap((rule) => rule.ids.map((id) => toEntry(id, rule)));

/**
 * 模型 ID 补全：**完全相等 → 前缀命中 → 子串/厂商/系列命中**，同级内保持表内顺序
 * （表里新旗舰在前，所以打 "deepseek" 时先看到 V4.1 Flash（deepseek-flash），再是 v4-pro 与旧 chat）。
 * 空输入返回前 `limit` 条（新手上来先看到当前主流型号）。
 */
export function suggestModelIds(input: string, limit = 8): ModelCatalogEntry[] {
  const q = (input || "").trim().toLowerCase();
  if (!q) return MODEL_CATALOG.slice(0, limit);
  const exact: ModelCatalogEntry[] = [];
  const prefix: ModelCatalogEntry[] = [];
  const sub: ModelCatalogEntry[] = [];
  for (const entry of MODEL_CATALOG) {
    const id = entry.id.toLowerCase();
    if (id === q) exact.push(entry);
    else if (id.startsWith(q)) prefix.push(entry);
    else if (id.includes(q) || entry.vendor.toLowerCase().includes(q) || entry.family.toLowerCase().includes(q)) sub.push(entry);
  }
  return [...exact, ...prefix, ...sub].slice(0, limit);
}

// ── 外部规则加载口子 ──────────────────────────────────────────
// 文件：userData/model-specs.json，格式：
// [ { "match": "gpt-6", "contextWindow": 1000000, "maxOutputTokens": 200000,
//     "efforts": ["low","medium","high"], "inputTypes": ["text","image"], "outputTypes": ["text"] } ]
// match 为正则字符串（不区分大小写）；外部规则优先于内置表。更新数据后重启应用生效。

export type ExternalSpecRule = { match: string; contextWindow: number; maxOutputTokens?: number; efforts?: string[]; inputTypes?: string[]; outputTypes?: string[] };

let externalRules: { match: RegExp; spec: ModelSpec }[] = [];

/** 把外部 JSON 规则装载进匹配链（外部优先）。非法条目跳过。 */
export function setExternalSpecs(rules: ExternalSpecRule[]) {
  externalRules = (Array.isArray(rules) ? rules : []).flatMap((rule) => {
    try {
      if (!rule?.match || !(rule.contextWindow > 0)) return [];
      return [{ match: new RegExp(rule.match, "i"), spec: {
        contextWindow: rule.contextWindow,
        maxOutputTokens: rule.maxOutputTokens,
        efforts: rule.efforts ?? [],
        inputTypes: rule.inputTypes as ModelSpec["inputTypes"],
        outputTypes: rule.outputTypes as ModelSpec["outputTypes"],
      } }];
    } catch { return []; }
  });
}

/** 从 userData/model-specs.json 装载外部规则（启动时调用一次；文件不存在则静默跳过） */
export async function loadExternalSpecs() {
  try {
    const data = await window.codex.readModelSpecs();
    if (Array.isArray(data)) setExternalSpecs(data as ExternalSpecRule[]);
  } catch { /* IPC 不可用/文件不存在：内置表兜底 */ }
}
