/**
 * 合成引擎的**模型装配**（10-26 新增；独立模块）。
 *
 * 职责：从「用户选了哪个引擎 + 模型装没装」算出 TTS worker 该加载哪套模型。
 * 只做装配，不做合成、不碰线程生命周期。
 *
 * ⛔ 为什么独立成文件：`voice-service.ts` 在守卫【265】的「>1000 行只许缩不许长」棘轮上
 *    （登记值 887 净代码行）。把引擎分支塞进去会让它变长 ⇒ 装配放这儿，主文件只留一次调用。
 *
 * ⛔ 优先级（在调用方那一层决定）：**克隆音色 > Kokoro > vits**。
 *    选了克隆音色就必须是克隆 —— 合成出别人的声音比回退更糟。
 *
 * ⛔ 没装 / 被停用 ⇒ **回落 vits 并说明原因**（不能"看起来切了其实没切"）。
 */

import { join } from "node:path";
import { KOKORO_DIR, TTS_REPO, kokoroReady } from "./model-manifest";
import { modelFilePath } from "./model-store";
import type { VoiceTtsEngine } from "./voice-settings";

export type EnginePick = {
  /** 引擎名（同时就是 worker 的 mode） */
  mode: "vits" | "kokoro";
  /** 直接喂给 TTS worker 的初始化数据 */
  workerData: Record<string, unknown>;
  /** 要写进日志的一句话（回落时说明原因；正常时为空） */
  note?: string;
};

export type EnginePickParams = {
  modelsRoot: string;
  engine: VoiceTtsEngine | undefined;
  numThreads: number;
  sherpaPath: string;
  /** 停用状态查表（主进程注入，避免这里再读一次设置文件） */
  isEnabled: (kind: "kokoro") => boolean;
};

/**
 * 按当前引擎装配 TTS worker 数据。
 *
 * ⛔ kokoro 的 sid 是**音色索引**（0..102，顺序与官方 voices.bin 一致），
 *    与 vits 的说话人 id（0..4）不是一回事 —— 音色表在 voice-settings 里按引擎给。
 */
export function buildEngineWorkerData(params: EnginePickParams): EnginePick {
  const { modelsRoot, engine, numThreads, sherpaPath } = params;

  if (engine === "kokoro") {
    if (!params.isEnabled("kokoro")) {
      return {
        mode: "vits",
        workerData: vitsWorkerData(modelsRoot, numThreads, sherpaPath),
        note: "Kokoro 模型已被停用 —— 本次朗读回退到内置音色（文件仍保留，重新启用即可恢复）",
      };
    }
    if (!kokoroReady(modelsRoot)) {
      return {
        mode: "vits",
        workerData: vitsWorkerData(modelsRoot, numThreads, sherpaPath),
        note: "Kokoro 模型未安装 —— 本次朗读回退到内置音色（到设置页下载后可自动生效）",
      };
    }
    const dir = join(modelsRoot, KOKORO_DIR);
    return {
      mode: "kokoro",
      workerData: {
        mode: "kokoro",
        sherpaPath,
        numThreads,
        kokoro: {
          model: join(dir, "model.int8.onnx"),
          voices: join(dir, "voices.bin"),
          tokens: join(dir, "tokens.txt"),
          dataDir: join(dir, "espeak-ng-data"),
          lexicon: join(dir, "lexicon-zh.txt"),
        },
      },
    };
  }

  return { mode: "vits", workerData: vitsWorkerData(modelsRoot, numThreads, sherpaPath) };
}

/** 内置 vits（预置 5 个音色）—— 永远可用的兜底。 */
function vitsWorkerData(modelsRoot: string, numThreads: number, sherpaPath: string): Record<string, unknown> {
  return {
    mode: "vits",
    sherpaPath,
    numThreads,
    model: modelFilePath(modelsRoot, TTS_REPO.repo, "model.onnx"),
    lexicon: modelFilePath(modelsRoot, TTS_REPO.repo, "lexicon.txt"),
    tokens: modelFilePath(modelsRoot, TTS_REPO.repo, "tokens.txt"),
  };
}
