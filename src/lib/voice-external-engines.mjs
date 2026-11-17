/**
 * 开源语音引擎目录（11-16 用户令）
 *
 * 用户口径：把 Voicebox / OmniVoice Studio / GPT-SoVITS / CosyVoice 3 / Qwen3-TTS /
 * Chatterbox / TTS-WebUI / Zonos 做成「语音模型」界面的卡片，按需下载；默认只展示 4 张（推荐），其余「更多展开 / 收起」。
 *
 * ⛔ 这里是**单一真相源**：主进程安装器与渲染层卡片都读这一份，别在两边各抄一份清单。
 * ⛔ 体积/显存/许可是**展示用的事实**，不参与安装校验；安装只认 install 里的 url/bytes。
 * ⛔ demand / hardware 也是展示用：demand 为 high 的引擎（Zonos / Voicebox）
 *    在 8GB 显卡上会 OOM 或跑不动，卡片必须打「需高配」并在详情写清显存/磁盘门槛。
 * ⛔⛔ 11-17 用户令：**非商用权重的引擎一律不进目录**（IndexTTS2 2.0 / F5-TTS / Fish Speech 已移除）。
 *    新增引擎前先核对权重许可 —— 不可商用的不要加进来。
 */

/** 卡片分类（顺序即界面 chips 顺序）。 */
export const VOICE_EXTERNAL_CATEGORIES = [
  { id: "all", name: "全部" },
  { id: "clone", name: "中文克隆" },
  { id: "dialect", name: "方言多语" },
  { id: "design", name: "声音设计" },
  { id: "dialog", name: "自然对话" },
  { id: "studio", name: "一体工作台" },
  { id: "lab", name: "实验调参" },
];

/** 默认展示的「推荐」卡片（用户令：默认 4 张，其余展开）；11-17 移除非商用权重后为这 4 个。 */
export const VOICE_EXTERNAL_DEFAULT_IDS = ["gpt-sovits", "cosyvoice3", "qwen3-tts", "chatterbox"];

/** CosyVoice 源码钉死提交（11-16 实测拉取；换版本时与模型清单一起更新）。 */
const COSYVOICE_COMMIT = "074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc";

/** 开源项目卡片数据（顺序即「全部」展开顺序）。⛔ 11-17 用户令：非商用权重的引擎不进目录。 */
export const VOICE_EXTERNAL_ENGINES = [
  {
    id: "gpt-sovits",
    name: "GPT-SoVITS",
    category: "clone",
    recommended: true,
    kind: "engine",
    adapter: "gpt-sovits",
    /* 11-17 mac 适配：安装包是 Windows 便携版（runtime/python.exe + 7z），mac 跑不起来。 */
    platforms: ["win32"],
    repo: "https://github.com/RVC-Boss/GPT-SoVITS",
    license: "MIT",
    licenseNote: "代码 MIT；随发行包分发的权重以下载页声明为准",
    commercial: "yes",
    commercialLabel: "可商用",
    languages: "中 / 英 / 日",
    sizeLabel: "约 8.2GB（含运行环境与模型）",
    sizeMB: 8190,
    vram: "4–6GB 显存",
    tagline: "中文克隆效果最好：5 秒参考音频即可用",
    pros: ["中文相似度与自然度第一梯队", "自带 HTTP API，接入最省事", "可用「我的音色」参考音频"],
    cons: ["整包很大（8.2GB）", "首次启动加载模型要十几秒"],
    install: {
      kind: "archive",
      format: "7z",
      version: "v2pro-20250604",
      url: "https://www.modelscope.cn/models/FlowerCry/gpt-sovits-7z-pacakges/resolve/master/GPT-SoVITS-v2pro-20250604.7z",
      bytes: 8185086602,
    },
  },
  {
    id: "cosyvoice3",
    name: "CosyVoice 3",
    category: "dialect",
    recommended: true,
    kind: "engine",
    adapter: "cosyvoice3",
    /* 11-17 mac 适配：安装器用 Windows venv + CUDA torch，mac 需要另一套（MPS/CPU）适配。 */
    platforms: ["win32"],
    repo: "https://github.com/FunAudioLLM/CosyVoice",
    license: "Apache-2.0",
    licenseNote: "代码与模型权重按 FunAudioLLM 仓库/ModelScope 模型卡许可",
    commercial: "yes",
    commercialLabel: "可商用",
    languages: "9 语种 + 18+ 中文方言",
    sizeLabel: "约 9GB（环境 + 5.2GB 模型）",
    sizeMB: 9000,
    vram: "4–6GB 显存",
    tagline: "方言与跨语种克隆，3 秒参考（0.5B）",
    pros: ["中文方言覆盖最广", "跨语种克隆稳定", "支持情感/发音修复指令"],
    cons: ["安装要建 Python 环境（较慢）", "首次加载权重约 5GB"],
    install: {
      kind: "source",
      zipUrl: `https://codeload.github.com/FunAudioLLM/CosyVoice/zip/${COSYVOICE_COMMIT}`,
      commit: COSYVOICE_COMMIT,
      modelRepo: "FunAudioLLM/Fun-CosyVoice3-0.5B-2512",
      modelFiles: [
        "CosyVoice-BlankEN/config.json",
        "CosyVoice-BlankEN/generation_config.json",
        "CosyVoice-BlankEN/merges.txt",
        "CosyVoice-BlankEN/model.safetensors",
        "CosyVoice-BlankEN/tokenizer_config.json",
        "CosyVoice-BlankEN/vocab.json",
        "campplus.onnx",
        "configuration.json",
        "cosyvoice3.yaml",
        "flow.pt",
        "hift.pt",
        "llm.pt",
        "speech_tokenizer_v3.onnx",
      ],
    },
  },


  {
    id: "qwen3-tts",
    name: "Qwen3-TTS",
    category: "design",
    recommended: false,
    kind: "engine",
    adapter: "qwen3-tts",
    /* 11-17 mac 适配：安装器用 Windows venv + CUDA torch，mac 需要另一套（MPS/CPU）适配。 */
    platforms: ["win32"],
    repo: "https://github.com/QwenLM/Qwen3-TTS",
    license: "Apache-2.0",
    licenseNote: "模型权重 Apache-2.0；语音克隆需取得被克隆人授权",
    commercial: "yes",
    commercialLabel: "可商用",
    languages: "10 语种",
    sizeLabel: "约 5GB（环境 + 2.5GB 模型 0.6B）",
    sizeMB: 5000,
    vram: "4–6GB 显存",
    tagline: "用文字描述设计新声音（0.6B / 1.7B）",
    pros: ["声音设计能力独一档", "流式首包延迟低"],
    cons: ["中文克隆不是最强项", "安装用 0.6B-Base 克隆；声音设计模型另下"],
    install: {
      kind: "python",
      adapter: "qwen3-tts",
      python: "3.12",
      torchBackend: "cu128",
      pip: ["qwen-tts"],
      models: [{ source: "modelscope", repo: "Qwen/Qwen3-TTS-12Hz-0.6B-Base", dest: "models" }],
    },
  },
  {
    id: "chatterbox",
    name: "Chatterbox",
    category: "dialog",
    recommended: false,
    kind: "engine",
    adapter: "chatterbox",
    /* 11-17 mac 适配：安装器用 Windows venv + CUDA torch；mac 上 torch 只能走 MPS/CPU，需另测。 */
    platforms: ["win32"],
    repo: "https://github.com/resemble-ai/chatterbox",
    license: "MIT",
    licenseNote: "代码与基础权重 MIT；输出含不可感知水印",
    commercial: "yes",
    commercialLabel: "可商用",
    languages: "23 语种（含中文）",
    sizeLabel: "约 4GB（环境 + 3.2GB 模型）",
    sizeMB: 4000,
    vram: "4GB 显存",
    tagline: "自然对话与情绪夸张（多语 v2）",
    pros: ["对话感强，支持 [laugh] 等标签", "多语 v3 支持中文"],
    cons: ["中文不是第一梯队", "长文本要自己切句"],
    install: {
      kind: "python",
      adapter: "chatterbox",
      python: "3.10",
      torchBackend: "cu124",
      torch: "torch==2.6.0 torchaudio==2.6.0",
      pip: ["chatterbox-tts"],
      models: [
        { source: "url", url: "https://hf-mirror.com/ResembleAI/chatterbox/resolve/main/ve.pt", dest: "models/ve.pt", bytes: 5698626 },
        { source: "url", url: "https://hf-mirror.com/ResembleAI/chatterbox/resolve/main/t3_mtl23ls_v2.safetensors", dest: "models/t3_mtl23ls_v2.safetensors", bytes: 2143989752 },
        { source: "url", url: "https://hf-mirror.com/ResembleAI/chatterbox/resolve/main/s3gen.pt", dest: "models/s3gen.pt", bytes: 1057165844 },
        { source: "url", url: "https://hf-mirror.com/ResembleAI/chatterbox/resolve/main/grapheme_mtl_merged_expanded_v1.json", dest: "models/grapheme_mtl_merged_expanded_v1.json", bytes: 69989 },
        { source: "url", url: "https://hf-mirror.com/ResembleAI/chatterbox/resolve/main/conds.pt", dest: "models/conds.pt", bytes: 107374 },
        { source: "url", url: "https://hf-mirror.com/ResembleAI/chatterbox/resolve/main/Cangjie5_TC.json", dest: "models/Cangjie5_TC.json", bytes: 1920163 },
      ],
    },
  },

  {
    id: "zonos",
    name: "Zonos",
    category: "lab",
    recommended: false,
    kind: "engine",
    adapter: null,
    repo: "https://github.com/Zyphra/Zonos",
    license: "Apache-2.0",
    licenseNote: "Zonos3-Mini 权重 Apache-2.0；大模型版本另看条款",
    commercial: "yes",
    commercialLabel: "可商用",
    languages: "多语（含中文预置音色）",
    sizeLabel: "约 5GB",
    sizeMB: 5000,
    vram: "6–8GB 显存",
    tagline: "手动调节声音细节（响度/频响/语速/词级情绪）",
    pros: ["控制粒度最细", "44kHz 输出"],
    cons: ["官方只支持 Linux/macOS（Windows 需第三方移植）", "依赖 eSpeak；暂不接管播报"],
    install: null,
  },
  {
    id: "voicebox",
    name: "Voicebox",
    category: "studio",
    recommended: false,
    kind: "studio",
    adapter: null,
    repo: "https://github.com/jamiepine/voicebox",
    license: "MIT（应用）",
    licenseNote: "应用 MIT；内置引擎（Qwen3-TTS / Chatterbox / Kokoro 等）各自许可",
    commercial: "yes",
    commercialLabel: "可商用（看内置模型）",
    languages: "23 语种（随引擎）",
    sizeLabel: "数 GB（安装包 + 模型）",
    sizeMB: 4000,
    vram: "需 NVIDIA GPU",
    tagline: "少折腾：一体化语音工作室（克隆/听写/创作）",
    pros: ["桌面 App，装完即用", "内置多引擎"],
    cons: ["独立应用，不接管本应用播报", "Windows 需 GPU"],
    install: { kind: "external", url: "https://github.com/jamiepine/voicebox" },
  },
  {
    id: "voice-studio",
    name: "OmniVoice Studio",
    category: "studio",
    recommended: false,
    kind: "studio",
    adapter: null,
    repo: "https://github.com/debpalash/VoiceStudio",
    license: "AGPL-3.0（应用）",
    licenseNote: "应用 AGPL-3.0；仅本机安装使用，不随包、不参与商业分发",
    commercial: "agpl",
    commercialLabel: "AGPL-3.0",
    badge: "AGPL",
    languages: "646 语种（16 TTS 引擎）",
    sizeLabel: "约 10GB + 默认模型 2.4GB",
    sizeMB: 12400,
    vram: "可无 GPU（慢）",
    tagline: "本地版 ElevenLabs：16 引擎 / 11 ASR / 646 语言",
    pros: ["功能最全的工作台", "装完即用"],
    cons: ["AGPL-3.0", "占空间大（默认约 10GB）", "不接管本应用播报"],
    install: { kind: "external", url: "https://github.com/debpalash/VoiceStudio" },
  },
  {
    id: "tts-webui",
    name: "TTS-WebUI",
    category: "lab",
    recommended: false,
    kind: "webui",
    adapter: null,
    repo: "https://github.com/rsxdalv/TTS-WebUI",
    license: "聚合器（随各模型）",
    licenseNote: "聚合 Bark / GPT-SoVITS / CosyVoice / XTTS / Kokoro 等，各模型许可不同",
    commercial: "varies",
    commercialLabel: "随模型",
    languages: "随模型",
    sizeLabel: "10GB+（随模型）",
    sizeMB: 10240,
    vram: "随模型",
    tagline: "喜欢测试各种模型：一个 WebUI 集成几十种引擎",
    pros: ["模型最全", "适合做横向对比"],
    cons: ["无统一 API，不接管本应用播报", "安装依赖多"],
    install: { kind: "external", url: "https://github.com/rsxdalv/TTS-WebUI" },
  },
];

/** 硬件门槛（展示用，11-16 用户令「注释好，那些需要高配置电脑」）。
 *  demand: high = 8GB 显卡跑不动/会 OOM（Zonos、Voicebox）；
 *  medium = 主流独显可用；light = 入门独显即可。
 *  磁盘是含 venv + CUDA torch 的实测/量级值，只作提示，不参与安装校验。 */
const HARDWARE = {
  "gpt-sovits": { demand: "medium", hardware: "4–6GB 显存 / 约 14GB 磁盘（本机实测）" },
  cosyvoice3: { demand: "medium", hardware: "4–6GB 显存 / 约 11GB 磁盘（本机实测）" },
  "qwen3-tts": { demand: "medium", hardware: "4–6GB 显存（0.6B）/ 约 10GB 磁盘（本机实测）" },
  chatterbox: { demand: "light", hardware: "4GB 显存 / 约 8GB 磁盘（本机实测）" },
  zonos: { demand: "high", hardware: "6–8GB 显存 / 仅 Linux·macOS" },
  voicebox: { demand: "high", hardware: "需 NVIDIA 独显 / 数 GB 磁盘" },
  "voice-studio": { demand: "medium", hardware: "可无 GPU（很慢）/ 约 10GB+ 磁盘" },
  "tts-webui": { demand: "medium", hardware: "随模型；部分模型需 8GB+ 显存" },
};

/** 每个引擎「怎么用」（11-17 用户令：写进引擎的配置弹窗里）。展示用，不参与安装。 */
const USAGE = {
  "gpt-sovits": [
    "装好后点「配置 → 启用」；首次启动加载模型约 10–20 秒",
    "音色选一段参考音频（3–10 秒最稳）：到「我的音色」导入，或直接选内置参考音色",
    "点「试听」确认声音；之后语音播报与实时通话都用它",
    "换嗓子就在音色下拉里换参考音频，不用重装",
  ],
  cosyvoice3: [
    "安装要建 Python 环境（约 10–20 分钟）；首次启动加载 5GB 权重约 1–2 分钟",
    "启用后在音色里选参考音频（3 秒即可）或内置参考音色",
    "参考音频说什么语言就克隆什么语言，中英与方言走同一条链",
    "点「试听」确认后再用于播报 / 通话",
  ],
  "qwen3-tts": [
    "装好后启用；0.6B 模型，4–6GB 显存可跑",
    "音色选参考音频做克隆，或直接用内置参考音色",
    "「用文字描述生成新声音」要另装声音设计模型，本卡先提供克隆",
    "点「试听」确认后再用于播报 / 通话",
  ],
  chatterbox: [
    "装好后启用，可直接用「默认音色」（不需要参考音频）",
    "想克隆别的嗓子：音色选「我的音色」或内置参考音色",
    "对话感强、支持情绪夸张；长文本按句播报更稳",
    "点「试听」确认后再用于播报 / 通话",
  ],
  zonos: [
    "官方只支持 Linux / macOS，Windows 需第三方移植（本卡只给入口）",
    "支持预置音色与细粒度参数调节",
    "不接管本应用的播报 / 通话",
  ],
  voicebox: [
    "独立语音工作台（自带引擎），不接管本应用播报",
    "在它自己的界面里克隆 / 合成并导出音频",
  ],
  "voice-studio": [
    "独立工作台（AGPL-3.0），本卡只提供下载入口",
    "在应用内选择引擎和音色，导出音频",
    "不接管本应用的播报 / 通话",
  ],
  "tts-webui": [
    "聚合几十种 TTS 模型的 WebUI，本卡只提供入口",
    "在它自己的界面里按模型分别配置",
    "无统一 API，不接管本应用的播报 / 通话",
  ],
};

for (const entry of VOICE_EXTERNAL_ENGINES) {
  Object.assign(entry, HARDWARE[entry.id] ?? { demand: "medium", hardware: "" }, { usage: USAGE[entry.id] ?? [] });
}

/** 是否需要高配电脑（卡片据此显示「需高配」）。 */
export function isHighDemand(entry) {
  return entry?.demand === "high";
}

/** 按 id 取一条卡片（找不到返回 null）。 */
export function externalEngineById(id) {
  return VOICE_EXTERNAL_ENGINES.find((entry) => entry.id === id) ?? null;
}

/** 默认展示的 4 张卡片（顺序与 VOICE_EXTERNAL_DEFAULT_IDS 一致）。 */
export function defaultExternalEngines() {
  return VOICE_EXTERNAL_DEFAULT_IDS.map((id) => externalEngineById(id)).filter(Boolean);
}

/** 分类筛选（"all" 返回全部）。 */
export function enginesInCategory(category) {
  return category === "all" ? VOICE_EXTERNAL_ENGINES : VOICE_EXTERNAL_ENGINES.filter((entry) => entry.category === category);
}

/** 是否为非商用权重（卡片必须显示徽标）。 */
export function isNonCommercial(entry) {
  return entry?.commercial === "no" || entry?.commercial === "conditional";
}
