import path from "node:path";
import { readdirSync, statSync } from "node:fs";
/**
 * 语音模型清单（纯数据，无副作用）。
 *
 * 全部为「本机离线推理」模型，零凭据、零联网（首次下载后永久离线）。
 * 仓库与 SHA256 取自已验证的同类实现 dsh-voice-mode（MIT）的模型清单，
 * 该实现在本机跑通过同样的 sherpa-onnx 运行时。
 *
 * 目录约定：<modelsRoot>/<repo>/<file>，与 HuggingFace 仓库结构一致。
 * 注意：`repo` 里的斜杠在本地会变成一层子目录。
 */

export type VoiceModelFile = {
  /** 相对仓库根的文件名（可含子目录） */
  name: string;
  /** 期望的 SHA256（小写十六进制），用于校验完整性 */
  sha256: string;
  /** 约略体积（字节），仅用于进度显示与提示 */
  bytes: number;
};

export type VoiceModelRepo = {
  /** HuggingFace 仓库 id，形如 owner/name */
  repo: string;
  files: VoiceModelFile[];
};

/** 主源：HuggingFace 官方；兜底：国内可达的 hf-mirror 镜像。 */
export const MODEL_HOSTS = ["https://huggingface.co", "https://hf-mirror.com"] as const;

/**
 * 语音识别（流式）：边说边出字。
 * zipformer2 中文 int8，encoder/joiner 量化后约 160MB。
 */
export const ASR_REPO: VoiceModelRepo = {
  repo: "csukuangfj/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30",
  files: [
    { name: "encoder.int8.onnx", sha256: "5ac51e27981bb4dab01bb9be4958453ba50c3b61c063ddda0eab23fd3671aa4f", bytes: 154_000_000 },
    { name: "decoder.onnx", sha256: "06522ad63cec0fdf6809f4e1db9bb4f7d710c34582e3b35db62ac60eccafac7e", bytes: 8_000_000 },
    { name: "joiner.int8.onnx", sha256: "b34584dc6f561089e1d747fedebb3765f2caa72c927ef54d7ca55e5ae40a814b", bytes: 3_000_000 },
    { name: "tokens.txt", sha256: "6193c7ea1c96d0d9a1e9652789b40d13a8a913b434a5451e93158f5a09fd6652", bytes: 60_000 },
  ],
};

/** 端点检测（Silero VAD）：判定「用户说完了」。约 2MB。 */
export const VAD_REPO: VoiceModelRepo = {
  repo: "csukuangfj/vad",
  files: [
    { name: "silero_vad.onnx", sha256: "a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28", bytes: 2_100_000 },
  ],
};

/**
 * 语音合成：中文 VITS（5 个说话人），含日期/数字/电话归一化 fst。约 130MB。
 * 选它而非 Kokoro 的原因：文件少（5 个，全部可直连下载，无需枚举目录树），
 * 对「首次下载成功率」更友好；中英混读需求留作后续可选增强。
 */
export const TTS_REPO: VoiceModelRepo = {
  repo: "csukuangfj/sherpa-onnx-vits-zh-ll",
  files: [
    { name: "model.onnx", sha256: "6c349bdd73dc928234dd7bc86929748bba32cd5264d32d915bf7b7aa0595965b", bytes: 116_000_000 },
    { name: "lexicon.txt", sha256: "b3a82f16b286c424953dea3686039e7ab465fa8e15d87ef8abd0ec69175beb21", bytes: 3_000_000 },
    { name: "tokens.txt", sha256: "34b035b9aeb070df6188b022f29c00e0e142c7ade9f25611ced65db5e9cc8402", bytes: 60_000 },
    { name: "G_multisperaker_latest.json", sha256: "f31e4bf23827c3528fdf090fd7b6fb8e63333709b80670d40fa864f1fa9fadf3", bytes: 20_000 },
    { name: "date.fst", sha256: "eb8aa079ae3cb81d8f4404992f39d61a0cb990947512b5b8d1e54d1f6980e718", bytes: 4_000 },
    { name: "phone.fst", sha256: "1ac2b6fa56b1442320c4de7db08353bab8963a2b57f365eebcdd3a2d3562f8d7", bytes: 30_000 },
    { name: "number.fst", sha256: "743f402181fcfebf76cc2f0546b71fa26476e626fbe4e460fb7b4c3a7a8bd5bd", bytes: 40_000 },
  ],
};

/**
 * 音色克隆（ZipVoice）：zero-shot 语音克隆 TTS——导入/录制一段参考音频即可获得专属音色。
 * 与上面三个仓库不同，它在 GitHub release 以 tar.bz2 整包发布（espeak-ng-data 是目录，
 * 逐文件清单不现实），所以走「归档型资源」：整包下载 → 校验 → 解压到 modelsRoot，
 * 声码器 vocos_24khz.onnx 单独下载进模型目录。**按需下载，不进安装包。**
 */
export const ZIPVOICE_DIR = "sherpa-onnx-zipvoice-distill-int8-zh-en-emilia";
export const ZIPVOICE_ARCHIVE = {
  dir: ZIPVOICE_DIR,
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2",
  sha256: "77219c8b40f4ee8d73a7f902305ff6c1128ef9b54461c41b4ca6ed890b6c2803",
  bytes: 109_162_785,
  /** 解压后必须存在的关键文件（相对模型目录），就绪判定用 */
  readyFiles: ["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt", "lexicon.txt"],
  /**
   * 每个关键文件的**最小合理体积**（字节）—— 10-08 新增，与 `readyFiles` 一一对应。
   *
   * ⛔ 为什么必须有：`statSync(...).size > 0` 挡不住「下了一半 / 解压中断」。用户实测
   *    「音色克隆模型 15 秒内下载失败，状态却被刷新成『已安装』，其实不能用」，根因就是
   *    判定只认「文件在且非空」。下限取本机实测完整文件的 **~20%~30%**（实测值见注释），
   *    只用来判「残不残」——不同版本换了体积本来就会在 SHA256 上先失败。
   */
  readyFileMinBytes: {
    "encoder.int8.onnx": 1_000_000,      // 实测完整 5,570,211
    "decoder.int8.onnx": 20_000_000,     // 实测完整 124,657,100（这个大的是 decoder，别按名字想当然）
    "tokens.txt": 200,                   // 实测完整 2,570
    "lexicon.txt": 200_000,              // 实测完整 1,727,147
  } as Record<string, number>,
  /** 声码器：不在主包里，单独下载到模型目录 */
  vocoder: {
    name: "vocos_24khz.onnx",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos_24khz.onnx",
    sha256: "bcb3b970e384161c4d634f0bb9e999ff1c471b34c9bc0b1049a5014065ed3cc0",
    bytes: 54_157_409,
    /** 最小合理体积 ≈ 声明体积的 95%（实测完整文件 = 54,157,409，与声明逐字节相等）。
     *  它是「网络中断留下半截」的第一现场（直接下载到模型目录的那个文件），下限必查。 */
    minBytes: 51_400_000,
  },
} as const;

/**
 * 音色克隆模型是否就绪。
 *
 * 判据 = 关键文件都在 **且都达到最小合理体积** + 声码器在且够大。
 * ⛔ 10-08 前这里只有 `size > 0` ⇒ 半截的声码器（网络中断的残留）会让状态显示「已安装」，
 *    用户点进去却用不了。**配合 model-store 的原子下载（`.part` + rename）**，
 *    最终路径从此只可能出现完整文件；体积下限是第二道网（挡历史遗留的残file 与解压中断）。
 */
export function zipvoiceReady(modelsRoot: string): boolean {
  const dir = path.join(modelsRoot, ZIPVOICE_DIR);
  const minOf = ZIPVOICE_ARCHIVE.readyFileMinBytes;
  const keyFilesOk = ZIPVOICE_ARCHIVE.readyFiles.every((name) => {
    try {
      return statSync(path.join(dir, name)).size >= (minOf[name] ?? 1);
    } catch { return false; }
  });
  if (!keyFilesOk) return false;
  try {
    return statSync(path.join(dir, ZIPVOICE_ARCHIVE.vocoder.name)).size >= ZIPVOICE_ARCHIVE.vocoder.minBytes;
  } catch { return false; }
}

/**
 * 可选合成引擎 ②：Kokoro v1.1 int8（中英，103 说话人）。
 *
 * ⛔ 为什么走「归档型资源」而不是逐文件清单：包里的 `espeak-ng-data/` 是 **120 个文件**的目录
 *    （还有 `dict/` 目录），逐文件列清单不现实 —— 与 zipvoice 同一套路：整包下载 → 校验 → 解压。
 *
 * 全部数字为**本机实测**（2026-10-26）：压缩包 147,031,220 字节，解压后 206MB。
 * 官方 RTF（Raspberry Pi 4B）：1/2/3/4 线程 = 7.635 / 4.470 / 3.430 / 3.191
 *    （对比 vits-zh-ll 的 4.275 / 2.494 / 1.840 / 1.593 ⇒ **约慢 1.8 倍**，换来自然度与 103 音色）。
 */
export const KOKORO_DIR = "kokoro-int8-multi-lang-v1_1";
export const KOKORO_ARCHIVE = {
  dir: KOKORO_DIR,
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2",
  sha256: "a1e94694776049035c4f2c6529f003aaece993c76aae9a78995831c3c4dcafc6",
  bytes: 147_031_220,
  /** 解压后必须存在的关键文件（就绪判定用；体积为实测字节数） */
  readyFiles: ["model.int8.onnx", "voices.bin", "tokens.txt", "lexicon-zh.txt"],
  /** 最小合理体积：实测 114,299,010 / 53,790,720 / 1,111 / 2,119,465 ⇒ 取 ~30% 挡半截 */
  readyFileMinBytes: {
    "model.int8.onnx": 34_000_000,
    "voices.bin": 16_000_000,
    "tokens.txt": 300,
    "lexicon-zh.txt": 600_000,
  } as Record<string, number>,
  /** espeak-ng-data 是目录，只按目录存在 + 文件数判定（解压中断最常见的残留形态） */
  extra: { espeakDir: "espeak-ng-data", espeakMinFiles: 100 },
} as const;

export function kokoroReady(modelsRoot: string): boolean {
  const dir = path.join(modelsRoot, KOKORO_DIR);
  const minOf = KOKORO_ARCHIVE.readyFileMinBytes;
  const ok = KOKORO_ARCHIVE.readyFiles.every((name) => {
    try { return statSync(path.join(dir, name)).size >= (minOf[name] ?? 1); } catch { return false; }
  });
  if (!ok) return false;
  try {
    const espeak = path.join(dir, KOKORO_ARCHIVE.extra.espeakDir);
    return statSync(espeak).isDirectory()
      && readdirSync(espeak).length >= KOKORO_ARCHIVE.extra.espeakMinFiles;
  } catch { return false; }
}

/**
 * 可选合成引擎 ③：EmotiVoice（网易有道，Apache-2.0）——**真情绪控制**。
 *
 * ⛔ 说明：这套不是 sherpa-onnx 能直接吃的模型。生成器 ONNX 由我们从官方权重导出
 *   （spike 验证：CPU RTF ≈ 0.19–0.38，20/40/80 音素与 PyTorch 输出逐点误差 ≤3.6e-4），
 *   SimBERT 负责把「情绪提示 / 文本语义」编码成 768 维向量。
 *   ⛔ 推理需要 onnxruntime —— 本项目现有运行时（sherpa-onnx）**不提供**通用 ONNX 加载，
 *      所以本卡片的模型可以下载，但合成能力要等推理运行时接入后才可用（UI 会如实提示）。
 *
 * 体积与 SHA256 均为本机实测。⚠️ 托管地址：SimBERT 走 ModelSpace 镜像；
 *   我们自导出的 ONNX 需要自己的托管位（见 `EMOTIVOICE_HOST_NOTE`）。
 */
export const EMOTIVOICE_DIR = "emotivoice";

/**
 * ⛔⛔ 更新通道（10-26 用户令「记得安排国内镜像源，和留更新通道」）。
 *
 * ① **国内镜像**：SimBERT 走 ModelSpace（国内直连，实测 200）；GitHub 上的归档走
 *    `GITHUB_MIRROR_PREFIXES`（ghfast / gh-proxy，Kokoro 与 zipvoice 同路）。
 * ② **更新通道**：自导出的生成器 ONNX 与两份音素/说话人表的**托管基址 + 版本号**都收在这两个常量里。
 *    换 CDN / 换模型版本 ⇒ 只改这里（或将来改成读远程 manifest），**不用动下载逻辑**。
 *    ⛔ 基址留空时安装必须**明确报错**，绝不能静默当成功（那会让 UI 显示"已安装"却不能合成）。
 */
export const EMOTIVOICE_SIMBERT_BASE =
  "https://www.modelscope.cn/models/syq163/WangZeJun/resolve/master/simbert-base-chinese";
/** 自导出产物（生成器 ONNX + 音素表 + 说话人表）的托管基址；空串 = 尚未配置。 */
export const EMOTIVOICE_ONNX_BASE = "";
/** 自导出产物的版本（改模型就 +1 ⇒ 旧文件 SHA256 不同会自然重下）。 */
export const EMOTIVOICE_ONNX_VERSION = "2026-10-26";
export const EMOTIVOICE_HOST_NOTE =
  `生成器 ONNX 由本项目自行导出，托管地址待配置（版本 ${EMOTIVOICE_ONNX_VERSION}）`;

/** 每个文件的下载地址；自导出产物在基址未配置时为**空串**（安装时会如实报错）。 */
export const EMOTIVOICE_URLS: Record<string, string> = {
  "simbert/pytorch_model.bin": `${EMOTIVOICE_SIMBERT_BASE}/pytorch_model.bin`,
  "simbert/vocab.txt": `${EMOTIVOICE_SIMBERT_BASE}/vocab.txt`,
  "tokenlist": EMOTIVOICE_ONNX_BASE ? `${EMOTIVOICE_ONNX_BASE}/tokenlist` : "",
  "speaker2": EMOTIVOICE_ONNX_BASE ? `${EMOTIVOICE_ONNX_BASE}/speaker2` : "",
  "emotivoice_generator_dyn.onnx": EMOTIVOICE_ONNX_BASE ? `${EMOTIVOICE_ONNX_BASE}/emotivoice_generator_dyn.onnx` : "",
  "emotivoice_generator_dyn.onnx.data": EMOTIVOICE_ONNX_BASE ? `${EMOTIVOICE_ONNX_BASE}/emotivoice_generator_dyn.onnx.data` : "",
};
export const EMOTIVOICE_FILES: VoiceModelFile[] = [
  { name: "simbert/pytorch_model.bin", sha256: "9c6db519d4e21bbda3cc7f2e871187d0f3073c5ed7a6a38329c4865a3fe7e0ee", bytes: 386_278_519 },
  { name: "simbert/vocab.txt", sha256: "5c3df66617c12834db122e678e6fe8ca267045f8007a34979310ce5eca2dc449", bytes: 64_947 },
  { name: "tokenlist", sha256: "d7d68a2f794b4d7563e6e6159e8c6a8c506a584590b8c1c757370c346a435244", bytes: 2_819 },
  { name: "speaker2", sha256: "fabcda3089216f017fa76ad39929f1733445800f2658698d7ed6d0b7a59f29b2", bytes: 9_714 },
  { name: "emotivoice_generator_dyn.onnx", sha256: "9e9a8991cc7ea71a6e5b91eb11f77fec1cee88bd9a325fb508f02790b9822032", bytes: 2_440_991 },
  { name: "emotivoice_generator_dyn.onnx.data", sha256: "0e1610a0e744f51047d460a430bdb0051da706c67f7ec8d762cf6a3d7154e922", bytes: 223_357_120 },
];

export function emotivoiceReady(modelsRoot: string): boolean {
  const dir = path.join(modelsRoot, EMOTIVOICE_DIR);
  return EMOTIVOICE_FILES.every((f) => {
    try { return statSync(path.join(dir, f.name)).size >= Math.max(1, Math.floor(f.bytes * 0.3)); } catch { return false; }
  });
}

/**
 * 语音唤醒专用**关键词模型**（KWS）：zipformer 中文，建模单元是拼音（声母+韵母），
 * 自带关键词解码约束 —— 与「拿通用识别模型整句转写再字符串匹配」完全不是一回事：
 * 它对**读音**做匹配（所以「小柯小柯」不会被写成「小咳小壳」），且只认注册过的词
 * （日常说话不会误唤醒），常驻 CPU 也低得多（3.3M 参数 vs 154MB 识别模型）。
 *
 * 来源与 zipvoice 一样是 GitHub release 整包（tar.bz2，31MB），
 * 归档里同时含 epoch-12-avg-2 与 epoch-99-avg-1，以及 int8 版本；我们用 **float32 epoch-12-avg-2**
 * （KWS 本身才 3.3M 参数，没必要冒量化误差的风险）。SHA256 与体积为实测值。
 */
export const KWS_DIR = "sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01";
export const KWS_ARCHIVE = {
  dir: KWS_DIR,
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01.tar.bz2",
  sha256: "b2f7c89690dc8ce4c6ed6afeab7cd800c36ad1421fb6b6302b4a4b194cf7f35f",
  bytes: 32_654_866,
  /** 我们实际使用的三个 onnx + 词表（就绪判定用） */
  model: {
    encoder: "encoder-epoch-12-avg-2-chunk-16-left-64.onnx",
    decoder: "decoder-epoch-12-avg-2-chunk-16-left-64.onnx",
    joiner: "joiner-epoch-12-avg-2-chunk-16-left-64.onnx",
    tokens: "tokens.txt",
  },
  /**
   * 最小合理体积（字节）—— 与 `model` 一一对应，口径同 zipvoice 的 `readyFileMinBytes`。
   * ⚠️ 本机**没有**装 KWS（无法实测完整体积），所以这里取非常保守的下限（onnx 各 100KB）：
   *    目的只是挡住「解压中断留下空壳/半截」，宁可能挡住 gross 截断，也不要误判正常安装为未装。
   */
  readyFileMinBytes: {
    "encoder-epoch-12-avg-2-chunk-16-left-64.onnx": 100_000,
    "decoder-epoch-12-avg-2-chunk-16-left-64.onnx": 100_000,
    "joiner-epoch-12-avg-2-chunk-16-left-64.onnx": 100_000,
    "tokens.txt": 200,
  } as Record<string, number>,
} as const;

/** 关键词模型是否就绪（三个 onnx + tokens 都在且达到最小合理体积）。 */
export function kwsReady(modelsRoot: string): boolean {
  const dir = path.join(modelsRoot, KWS_DIR);
  const minOf = KWS_ARCHIVE.readyFileMinBytes;
  return Object.values(KWS_ARCHIVE.model).every((name) => {
    try { return statSync(path.join(dir, name)).size >= (minOf[name] ?? 1); } catch { return false; }
  });
}

/** 关键词模型目录（拼文件路径用）。 */
export function kwsDir(modelsRoot: string): string {
  return path.join(modelsRoot, KWS_DIR);
}

/** 一次安装（runtime:install id=voice-models）要拉的全部仓库。 */
export const ALL_VOICE_REPOS: VoiceModelRepo[] = [ASR_REPO, VAD_REPO, TTS_REPO];

/** 单仓库内某文件的下载地址（按 host 拼接）。 */
export function modelUrl(host: string, repo: string, file: string): string {
  return `${host}/${repo}/resolve/main/${file}`;
}

/** 全部模型的约略总体积（字节），用于 UI 提示。 */
export function totalModelBytes(): number {
  return ALL_VOICE_REPOS.reduce(
    (sum, r) => sum + r.files.reduce((s, f) => s + f.bytes, 0),
    0
  );
}
