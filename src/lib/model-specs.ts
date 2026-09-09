/**
 * 已知模型规格表：按模型 id 自动匹配 推荐上下文窗口 / 最大输出 / 思考档位 / 输入输出模态。
 * 数据基于各官方文档公开参数（2026-09 整理）；匹配按顺序取第一个命中（具体型号在前、家族在后）。
 * 用途：探测/添加模型时自动回填推荐值；用户手动改过的值以用户为准。
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

const RULES: { match: RegExp; spec: ModelSpec }[] = [
  // ── OpenAI GPT-6（1M 上下文 / 128K 输出，推理档，多模态输入）──
  { match: /gpt-6/, spec: { contextWindow: 1_000_000, maxOutputTokens: 128_000, efforts: ["minimal", "low", "medium", "high", "xhigh"], inputTypes: VIS, outputTypes: TXT } },
  // ── 视觉特例型号（独立视觉版：qwen-vl / glm-4v / deepseek-vl / doubao-vision / kimi-vl 等）──
  { match: /-vl\b|-vision\b|glm-4v/, spec: { contextWindow: 131_072, maxOutputTokens: 32_768, efforts: [], inputTypes: VIS, outputTypes: TXT } },
  // ── OpenAI GPT-5.x（400k 上下文 / 128k 输出，推理档 minimal..xhigh，多模态输入）──
  { match: /gpt-5\.\d/, spec: { contextWindow: 400_000, maxOutputTokens: 128_000, efforts: ["minimal", "low", "medium", "high", "xhigh"], inputTypes: VIS, outputTypes: TXT } },
  { match: /gpt-5/, spec: { contextWindow: 400_000, maxOutputTokens: 128_000, efforts: ["minimal", "low", "medium", "high"], inputTypes: VIS, outputTypes: TXT } },
  // ── OpenAI o 系推理（o3/o4-mini 支持图片分析）──
  { match: /(^|[^a-z0-9])o[34](-|$|mini|pro)/, spec: { contextWindow: 200_000, maxOutputTokens: 100_000, efforts: ["low", "medium", "high"], inputTypes: VIS, outputTypes: TXT } },
  // ── OpenAI GPT-4.1 / 4o（视觉）/ 4 系（纯文本）──
  { match: /gpt-4\.1/, spec: { contextWindow: 1_000_000, maxOutputTokens: 32_768, efforts: [], inputTypes: VIS, outputTypes: TXT } },
  { match: /gpt-4o/, spec: { contextWindow: 128_000, maxOutputTokens: 16_384, efforts: [], inputTypes: VIS, outputTypes: TXT } },
  { match: /gpt-4/, spec: { contextWindow: 128_000, maxOutputTokens: 8_192, efforts: [], inputTypes: TXT, outputTypes: TXT } },
  // ── DeepSeek（官方 pricing：上下文 1M，最大输出 384K；chat=非思考 reasoner=推理；纯文本）──
  { match: /deepseek/, spec: { contextWindow: 1_000_000, maxOutputTokens: 393_216, efforts: [], inputTypes: TXT, outputTypes: TXT } },
  // ── 智谱 GLM（官方文档：GLM-5.2/5.3 = 1M 上下文 / 128K 输出；5.1 及更早 200K；文本系）──
  { match: /glm-5\.[23]/, spec: { contextWindow: 1_000_000, maxOutputTokens: 131_072, efforts: [], inputTypes: TXT, outputTypes: TXT } },
  { match: /glm/, spec: { contextWindow: 204_800, maxOutputTokens: 131_072, efforts: [], inputTypes: TXT, outputTypes: TXT } },
  // ── Kimi（官方：kimi-k3 = 1M；k2-0905/turbo = 256K；其余 128K；文本系）──
  { match: /kimi-k3/, spec: { contextWindow: 1_048_576, maxOutputTokens: 32_768, efforts: [], inputTypes: TXT, outputTypes: TXT } },
  { match: /kimi-k2-0905|k2-turbo|kimi-k2\.5/, spec: { contextWindow: 262_144, maxOutputTokens: 32_768, efforts: [], inputTypes: TXT, outputTypes: TXT } },
  { match: /kimi|moonshot/, spec: { contextWindow: 131_072, maxOutputTokens: 16_384, efforts: [], inputTypes: TXT, outputTypes: TXT } },
  // ── 通义千问（阿里云百炼：qwen3.8-max / 3.7-plus = 1M / 输出 131K；qwen3-max = 256K/64K；qwen-long = 10M；文本系）──
  { match: /qwen-long/, spec: { contextWindow: 10_485_760, maxOutputTokens: 32_768, efforts: [], inputTypes: TXT, outputTypes: TXT } },
  { match: /qwen3\.[78]/, spec: { contextWindow: 1_000_000, maxOutputTokens: 131_072, efforts: [], inputTypes: TXT, outputTypes: TXT } },
  { match: /qwen3-max/, spec: { contextWindow: 262_144, maxOutputTokens: 65_536, efforts: [], inputTypes: TXT, outputTypes: TXT } },
  { match: /qwen/, spec: { contextWindow: 131_072, maxOutputTokens: 32_768, efforts: [], inputTypes: TXT, outputTypes: TXT } },
  // ── 豆包（火山方舟：doubao 1.6/1.8 = 256K；文本系；Seed-Code 系 = 256K 视觉编程模型）──
  { match: /doubao-seed-(code|2\.0-code)/, spec: { contextWindow: 262_144, maxOutputTokens: 32_768, efforts: [], inputTypes: VIS, outputTypes: TXT } },
  { match: /doubao/, spec: { contextWindow: 262_144, maxOutputTokens: 32_768, efforts: [], inputTypes: TXT, outputTypes: TXT } },
  // ── MiniMax（官方：M3 = 1M / 128K 输出，原生图像+视频输入；M2 = 200K / 128K，文本）──
  { match: /minimax-m3|m3/, spec: { contextWindow: 1_048_576, maxOutputTokens: 131_072, efforts: [], inputTypes: VISVIDEO, outputTypes: TXT } },
  { match: /minimax|abab/, spec: { contextWindow: 204_800, maxOutputTokens: 131_072, efforts: [], inputTypes: TXT, outputTypes: TXT } },
  // ── Claude（200K / 64K 输出，3.0+ 支持图片输入）──
  { match: /claude/, spec: { contextWindow: 200_000, maxOutputTokens: 64_000, efforts: [], inputTypes: VIS, outputTypes: TXT } },
  // ── Gemini（1M / 64K 输出，原生多模态）──
  { match: /gemini/, spec: { contextWindow: 1_000_000, maxOutputTokens: 65_536, efforts: [], inputTypes: VIS, outputTypes: TXT } },
];

/** 按模型 id 匹配已知规格；未命中返回 null（调用方用用户填写值兜底） */
export function matchModelSpec(modelId: string): ModelSpec | null {
  const id = (modelId || "").toLowerCase();
  // 外部规则优先：userData/model-specs.json（数据与代码分离，更新模型数据无需改代码重新构建）
  for (const rule of externalRules) if (rule.match.test(id)) return rule.spec;
  for (const rule of RULES) if (rule.match.test(id)) return rule.spec;
  return null;
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
