/**
 * 语音通话编排（主进程）。
 *
 * 职责边界（刻意做窄）：
 * - 只做「编排」：把识别文本交给引擎、把引擎回复的增量转给渲染层、把待朗读的句子交给 TTS 工作线程。
 * - **不碰现有输入链路**：不修改发送/排队/权限/会话的任何既有行为，只复用 `turn/start`、
 *   `thread/queue/add`、`turn/interrupt` 这三个已有协议入口。
 * - 采集、回声消除、回声门控、断句、播放全部在渲染层（那里才有采样对齐的播放参考信号）。
 *
 * 生命周期：`start()` 建工作线程 → 通话中 `handleAudio` / `speak` → `stop()` 彻底释放。
 * 挂断后不残留任何常驻监听、线程或麦克风占用。
 */

import { ASR_REPO, TTS_REPO, VAD_REPO } from "./model-manifest";
import { ensureRepo, isRepoReady, modelFilePath, probeHosts, repoDir } from "./model-store";
import { DEFAULT_VOICE_SETTINGS, MODEL_HOST_PRESETS, loadVoiceSettings, type VoiceSettings } from "./voice-settings";
import { ASR_WORKER_SOURCE, TTS_WORKER_SOURCE, VoiceWorkerClient, resolveSherpaPath } from "./workers";

const SAMPLE_RATE = 16000;

/** 语音轮的推理档位：通话场景优先低延迟（自定义模型档位是 low/medium/high）。 */
const VOICE_EFFORT = "low";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

export type VoiceEvent =
  | { type: "state"; state: VoiceState }
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "delta"; text: string }
  | { type: "turnDone"; text: string }
  | { type: "error"; message: string }
  | { type: "download"; repo?: string; file?: string; repoIndex?: number; repoTotal?: number; percent: number; message: string }
  | { type: "downloadDone"; ok: boolean; error?: string };

export type VoiceSpeakResult =
  | { ok: true; sampleRate: number; samples: Float32Array }
  | { ok: false; error: string };

export type VoiceStatus = {
  /** 通话是否进行中 */
  active: boolean;
  state: VoiceState;
  /** 原生推理运行时是否可用（sherpa-onnx 装没装） */
  runtimeReady: boolean;
  /** 模型是否齐备 */
  modelsReady: boolean;
  /** 当前绑定的会话 */
  threadId: string;
  /** 最近一次错误（用于 UI 提示） */
  lastError: string;
};

type Deps = {
  server: { request: (method: string, params?: unknown) => Promise<any> };
  getModel: () => Promise<{ provider: string; name: string; model: string; baseUrl: string } | null>;
  modelsRoot: string;
  userDataDir: string;
  log: (level: "info" | "error", message: string) => void;
  emit: (event: VoiceEvent) => void;
};

export class VoiceService {
  private asr: VoiceWorkerClient | null = null;
  private tts: VoiceWorkerClient | null = null;
  private threadId = "";
  private state: VoiceState = "idle";
  private active = false;
  private lastError = "";
  private currentTurnId = "";
  private busy = false;
  private turnText = "";
  /** 本回合是否已经提交过一次识别结果（避免同一句重复提交） */
  private submittedThisUtterance = false;

  constructor(private readonly deps: Deps) {}

  status(): VoiceStatus {
    return {
      active: this.active,
      state: this.state,
      runtimeReady: Boolean(resolveSherpaPath()),
      modelsReady: this.modelsReadyFlag,
      threadId: this.threadId,
      lastError: this.lastError,
    };
  }

  private modelsReadyFlag = false;
  /** 用户设置（音色/语速/打断/镜像源）—— start() 时从磁盘读，updateSettings 后热更新。 */
  private currentSettings: VoiceSettings = DEFAULT_VOICE_SETTINGS;
  /** 模型下载的 AbortController；正在下载时存在，点取消后 abort 并清空。 */
  private installController: AbortController | null = null;

  /** 模型是否齐备（启动时算一次；安装完模型后可再调）。 */
  async refreshModelsReady(): Promise<boolean> {
    try {
      const [asr, vad, tts] = await Promise.all([
        isRepoReady(this.deps.modelsRoot, ASR_REPO),
        isRepoReady(this.deps.modelsRoot, VAD_REPO),
        isRepoReady(this.deps.modelsRoot, TTS_REPO),
      ]);
      this.modelsReadyFlag = asr && vad && tts;
    } catch {
      this.modelsReadyFlag = false;
    }
    return this.modelsReadyFlag;
  }

  private setState(next: VoiceState) {
    if (this.state === next) return;
    this.state = next;
    this.deps.emit({ type: "state", state: next });
  }

  private fail(message: string) {
    this.lastError = message;
    this.deps.log("error", `语音通话：${message}`);
    this.deps.emit({ type: "error", message });
  }

  /** 开始通话：校验运行时与模型 → 建工作线程。 */
  async start(input: { threadId: string }): Promise<{ ok: boolean; error?: string }> {
    if (this.active) return { ok: true };
    this.lastError = "";
    // 每次 start 都重读一次设置——用户在设置页改了镜像源/音色，下一次通话立刻生效
    this.currentSettings = loadVoiceSettings(this.deps.userDataDir);

    const sherpaPath = resolveSherpaPath();
    if (!sherpaPath) {
      const message = "语音运行时未就绪（sherpa-onnx 未安装），请重新安装应用或联系支持";
      this.fail(message);
      return { ok: false, error: message };
    }
    if (!(await this.refreshModelsReady())) {
      const message = "语音模型未下载完整，请先在通话面板点「下载模型」";
      this.fail(message);
      return { ok: false, error: message };
    }

    this.threadId = input.threadId;
    const numThreads = 2;
    try {
      this.asr = new VoiceWorkerClient(
        "语音识别",
        ASR_WORKER_SOURCE,
        {
          sherpaPath,
          sampleRate: SAMPLE_RATE,
          encoder: modelFilePath(this.deps.modelsRoot, ASR_REPO.repo, "encoder.int8.onnx"),
          decoder: modelFilePath(this.deps.modelsRoot, ASR_REPO.repo, "decoder.onnx"),
          joiner: modelFilePath(this.deps.modelsRoot, ASR_REPO.repo, "joiner.int8.onnx"),
          tokens: modelFilePath(this.deps.modelsRoot, ASR_REPO.repo, "tokens.txt"),
          numThreads,
          // 端点检测：说完静音多久算一句结束
          rule1: 2.4,
          rule2: 1.2,
          rule3: 20,
        },
        () => {
          if (this.active) this.fail("语音识别线程意外退出，请重新开始通话");
        }
      );
      this.tts = new VoiceWorkerClient(
        "语音合成",
        TTS_WORKER_SOURCE,
        {
          sherpaPath,
          model: modelFilePath(this.deps.modelsRoot, TTS_REPO.repo, "model.onnx"),
          lexicon: modelFilePath(this.deps.modelsRoot, TTS_REPO.repo, "lexicon.txt"),
          tokens: modelFilePath(this.deps.modelsRoot, TTS_REPO.repo, "tokens.txt"),
          numThreads,
        },
        () => {
          if (this.active) this.fail("语音合成线程意外退出，请重新开始通话");
        }
      );
      // 先建起来，把模型加载的耗时挡在通话之前（失败会在下面被捕获）
      await this.asr.request("create");
      await this.tts.request("create");
    } catch (error: any) {
      await this.stop();
      const message = `语音模型加载失败：${error?.message ?? error}`;
      this.fail(message);
      return { ok: false, error: message };
    }

    this.active = true;
    this.submittedThisUtterance = false;
    this.setState("listening");
    this.deps.log("info", `语音通话已开始（会话 ${this.threadId}）`);
    return { ok: true };
  }

  /** 结束通话：释放工作线程与全部状态。 */
  async stop(): Promise<void> {
    const asr = this.asr;
    const tts = this.tts;
    this.asr = null;
    this.tts = null;
    this.active = false;
    this.busy = false;
    this.currentTurnId = "";
    this.turnText = "";
    this.threadId = "";
    this.setState("idle");
    await Promise.allSettled([asr?.terminate(), tts?.terminate()]);
  }

  /**
   * 送入一块 16k 单声道 PCM。识别是流式的：每块都会回一个 partial，
   * 端点检测命中（用户说完了）就提交给引擎。
   */
  async handleAudio(samples: Float32Array): Promise<void> {
    if (!this.active || !this.asr) return;
    let result: any;
    try {
      result = await this.asr.request("feed", { samples });
    } catch (error: any) {
      this.fail(`识别失败：${error?.message ?? error}`);
      return;
    }
    const text = String(result?.text ?? "");
    if (text) this.deps.emit({ type: "partial", text });

    if (result?.endpoint) {
      await this.finishUtterance(text);
    }
  }

  /** 用户说完了：把这一句交给引擎。 */
  private async finishUtterance(text: string): Promise<void> {
    const utterance = text.trim();
    // 重置流，下一句从头开始
    void this.asr?.request("reset").catch(() => undefined);
    if (!utterance) return;
    if (this.submittedThisUtterance) return;
    this.submittedThisUtterance = true;
    setTimeout(() => {
      this.submittedThisUtterance = false;
    }, 500);

    this.deps.emit({ type: "final", text: utterance });
    try {
      await this.submitTurn(utterance);
    } catch (error: any) {
      this.fail(`提交失败：${error?.message ?? error}`);
    }
  }

  private async submitTurn(text: string): Promise<void> {
    const model = await this.deps.getModel();
    if (!model) throw new Error("尚未配置模型，无法对话");
    const threadId = this.threadId;
    if (!threadId) throw new Error("通话未绑定会话");
    const input = [{ type: "text", text, text_elements: [] }];

    this.setState("thinking");
    this.turnText = "";
    if (this.busy) {
      // 上一轮还没跑完：排队，不打断
      await this.deps.server.request("thread/queue/add", {
        threadId,
        input,
        clientUserMessageId: `voice-${Date.now()}`,
      });
      this.deps.log("info", "语音消息已加入队列");
      return;
    }
    await this.deps.server.request("turn/start", {
      threadId,
      input,
      model: model.model,
      effort: VOICE_EFFORT,
      personality: "pragmatic",
    });
    this.deps.log("info", "语音消息已提交给引擎");
  }

  /** 引擎事件：只关心正文增量与回合生命周期（思考/工具内容不朗读）。 */
  handleCodexEvent(event: any): void {
    if (!this.active) return;
    if (event?.kind !== "notification") return;
    const params = event.params ?? {};
    if (params.threadId && this.threadId && String(params.threadId) !== this.threadId) return;

    if (event.method === "turn/started") {
      this.busy = true;
      this.currentTurnId = String(params?.turn?.id ?? "");
      return;
    }
    if (event.method === "item/agentMessage/delta") {
      const delta = String(params.delta ?? "");
      if (!delta) return;
      this.turnText += delta;
      this.deps.emit({ type: "delta", text: delta });
      return;
    }
    if (event.method === "turn/completed") {
      this.busy = false;
      this.currentTurnId = "";
      const finalText =
        [...(params?.turn?.items ?? [])].reverse().find((item: any) => item.type === "agentMessage")?.text ??
        this.turnText;
      this.turnText = "";
      this.deps.emit({ type: "turnDone", text: String(finalText ?? "") });
      if (this.active) this.setState("listening");
    }
  }

  /** 合成一句话（渲染层按句调用，实现边生成边播）。 */
  async speak(text: string, options?: { sid?: number; speed?: number }): Promise<VoiceSpeakResult> {
    if (!this.tts) return { ok: false, error: "语音合成未就绪" };
    const clean = String(text ?? "").trim();
    if (!clean) return { ok: false, error: "空文本" };
    try {
      const result = await this.tts.request("speak", {
        text: clean,
        // 默认走设置里的音色/语速，调用方传了 options 就覆盖（便于临时切换）
        sid: options?.sid ?? this.currentSettings.tts.sid,
        speed: options?.speed ?? this.currentSettings.tts.speed,
      });
      this.setState("speaking");
      return { ok: true, sampleRate: Number(result.sampleRate ?? 22050), samples: result.samples };
    } catch (error: any) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  }

  /** 播报结束（渲染层播放队列排空时调用，用于把状态切回聆听）。 */
  notifyPlaybackDone(): void {
    if (this.active && this.state === "speaking") this.setState("listening");
  }

  /**
   * 开口打断：立即中断当前回合。TTS 队列由渲染层清空。
   * 半截回复会保留在会话里（引擎行为），用户的新话会自然续上。
   */
  async barge(): Promise<{ ok: boolean }> {
    if (!this.active) return { ok: false };
    const threadId = this.threadId;
    const turnId = this.currentTurnId;
    this.setState("listening");
    if (!threadId || !turnId) return { ok: true };
    try {
      await this.deps.server.request("turn/interrupt", { threadId, turnId });
      this.deps.log("info", "用户插话，已中断当前回合");
    } catch (error: any) {
      this.deps.log("error", `中断失败：${error?.message ?? error}`);
    }
    return { ok: true };
  }

  /** 模型目录（供 UI 显示）。 */
  get modelsDir(): string {
    return repoDir(this.deps.modelsRoot, ASR_REPO.repo);
  }

  /** 读取当前设置（从磁盘，保证与设置页最新状态一致）。 */
  getSettings(): VoiceSettings {
    return loadVoiceSettings(this.deps.userDataDir);
  }

  /** 设置页保存后由主进程调用，内存立刻更新（下次 speak/start 用新值）。 */
  updateSettings(patch: Partial<VoiceSettings>): VoiceSettings {
    const next = loadVoiceSettings(this.deps.userDataDir);
    this.currentSettings = { ...next, ...patch };
    // 落盘由 main.ts 统一负责（IPC handler 调 saveVoiceSettings），这里只同步内存
    return this.currentSettings;
  }

  /**
   * 下载/校验所有语音模型。按用户当前设置里的镜像源顺序试，失败再降级。
   * 进度逐仓库回报（与原 voice:models-install 行为一致）。
   */
  async installModels(): Promise<{ ok: boolean; error?: string }> {
    if (this.installController) return { ok: false, error: "模型正在下载中" };
    this.installController = new AbortController();
    const signal = this.installController.signal;
    const settings = loadVoiceSettings(this.deps.userDataDir);
    // "auto" 保留 MODEL_HOST_PRESETS 里的两个候选 + 互降级；
    // "huggingface" / "hf-mirror" 只用对应单源（如果用户强制了）。
    // 任一情形下，ensureRepo 内部已自带镜像轮换兜底（但单源时不会轮换）。
    // 为稳妥，给所有情形都传"主 + 兜底"（单源时 = 同源重复，无害）。
    const primary = MODEL_HOST_PRESETS[settings.modelHost];
    const fallback = primary[0] === "https://huggingface.co" ? ["https://hf-mirror.com"] : ["https://huggingface.co"];
    const hosts = primary[0] === fallback[0] ? primary : [...primary, ...fallback];

    let result: { ok: boolean; error?: string } = { ok: true };
    const repos = [ASR_REPO, VAD_REPO, TTS_REPO];

    // 自动镜像模式：先并发探测各镜像，**按延迟从快到慢**排好 host 列表——
    // 国内 hf-mirror 走阿里 CDN 延迟低，海外 huggingface.co 直连更快，
    // 实测：自动选最优的下载时间比固定主源少 2~5×。强制模式（仅 HF / 仅 mirror）不做探测。
    let activeHosts = hosts;
    if (settings.modelHost === "auto") {
      try {
        const probed = await probeHosts(hosts, repos[0], { signal });
        if (probed.length > 0) activeHosts = probed.map((p) => p.host);
        this.deps.log("info", `镜像测速：${activeHosts.join(" → ")}`);
      } catch (e: any) {
        this.deps.log("info", `镜像测速失败，按默认顺序：${e?.message ?? e}`);
      }
    }

    for (const repo of repos) {
      if (signal.aborted) { result = { ok: false, error: "已取消" }; break; }
      const repoFailures = await ensureRepo(
        this.deps.modelsRoot,
        repo,
        (progress) => this.deps.emit({ type: "download", ...progress }),
        { hosts: activeHosts, concurrency: 4, signal }
      );
      if (signal.aborted) { result = { ok: false, error: "已取消" }; break; }
      if (repoFailures.length) {
        result = { ok: false, error: repoFailures.slice(0, 3).join("；") };
        // 不 break：让其它仓库至少跑完，避免部分下载被白白废掉
      }
    }
    await this.refreshModelsReady();
    this.deps.emit({ type: "download", percent: 100, message: signal.aborted ? "已取消" : "完成" });
    this.deps.emit({ type: "downloadDone", ok: result.ok, error: result.error });
    this.installController = null;
    return result;
  }

  /** 取消正在进行的模型下载（幂等，无任务时返回 false）。 */
  cancelInstall(): boolean {
    if (!this.installController) return false;
    this.installController.abort();
    return true;
  }
}
