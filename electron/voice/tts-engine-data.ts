/**
 * 合成引擎的**模型装配**（10-26 新增；独立模块）。
 *
 * 职责：从「用户选了哪个引擎 + 模型装没装」算出 TTS worker 该加载哪套模型。
 * 只做装配，不做合成、不碰线程生命周期。
 *
 * ⛔ 为什么独立成文件：`voice-service.ts` 在守卫【265】的「>1000 行只许缩不许长」棘轮上
 *    （登记值 887 净代码行）。把引擎分支塞进去会让它变长 ⇒ 装配放这儿，主文件只留一次调用。
 *
 * ⛔ 优先级（在调用方那一层决定）：**克隆音色 > 内置 vits**。
 *    选了克隆音色就必须是克隆 —— 合成出别人的声音比回退更糟。
 *
 * ⛔ 11-11 用户令移除 Kokoro（自然多音色）⇒ 本地合成只剩 vits 一套；
 *    情感语音仍缺 ONNX 推理运行时，不走这里。
 */

import { TTS_REPO } from "./model-manifest";
import { modelFilePath } from "./model-store";
import type { VoiceTtsEngine } from "./voice-settings";

export type EnginePick = {
  /** 引擎名（同时就是 worker 的 mode） */
  mode: "vits";
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
};

/** 按当前引擎装配 TTS worker 数据（11-11 起本地只有 vits；未知引擎一律回落 vits）。 */
export function buildEngineWorkerData(params: EnginePickParams): EnginePick {
  const { modelsRoot, numThreads, sherpaPath } = params;
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
