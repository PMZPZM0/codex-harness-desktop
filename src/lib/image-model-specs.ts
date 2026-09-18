/**
 * 生图模型内置规格表（09-18 用户：「这里把目前市面上的热门生图模型内置一下参数，
 * 跟模型配置里面一样，支持 tab 补全」）。
 *
 * 与聊天模型的 `model-specs.ts` 同思路（内置表 + Tab 补全 + 参数一眼可见），
 * 但生图的「参数」完全不是上下文/输出那一套，而是三类：
 *   ① **尺寸**：常用可传值（`size: "1024x1024"`）、分辨率档（部分模型按 `"2K"/"4K"` 传）、
 *      自定义 WxH 的规则（步长 / 单边上限 / 总像素区间 / 比例上限）；
 *   ② **改图**：能否带参考图（走 `/images/edits`），最多几张 —— 决定「能不能改图/保角色一致」；
 *   ③ **质量档**：`quality` 可传值（跨代差异很大：2.5 代多出 xhigh/max，2 代只有 low→high）。
 *
 * ⛔ 收录纪律（同 `model-specs.ts`）：**拿不准就不写**。这里每个数字都取自公开资料
 * （OpenAI Image API 文档 / Google、ByteDance、BFL 的模型页 / 2026-08 的第三方对比页），
 * 查不到就留空 —— 留空的字段在界面上不显示任何徽标，**不会编一个数字骗用户**。
 * 另：不同**中转网关**对同一模型接受的写法可能不同（有的只认 `size: "2K"`、有的只认像素、
 * 有的两边都收），本表记的是「模型官方口径」；网关差异由 harness-media 的 `warning` 字段
 * 与插件里的「检测」按钮暴露，不要在这里猜。
 */

export type ImageModelSpec = {
  /** 可直接作为 `size` 传给 /images/generations 的常用像素尺寸 */
  sizes?: string[];
  /** 分辨率档（按档传参的模型：如 "2K"/"4K"，与 sizes 可能同时存在） */
  tiers?: string[];
  /** 自定义 WIDTHxHEIGHT 的规则（官方口径） */
  custom?: { step: number; maxSide: number; minPixels: number; maxPixels: number; maxRatio?: number };
  /** 单边像素上限（没有 sizes/custom 时用于显示「≤2K」这类徽标） */
  maxSide?: number;
  /** 支持的宽高比个数（部分网关按比例传参） */
  ratioCount?: number;
  /** 参考图（改图 / images/edits）张数上限；**0 = 明确只支持文生图**；缺省 = 未查到 */
  maxRefs?: number;
  /** `quality` 可传值 */
  qualities?: string[];
  /** 单次最多生成几张（n 的上限） */
  maxBatch?: number;
  /** 一句话定位：写「什么时候选它」，不写营销词 */
  note?: string;
};

export type ImageModelEntry = { id: string; vendor: string; family: string; spec: ImageModelSpec };

type ImageRule = { match: RegExp; vendor: string; family: string; ids: string[]; spec: ImageModelSpec };

/** OpenAI 系的尺寸规则（GPT Image 2 / 2.5 完全一致，逐字来自官方 Image API 文档）：
 *  单边必须是 16 的倍数、长边/短边 ≤ 3:1、每边 ≤ 3840、总像素 655,360–8,294,400；
 *  总像素 > 3,686,400（2560×1440）官方标记为**实验性**。 */
const OPENAI_CUSTOM = { step: 16, maxSide: 3840, minPixels: 655_360, maxPixels: 8_294_400, maxRatio: 3 };
const OPENAI_SIZES = ["1024x1024", "1536x1024", "1024x1536"];

const RULES: ImageRule[] = [
  // ── OpenAI GPT Image 2.5（Flare / Sunburst，2026 年秋季）────────────────
  { match: /gpt-image-?2[.\-]5/, vendor: "OpenAI", family: "GPT Image 2.5",
    ids: ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"],
    spec: { sizes: OPENAI_SIZES, custom: OPENAI_CUSTOM, maxSide: 3840, maxRefs: 16,
      qualities: ["low", "medium", "high", "xhigh", "max"], maxBatch: 10,
      note: "文字 / 排版 / 复杂构图最强；质量档比 2 代多 xhigh·max（更高档更慢，不保证更好）" } },
  // ── OpenAI GPT Image 2（2026-04，含 dated 快照 gpt-image-2-2026-04-21）──
  { match: /gpt-image-?2(?!\.[\d])|gpt-image-?2-\d{4}/, vendor: "OpenAI", family: "GPT Image 2",
    ids: ["gpt-image-2"],
    spec: { sizes: OPENAI_SIZES, custom: OPENAI_CUSTOM, maxSide: 3840, maxRefs: 16,
      qualities: ["low", "medium", "high"], maxBatch: 10,
      note: "会先“思考”再画：听长指令、图内文字准；代价是比蒸馏模型慢" } },
  // ── Google Nano Banana（Gemini 图像线）────────────────────────────────
  { match: /nano-?banana-?pro|gemini-3-?(pro|ultra)-image/, vendor: "Google", family: "Nano Banana Pro",
    ids: ["nano-banana-pro"], spec: { tiers: ["1K", "2K", "4K"], maxSide: 4096, ratioCount: 10,
      note: "画质与构图天花板、原生 4K（图本身就是主角时用它）" } },
  { match: /nano-?banana|gemini-3\.1-flash-image|gemini-image/, vendor: "Google", family: "Nano Banana 2",
    ids: ["nano-banana-2"], spec: { tiers: ["1K", "2K", "4K"], maxSide: 4096, ratioCount: 10,
      note: "最快（约 1–3 秒）且便宜，日常默认档；支持多比例" } },
  // ── Google Imagen 4 ────────────────────────────────────────────────
  { match: /imagen-?4|imagen4/, vendor: "Google", family: "Imagen 4",
    ids: ["imagen-4-ultra", "imagen-4-fast"], spec: { tiers: ["1K", "2K"], maxSide: 2048,
      note: "照片级真实感；Ultra 画质最高、Fast 便宜快（约 $0.02/张）" } },
  // ── Black Forest Labs FLUX.2 ───────────────────────────────────────
  { match: /flux\.?2|flux-?2/, vendor: "Black Forest Labs", family: "FLUX.2",
    ids: ["flux-2-pro", "flux-2-max", "flux-2-flex", "flux-2-dev", "flux-2-klein"],
    spec: { custom: { step: 16, maxSide: 2048, minPixels: 4096, maxPixels: 4_194_304 },
      maxSide: 2048, ratioCount: 7,
      note: "1–4MP、边长须为 16 的倍数；pro 商用调性稳定，dev/klein 是开放权重（多数网关无此档）" } },
  // ── 字节跳动 Seedream（5 代与 4.5；参考图能力国内最强）─────────────────
  { match: /seedream-?5[-_.]?pro|seedream-v5/, vendor: "字节跳动", family: "Seedream 5 Pro",
    ids: ["seedream-5-pro"], spec: { tiers: ["1K", "2K"], maxSide: 2048, maxRefs: 10,
      note: "多参考图合成（≤10 张）+ 中文/多语言字体" } },
  { match: /seedream-?5[-_.]?lite/, vendor: "字节跳动", family: "Seedream 5 Lite",
    ids: ["seedream-5-lite"], spec: { tiers: ["2K", "3K"], maxSide: 3072, maxRefs: 14,
      note: "最便宜的多参考（≤14 张），迭代草稿用它" } },
  { match: /seedream/, vendor: "字节跳动", family: "Seedream 4.5",
    ids: ["seedream-4.5", "seedream-4-5", "seedream-v4.5"],
    spec: { tiers: ["2K", "4K"], sizes: ["1024x1024", "1536x1536", "2048x2048", "1024x1536", "1536x1024", "1024x2048"],
      custom: { step: 16, maxSide: 4096, minPixels: 1_048_576, maxPixels: 16_777_216 }, maxSide: 4096,
      ratioCount: 11, maxRefs: 14, maxBatch: 15,
      note: "2K/4K 或 custom（单边 1024–4096）、11 种比例；参考图 ≤14、单次 ≤15 张；注意 4.5 不支持 1K" } },
  // ── 阿里通义：Qwen-Image / WAN ──────────────────────────────────────
  { match: /qwen-?image|wanx/, vendor: "阿里通义", family: "Qwen-Image",
    ids: ["qwen-image-3.0-pro", "qwen-image"], spec: { sizes: ["512x512", "1024x1024", "2048x2048"],
      maxSide: 2048, note: "批量草稿的地板价（约 $0.003/张）" } },
  { match: /wan-?2\.7/, vendor: "阿里通义", family: "WAN 2.7",
    ids: ["wan-2.7"], spec: { tiers: ["1K", "2K"], maxSide: 2048, note: "便宜好用的日常档" } },
  // ── xAI ────────────────────────────────────────────────────────────
  { match: /grok-?imagine/, vendor: "xAI", family: "Grok Imagine",
    ids: ["grok-imagine"], spec: { note: "速度与价格冠军：先拿它把想法试出来再上旗舰" } },
  // ── Ideogram / Recraft（图内文字与设计资产）─────────────────────────
  { match: /ideogram/, vendor: "Ideogram", family: "Ideogram V3",
    ids: ["ideogram-v3-turbo", "ideogram-v3"], spec: { maxSide: 1024,
      note: "图内文字排版最稳（海报 / logo / 版式）" } },
  { match: /recraft/, vendor: "Recraft", family: "Recraft V4",
    ids: ["recraft-v4"], spec: { maxSide: 2048, note: "品牌与设计资产、矢量风格输出" } },
  // ── 开放权重线（多数中转网关没有，自托管时有）────────────────────────
  { match: /hunyuan-?image/, vendor: "腾讯", family: "Hunyuan Image 3",
    ids: ["hunyuan-image-3"], spec: { maxSide: 2048, note: "开源、中英双语提示词" } },
  { match: /stable-?diffusion-?4|sd-?4/, vendor: "Stability", family: "Stable Diffusion 4",
    ids: ["stable-diffusion-4"], spec: { maxSide: 2048, note: "开放生态（ControlNet / LoRA 底座）" } },
  // ── 兜底：老一代 gpt-image（1 代）/ 未知 gpt-image 变体 ───────────────
  { match: /gpt-image/, vendor: "OpenAI", family: "GPT Image",
    ids: ["gpt-image-1"], spec: { sizes: OPENAI_SIZES, maxRefs: 16,
      qualities: ["low", "medium", "high"], note: "上一代；新项目建议换 2 代" } },
];

/** 按模型 id 匹配生图规格；未命中返回 null（调用方用运行时行为兜底）。 */
export function matchImageSpec(modelId: string): ImageModelSpec | null {
  const id = (modelId || "").toLowerCase();
  for (const rule of RULES) if (rule.match.test(id)) return rule.spec;
  return null;
}

/** 全部内置候选（顺序 = 规则顺序 = 热门在前，打空前的新手看到的就是这些）。 */
export const IMAGE_MODEL_CATALOG: ImageModelEntry[] = RULES.flatMap((rule) =>
  rule.ids.map((id) => ({ id, vendor: rule.vendor, family: rule.family, spec: rule.spec })));

/** 补全匹配语义与 `suggestModelIds` 保持一致：完全相等 → 前缀 → 子串/厂商/系列。 */
export function suggestImageModelIds(input: string, limit = 7): ImageModelEntry[] {
  const q = (input || "").trim().toLowerCase();
  if (!q) return IMAGE_MODEL_CATALOG.slice(0, limit);
  const exact: ImageModelEntry[] = [], prefix: ImageModelEntry[] = [], sub: ImageModelEntry[] = [];
  for (const entry of IMAGE_MODEL_CATALOG) {
    const id = entry.id.toLowerCase();
    if (id === q) exact.push(entry);
    else if (id.startsWith(q)) prefix.push(entry);
    else if (id.includes(q) || entry.vendor.toLowerCase().includes(q) || entry.family.toLowerCase().includes(q)) sub.push(entry);
  }
  return [...exact, ...prefix, ...sub].slice(0, limit);
}

/** 补全候选项（内置表条目，或网关探测到的 id）。 */
export type ImageModelRow = { id: string; vendor?: string; family?: string; spec?: ImageModelSpec; probed?: boolean };

/**
 * 候选行 = 内置表条目 + 网关探测到的 id（探测项也过一遍规格表，命中就带徽标 ——
 * 很多网关的内部接入点名里带着官方型号）。
 *
 * ⛔ 为什么抽成**纯函数**而不是写在组件里：组件内的分支只能用「文本存在性」守卫，
 * 那种守卫挡不住 `if (false)`（09-18 反证实测：把生图分支改成死代码，守卫照样绿）。
 * 放这里就能被预检 **直跑真代码** 断言 —— 变异必红。
 */
export function buildImageModelRows(input: string, extraIds: string[] = [], limit = 7): ImageModelRow[] {
  const builtin: ImageModelRow[] = suggestImageModelIds(input, limit)
    .map((entry) => ({ id: entry.id, vendor: entry.vendor, family: entry.family, spec: entry.spec }));
  const known = new Set(builtin.map((entry) => entry.id.toLowerCase()));
  const q = (input || "").trim().toLowerCase();
  const probed: ImageModelRow[] = (extraIds ?? [])
    .filter((id) => id && !known.has(id.toLowerCase()))
    .slice(0, 6)
    .map((id) => ({ id, probed: true, spec: matchImageSpec(id) ?? undefined }))
    // 前缀与已输入内容一致的排前面（用户在打 seedream 时先看到自家网关的 seedream-* 接入点）
    .sort((a, b) => Number(b.id.toLowerCase().startsWith(q)) - Number(a.id.toLowerCase().startsWith(q)));
  return [...builtin, ...probed];
}

/** 单边像素 →「1K / 2K / 4K」档位文案（用于徽标，避免把 3840 这种数字糊在脸上）。
 *  ⛔ 分档按**大众口径**而不是 DCI 的 4096：3840（4K UHD 宽）就得显示 4K ——
 *  按 4096 划档会把 3840 显示成「2.5K」，用户看到 4K 屏却写着 2.5K 只会以为应用算错。 */
export function sideTierLabel(side: number | undefined): string {
  if (!side || !Number.isFinite(side) || side <= 0) return "";
  if (side >= 3840) return "4K";
  if (side >= 3072) return "3K";
  if (side >= 2560) return "2.5K";
  if (side >= 2048) return "2K";
  if (side >= 1024) return "1K";
  return `${side}px`;
}

/** 候选行里的短徽标（每行最多 3 个，一眼能扫）。 */
export function imageSpecBadges(spec: ImageModelSpec | undefined | null): { text: string; title: string }[] {
  if (!spec) return [];
  const out: { text: string; title: string }[] = [];
  if (spec.custom) {
    const tier = sideTierLabel(spec.custom.maxSide);
    out.push({ text: `自定义≤${tier}`, title: `支持自定义宽高：${spec.custom.step} 的倍数、单边 ≤${spec.custom.maxSide}${spec.custom.maxRatio ? `、长短边比 ≤${spec.custom.maxRatio}:1` : ""}、总像素 ${spec.custom.minPixels}–${spec.custom.maxPixels}` });
  } else if (spec.sizes?.length) {
    out.push({ text: spec.sizes.length > 1 ? `${spec.sizes[0]} 等 ${spec.sizes.length} 种` : spec.sizes[0], title: `常用尺寸：${spec.sizes.join(" / ")}` });
  } else if (spec.tiers?.length) {
    out.push({ text: `${spec.tiers.join("/")} 档`, title: `分辨率档：${spec.tiers.join(" / ")}` });
  } else if (spec.maxSide) {
    out.push({ text: `≤${sideTierLabel(spec.maxSide)}`, title: `单边上限约 ${spec.maxSide}px` });
  }
  if (spec.ratioCount) out.push({ text: `${spec.ratioCount} 种比例`, title: `支持 ${spec.ratioCount} 种宽高比` });
  if (spec.maxRefs) out.push({ text: `改图≤${spec.maxRefs} 张`, title: `可带 ${spec.maxRefs} 张参考图（走 images/edits）` });
  else if (spec.maxRefs === 0) out.push({ text: "仅文生图", title: "不支持参考图/改图" });
  if (spec.qualities?.length) {
    out.push({ text: `质量 ${spec.qualities[0]}→${spec.qualities[spec.qualities.length - 1]}`, title: `quality 可传：${spec.qualities.join(" / ")}` });
  }
  return out.slice(0, 4);
}

/** 字段下方那行参数说明（选中/输入命中内置表时显示）。信息按「能不能改图 / 多大 / 什么质量档」排序。 */
export function imageSpecHint(spec: ImageModelSpec | undefined | null): string[] {
  if (!spec) return [];
  const lines: string[] = [];
  const sizeBits: string[] = [];
  if (spec.sizes?.length) sizeBits.push(spec.sizes.slice(0, 4).join(" / ") + (spec.sizes.length > 4 ? " …" : ""));
  if (spec.tiers?.length) sizeBits.push(`${spec.tiers.join("/")} 档`);
  if (spec.custom) sizeBits.push(`自定义（${spec.custom.step} 的倍数、单边 ≤${spec.custom.maxSide}）`);
  if (sizeBits.length) lines.push(`尺寸：${sizeBits.join("；")}`);
  else if (spec.maxSide) lines.push(`尺寸：单边 ≤${spec.maxSide}px`);

  const capBits: string[] = [];
  if (spec.maxRefs) capBits.push(`改图 ≤${spec.maxRefs} 张参考图`);
  else if (spec.maxRefs === 0) capBits.push("仅文生图");
  if (spec.qualities?.length) capBits.push(`quality：${spec.qualities.join("/")}`);
  if (spec.maxBatch) capBits.push(`单次 ≤${spec.maxBatch} 张`);
  if (spec.ratioCount) capBits.push(`${spec.ratioCount} 种比例`);
  if (capBits.length) lines.push(capBits.join(" · "));

  if (spec.note) lines.push(spec.note);
  return lines;
}
