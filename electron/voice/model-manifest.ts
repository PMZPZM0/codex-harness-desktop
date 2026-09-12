import path from "node:path";
import { statSync } from "node:fs";
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
  /** 声码器：不在主包里，单独下载到模型目录 */
  vocoder: {
    name: "vocos_24khz.onnx",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos_24khz.onnx",
    sha256: "bcb3b970e384161c4d634f0bb9e999ff1c471b34c9bc0b1049a5014065ed3cc0",
    bytes: 54_157_409,
  },
} as const;

/** 音色克隆模型是否就绪（关键文件 + 声码器都在）。 */
export function zipvoiceReady(modelsRoot: string): boolean {
  const dir = path.join(modelsRoot, ZIPVOICE_DIR);
  const need = [...ZIPVOICE_ARCHIVE.readyFiles, ZIPVOICE_ARCHIVE.vocoder.name];
  return need.every((name) => {
    try { return statSync(path.join(dir, name)).size > 0; } catch { return false; }
  });
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
