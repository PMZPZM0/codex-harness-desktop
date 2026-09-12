/**
 * 语音工作线程（ASR / TTS）与其主进程客户端。
 *
 * 为什么必须是工作线程：ONNX 推理是 CPU 密集的，放在主进程会**卡住整个应用的 IPC**，
 * 表现为界面假死。工作线程里跑，主进程只做编排。
 *
 * 为什么用 `eval` 而不是 `new Worker(文件路径)`：打包后代码在 `app.asar` 内，
 * 而 Node 的 worker_threads 走 C++ 层读文件、**不经过 Electron 对 asar 的补丁**，
 * 直接给 asar 内路径会加载失败。改为把源码字符串交给 worker 执行即可绕开。
 * （另：eval 模式下**不允许顶层 return**，worker 源码必须写成语句块安全的写法。）
 *
 * 原生模块路径由主进程 `require.resolve` 后经 workerData 传入，worker 内不做裸名解析——
 * 这样在开发态与打包态都指向同一份真实路径。
 */

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
      // 长按听写松手时不一定已命中 endpoint；补 3 秒静音把尾句完整解出来。
      const silence = new Float32Array(workerData.sampleRate * 3);
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

export const TTS_WORKER_SOURCE = `
const { parentPort, workerData } = require("worker_threads");
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

/**
 * 工作线程客户端：串行请求 + 死亡回调。
 * 串行是刻意的——同一时刻只该有一个推理在跑，否则会互相抢 CPU。
 */
export class VoiceWorkerClient {
  private worker: any = null;
  private counter = 0;
  private pending = new Map<number, PendingEntry>();
  private chain: Promise<any> = Promise.resolve();
  private dead = false;
  private readonly onDeath: () => void;

  constructor(
    private readonly label: string,
    private readonly source: string,
    private readonly workerData: Record<string, unknown>,
    onDeath?: () => void
  ) {
    this.onDeath = onDeath ?? (() => undefined);
  }

  start(): void {
    if (this.worker || this.dead) return;
    // 延迟 require：worker_threads 只在真正用语音时才加载
    const { Worker } = require("worker_threads");
    this.worker = new Worker(this.source, { eval: true, workerData: this.workerData });
    this.worker.on("message", (msg: any) => {
      const entry = this.pending.get(msg?.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.ok) entry.resolve(msg);
      else entry.reject(new Error(String(msg.error ?? "worker 失败")));
    });
    const die = (error: Error) => {
      if (this.dead) return;
      this.dead = true;
      for (const [, entry] of this.pending) entry.reject(error);
      this.pending.clear();
      this.worker = null;
      this.onDeath();
    };
    this.worker.on("error", (error: any) => die(new Error(`${this.label} 工作线程异常：${error?.message ?? error}`)));
    this.worker.on("exit", () => die(new Error(`${this.label} 工作线程已退出`)));
  }

  get alive(): boolean {
    return Boolean(this.worker) && !this.dead;
  }

  /** 串行执行一次请求。 */
  request(op: string, payload: Record<string, unknown> = {}): Promise<any> {
    const run = () => {
      if (this.dead) return Promise.reject(new Error(`${this.label} 工作线程不可用`));
      this.start();
      if (!this.worker) return Promise.reject(new Error(`${this.label} 工作线程未启动`));
      const id = this.counter++;
      return new Promise<any>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        try {
          this.worker.postMessage({ id, op, ...payload });
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
    const worker = this.worker;
    this.dead = true;
    this.worker = null;
    for (const [, entry] of this.pending) entry.reject(new Error(`${this.label} 工作线程已关闭`));
    this.pending.clear();
    try {
      await worker?.terminate?.();
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
