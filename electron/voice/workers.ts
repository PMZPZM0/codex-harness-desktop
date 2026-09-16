/**
 * 语音推理子进程（ASR / TTS / KWS）与其主进程客户端。
 *
 * 为什么推理必须离开主进程：ONNX 推理是 CPU 密集的，放在主进程会**卡住整个应用的 IPC**，
 * 表现为界面假死。历史上放在 worker_threads 里跑。
 *
 * ⛔ 为什么 09-16 起从 worker_threads 改成 **utilityProcess 独立子进程**（用户实测 Windows
 * 与 mac 都会「开实时语音一会儿整个应用闪退」）：sherpa-onnx 的 native 层（onnxruntime）
 * 一旦 abort / 段错误，worker 线程的 native 崩溃**必然带死整个进程**——JS 层的
 * try/catch / worker.on("error") 全都拦不住（这就是 voice-crash.log 里什么都没留下、
 * 应用直接消失的原因）。独立子进程的 native 崩溃只杀掉子进程本身，主进程收到
 * "exit" 事件照常存活，界面提示「语音引擎已重启」。
 *
 * worker 源码是写给 worker_threads 的（parentPort + workerData）；子进程入口是一个
 * 由主进程生成的引导文件（userData/voice-worker-bootstrap.cjs）：用 require shim 把
 * `require("worker_threads")` 重定向到 process.parentPort，源码零改动复用。
 * 引导文件必须落在 asar 之外（utilityProcess 按真实文件路径加载），userData 正合适。
 *
 * 原生模块路径由主进程 `require.resolve` 后经 init 消息传入，子进程内不做裸名解析——
 * 这样在开发态与打包态都指向同一份真实路径。
 */

import fs from "node:fs";
import path from "node:path";

export const ASR_WORKER_SOURCE = `
const { parentPort, workerData } = require("worker_threads");
let recognizer = null;
let stream = null;
let sherpa = null;

function ensure() {
  if (!sherpa) sherpa = require(workerData.sherpaPath);
  if (!recognizer) {
    recognizer = new sherpa.OnlineRecognizer({
      featConfig: { sampleRate: workerData.sampleRate, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: workerData.encoder,
          decoder: workerData.decoder,
          joiner: workerData.joiner,
        },
        tokens: workerData.tokens,
        numThreads: workerData.numThreads,
        provider: "cpu",
        debug: 0,
      },
      decodingMethod: "greedy_search",
      enableEndpoint: 1,
      rule1MinTrailingSilence: workerData.rule1,
      rule2MinTrailingSilence: workerData.rule2,
      rule3MinUtteranceLength: workerData.rule3,
    });
  }
  if (!stream) stream = recognizer.createStream();
}

function resetStream() {
  if (recognizer && stream) recognizer.reset(stream);
}

parentPort.on("message", (msg) => {
  try {
    if (msg.op === "create") {
      ensure();
      parentPort.postMessage({ id: msg.id, ok: true, text: "" });
      return;
    }
    if (msg.op === "feed") {
      ensure();
      const samples = msg.samples;
      stream.acceptWaveform({ samples: samples, sampleRate: workerData.sampleRate });
      while (recognizer.isReady(stream)) recognizer.decode(stream);
      const text = String(recognizer.getResult(stream).text || "").trim();
      const endpoint = Boolean(recognizer.isEndpoint(stream));
      parentPort.postMessage({ id: msg.id, ok: true, text: text, endpoint: endpoint });
      return;
    }
    if (msg.op === "finish") {
      ensure();
      // 长按听写松手时不一定已命中 endpoint；补一段静音把尾句完整解出来。
      // ⚠️ 静音长度不能写死 3 秒（旧实现）：那是「松手到出字」里最长的一段纯等待。
      // 取 rule2 + 0.3s —— 比端点阈值略长，刚好把最后一个字的尾音解完（审计 ③）。
      const seconds = Number(workerData.finishSilenceSec) > 0 ? Number(workerData.finishSilenceSec) : 0.6;
      const silence = new Float32Array(Math.max(1, Math.round(workerData.sampleRate * seconds)));
      stream.acceptWaveform({ samples: silence, sampleRate: workerData.sampleRate });
      while (recognizer.isReady(stream)) recognizer.decode(stream);
      const text = String(recognizer.getResult(stream).text || "").trim();
      resetStream();
      parentPort.postMessage({ id: msg.id, ok: true, text });
      return;
    }
    if (msg.op === "reset") {
      resetStream();
      parentPort.postMessage({ id: msg.id, ok: true, text: "" });
      return;
    }
    parentPort.postMessage({ id: msg.id, ok: false, error: "unknown op: " + msg.op });
  } catch (e) {
    parentPort.postMessage({ id: msg.id, ok: false, error: String((e && e.message) || e) });
  }
});
`;

/**
 * 关键词唤醒（KWS）工作线程：3.3M 参数的 zipformer 关键词模型，只认注册过的词。
 * 与识别线程的区别：`feed` 不返回文本，只返回命中的关键词名（空 = 没命中），
 * 命中后**必须** reset（否则同一句会被反复命中）。
 */
export const KWS_WORKER_SOURCE = `
const { parentPort, workerData } = require("worker_threads");
let spotter = null;
let stream = null;
let sherpa = null;

function ensure() {
  if (!sherpa) sherpa = require(workerData.sherpaPath);
  if (!spotter) {
    spotter = new sherpa.KeywordSpotter({
      featConfig: { sampleRate: workerData.sampleRate, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: workerData.encoder,
          decoder: workerData.decoder,
          joiner: workerData.joiner,
        },
        tokens: workerData.tokens,
        numThreads: workerData.numThreads,
        provider: "cpu",
        debug: 0,
      },
      keywordsFile: workerData.keywordsFile,
      keywordsScore: workerData.keywordsScore,
      keywordsThreshold: workerData.keywordsThreshold,
      maxActivePaths: workerData.maxActivePaths,
      numTrailingBlanks: workerData.numTrailingBlanks,
    });
  }
  if (!stream) stream = spotter.createStream();
}

parentPort.on("message", (msg) => {
  try {
    if (msg.op === "create") {
      ensure();
      parentPort.postMessage({ id: msg.id, ok: true });
      return;
    }
    if (msg.op === "feed") {
      ensure();
      stream.acceptWaveform({ samples: msg.samples, sampleRate: workerData.sampleRate });
      while (spotter.isReady(stream)) spotter.decode(stream);
      const result = spotter.getResult(stream) || {};
      const keyword = String(result.keyword || "");
      if (keyword) spotter.reset(stream);
      parentPort.postMessage({ id: msg.id, ok: true, keyword: keyword });
      return;
    }
    if (msg.op === "reset") {
      ensure();
      spotter.reset(stream);
      parentPort.postMessage({ id: msg.id, ok: true });
      return;
    }
    parentPort.postMessage({ id: msg.id, ok: false, error: "unknown op: " + msg.op });
  } catch (e) {
    parentPort.postMessage({ id: msg.id, ok: false, error: String((e && e.message) || e) });
  }
});
`;

export const TTS_WORKER_SOURCE = `const { parentPort, workerData } = require("worker_threads");
const fs = require("node:fs");
let tts = null;
let sherpa = null;
let refSamples = null;
let refRate = 0;

/** 读 16-bit PCM wav（只用于参考音频——那由我们自己写盘，格式可控）。 */
function readWav16(buf) {
  if (buf.length < 44) return null;
  let offset = 12, rate = 0, ch = 1, bits = 16;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      ch = buf.readUInt16LE(offset + 10) || 1;
      rate = buf.readUInt32LE(offset + 12);
      bits = buf.readUInt16LE(offset + 22);
    } else if (id === "data") {
      if (bits !== 16) return null;
      const count = Math.min(size, buf.length - offset - 8);
      const frames = Math.floor(count / 2 / ch);
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < ch; c++) sum += buf.readInt16LE(offset + 8 + (i * ch + c) * 2);
        out[i] = sum / ch / 32768;
      }
      return { samples: out, sampleRate: rate || 16000 };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

function ensure() {
  if (!sherpa) sherpa = require(workerData.sherpaPath);
  if (!tts) {
    if (workerData.mode === "zipvoice") {
      // 音色克隆（zero-shot）：模型 + (参考音频, 参考文本) 成对使用
      const z = workerData.zipvoice || {};
      tts = new sherpa.OfflineTts({
        model: {
          zipvoice: {
            tokens: z.tokens,
            encoder: z.encoder,
            decoder: z.decoder,
            vocoder: z.vocoder,
            dataDir: z.dataDir,
            lexicon: z.lexicon,
          },
        },
        maxNumSentences: 1,
        numThreads: workerData.numThreads,
        provider: "cpu",
      });
      if (workerData.referenceAudioPath && fs.existsSync(workerData.referenceAudioPath)) {
        const parsed = readWav16(fs.readFileSync(workerData.referenceAudioPath));
        if (parsed && parsed.samples.length) {
          refSamples = parsed.samples;
          refRate = parsed.sampleRate;
        }
      }
    } else {
      tts = new sherpa.OfflineTts({
        model: {
          vits: {
            model: workerData.model,
            lexicon: workerData.lexicon,
            tokens: workerData.tokens,
          },
        },
        maxNumSentences: 1,
        numThreads: workerData.numThreads,
        provider: "cpu",
      });
    }
  }
}

parentPort.on("message", (msg) => {
  try {
    if (msg.op === "create") {
      ensure();
      parentPort.postMessage({ id: msg.id, ok: true, sampleRate: tts.sampleRate, numSpeakers: tts.numSpeakers });
      return;
    }
    if (msg.op === "speak") {
      ensure();
      const request = {
        text: msg.text,
        sid: msg.sid,
        speed: msg.speed,
        // sherpa-onnx-node 默认 true，会用 napi_create_external_buffer 返回音频。
        // Electron 21+ 禁止 native addon 创建 external buffer，generate() 内部就会抛：
        // "External buffers are not allowed"。必须从源头关掉，让 addon 返回普通 V8 buffer。
        // 见 sherpa-onnx issue #3108 / node_modules types.js 的 TtsRequest 定义。
        enableExternalBuffer: false,
      };
      if (workerData.mode === "zipvoice") {
        if (!refSamples || !refSamples.length) throw new Error("参考音频未就绪（音色档案缺音频）");
        // 坑（实测）：reference* 必须放进 generationConfig 这一层；平铺进 generate() 会被忽略，
        // 表现为 native 侧报 "reference_sample_rate 0 is invalid"。
        request.generationConfig = {
          referenceAudio: refSamples,
          referenceSampleRate: refRate,
          referenceText: String(workerData.referenceText || ""),
          numSteps: Number(workerData.numSteps || 4),
        };
      }
      const audio = tts.generate(request);
      // sherpa-onnx 返回的 samples 背后是 native/external ArrayBuffer，不能直接
      // transfer（截图里的 "External buffers are not allowed" 就是这么来的）。
      // 显式拷到 V8 管理的普通 Float32Array 后才可安全跨 worker 传输；用 transfer
      // 转移这份副本，主进程拿到后不再发生第二次复制。
      const samples = new Float32Array(audio.samples);
      parentPort.postMessage(
        {
          id: msg.id,
          ok: true,
          sampleRate: audio.sampleRate,
          samples,
        },
        [samples.buffer]
      );
      return;
    }
    parentPort.postMessage({ id: msg.id, ok: false, error: "unknown op: " + msg.op });
  } catch (e) {
    parentPort.postMessage({ id: msg.id, ok: false, error: String((e && e.message) || e) });
  }
});
`;

type PendingEntry = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

/** 生成 utilityProcess 子进程引导文件内容：把三份 worker 源码原样内嵌，
 *  用 require shim 供给 worker_threads 语义（parentPort=process.parentPort、workerData 经 init 消息填充）。 */
export function buildVoiceWorkerBootstrap(): string {
  const sources = JSON.stringify({ asr: ASR_WORKER_SOURCE, kws: KWS_WORKER_SOURCE, tts: TTS_WORKER_SOURCE });
  return '/* 自动生成（electron/voice/workers.ts）：utilityProcess 语音推理子进程入口，勿手改 */\n'
    + 'const Module = require("module");\n'
    + 'const state = { workerData: {} };\n'
    + 'const shimParentPort = {\n'
    + '  on: (_ev, fn) => process.parentPort.on("message", (e) => {\n'
    + '    const data = e && e.data;\n'
    + '    if (data && data.__init) return; // init 由引导层自己消化\n'
    + '    try { fn(data); } catch (err) {\n'
    + '      process.parentPort.postMessage({ id: (data && data.id) || -1, ok: false, error: String((err && err.message) || err) });\n'
    + '    }\n'
    + '  }),\n'
    + '  postMessage: (msg, transfer) => process.parentPort.postMessage(msg, transfer),\n'
    + '};\n'
    + 'process.on("uncaughtException", (err) => {\n'
    + '  try { process.parentPort.postMessage({ __fatal: String((err && err.stack) || err) }); } catch { /* 端口已死 */ }\n'
    + '  process.exit(1);\n'
    + '});\n'
    + 'const SOURCES = ' + sources + ';\n'
    + 'const kind = process.env.VOICE_WORKER_KIND || "";\n'
    + 'const src = SOURCES[kind];\n'
    + 'if (!src) { process.parentPort.postMessage({ __fatal: "voice bootstrap: unknown kind " + kind }); process.exit(1); }\n'
    + 'const shim = { parentPort: shimParentPort, workerData: state.workerData, isMainThread: false };\n'
    + 'const req = (id) => id === "worker_threads" ? shim : Module.createRequire(__filename)(id);\n'
    + 'try { new Function("require", src)(req); }\n'
    + 'catch (err) { process.parentPort.postMessage({ __fatal: String((err && err.stack) || err) }); process.exit(1); }\n'
    + 'process.parentPort.on("message", (e) => {\n'
    + '  const msg = e && e.data;\n'
    + '  if (msg && msg.__init) Object.assign(state.workerData, msg.workerData || {});\n'
    + '});\n';
}

let voiceBootstrapFile = "";
/** 引导文件落盘（asar 之外）：内容随源码变化时重写；返回绝对路径。 */
function ensureVoiceBootstrapFile(): string {
  if (voiceBootstrapFile) return voiceBootstrapFile;
  const { app } = require("electron") as typeof import("electron");
  const file = path.join(app.getPath("userData"), "voice-worker-bootstrap.cjs");
  const content = buildVoiceWorkerBootstrap();
  try {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) fs.writeFileSync(file, content, "utf8");
  } catch {
    // 写不进去（极端只读环境）也继续——utilityProcess 会报出明确错误，不再连带主进程
  }
  voiceBootstrapFile = file;
  return file;
}

/**
 * 语音推理子进程客户端：串行请求 + 死亡回调。
 * 串行是刻意的——同一时刻只该有一个推理在跑，否则会互相抢 CPU。
 * 底座从 worker_threads 换成 utilityProcess：native 崩溃（onnxruntime abort）只死子进程。
 */
export class VoiceWorkerClient {
  private child: any = null;
  private counter = 0;
  private pending = new Map<number, PendingEntry>();
  private chain: Promise<any> = Promise.resolve();
  private dead = false;
  private spawned = false;
  private outbox: Array<Record<string, unknown>> = [];
  private readonly onDeath: () => void;

  constructor(
    private readonly label: string,
    private readonly source: string,
    private readonly workerData: Record<string, unknown>,
    onDeath?: () => void
  ) {
    this.onDeath = onDeath ?? (() => undefined);
  }

  private get kind(): "asr" | "kws" | "tts" {
    return this.source === ASR_WORKER_SOURCE ? "asr" : this.source === KWS_WORKER_SOURCE ? "kws" : "tts";
  }

  start(): void {
    if (this.child || this.dead) return;
    const { utilityProcess } = require("electron") as typeof import("electron");
    const child = utilityProcess.fork(ensureVoiceBootstrapFile(), [], {
      // ⛔ 不要 ELECTRON_RUN_AS_NODE：utilityProcess 本身就是 Electron 的 node 环境
      env: { ...process.env, VOICE_WORKER_KIND: this.kind } as Record<string, string>,
      serviceName: `voice-${this.kind}`,
    });
    this.child = child;
    const die = (error: Error) => {
      if (this.dead) return;
      this.dead = true;
      for (const [, entry] of this.pending) entry.reject(error);
      this.pending.clear();
      this.child = null;
      this.onDeath();
    };
    child.on("message", (msg: any) => {
      if (msg && msg.__fatal) { die(new Error(`${this.label} 语音引擎崩溃：${String(msg.__fatal).slice(0, 400)}`)); return; }
      const entry = this.pending.get(msg?.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.ok) entry.resolve(msg);
      else entry.reject(new Error(String(msg.error ?? "语音引擎失败")));
    });
    // native abort / 崩溃 / 正常被 kill 都会走到这里；主进程绝不陪葬
    child.on("exit", (code: number) => {
      die(new Error(`${this.label} 语音引擎进程退出（code=${code}）`));
    });
    child.once("spawn", () => {
      this.spawned = true;
      try {
        child.postMessage({ __init: true, workerData: this.workerData });
        for (const message of this.outbox) child.postMessage(message);
      } catch (error: any) {
        die(new Error(`${this.label} 语音引擎启动失败：${error?.message ?? error}`));
        return;
      }
      this.outbox = [];
    });
  }

  get alive(): boolean {
    return Boolean(this.child) && !this.dead;
  }

  /** 串行执行一次请求。 */
  request(op: string, payload: Record<string, unknown> = {}): Promise<any> {
    const run = () => {
      if (this.dead) return Promise.reject(new Error(`${this.label} 语音引擎不可用`));
      this.start();
      if (!this.child) return Promise.reject(new Error(`${this.label} 语音引擎未启动`));
      const id = this.counter++;
      const message = { id, op, ...payload };
      return new Promise<any>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        try {
          if (this.spawned) this.child.postMessage(message);
          else this.outbox.push(message); // spawn 前缓存，spawn 后按序补发
        } catch (error: any) {
          this.pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    };
    // 串成一条链：保证同一时刻只有一个推理在跑
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  async terminate(): Promise<void> {
    const child = this.child;
    this.dead = true;
    this.child = null;
    for (const [, entry] of this.pending) entry.reject(new Error(`${this.label} 语音引擎已关闭`));
    this.pending.clear();
    try {
      child?.kill?.();
    } catch {
      /* 关闭失败无所谓 */
    }
  }
}

/** 解析原生模块入口的绝对路径；未安装时返回空串（调用方据此提示「未就绪」）。 */
export function resolveSherpaPath(): string {
  try {
    return require.resolve("sherpa-onnx-node");
  } catch {
    return "";
  }
}
