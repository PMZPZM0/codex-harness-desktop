/**
 * registerVoiceIpc1 —— registerVoiceIpc 按序切分出的第 1 段（纯搬迁、零改写）。
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { app, dialog, globalShortcut, shell, systemPreferences } from "electron";
import { VoiceService } from "../../voice/voice-service";
import { ALL_VOICE_REPOS, KWS_ARCHIVE, KWS_DIR, kwsReady, ZIPVOICE_ARCHIVE, ZIPVOICE_DIR, zipvoiceReady } from "../../voice/model-manifest";
import { ensureEmotivoice, ensureKokoro, ensureZipvoice, modelsSizeOnDisk, voiceModelsStatus } from "../../voice/model-store";
import { EMOTIVOICE_DIR, EMOTIVOICE_FILES, EMOTIVOICE_HOST_NOTE, KOKORO_ARCHIVE, KOKORO_DIR, emotivoiceReady, kokoroReady } from "../../voice/model-manifest";
import { isVoiceResourceEnabled, loadVoiceSettings, voiceResourceStates } from "../../voice/voice-settings";
import { toolsRoot, writeToolsRoot } from "../../toolchain";
import { sendToWindow } from "../window-bus";
import { defineFeature } from "../../context";
import type { IpcHost } from "../../ipc-host";
import type { HostCaps } from "../../runtime/seams";
import { voiceService, voiceModelsRoot } from "../../runtime-refs";

/* ⛔⛔ 播报引擎就绪缓存（10-31，用户：「我没有下载语音模型啊，怎么开开关语音播报」）：
   主进程把「语音播报开关」的当前值写进常驻指令（`12-skill-discipline.ts` 的 announceEnabled），
   模型据此在回复里宣称「我会把关键结论念给你」。但**引擎没装时那句宣称是假的** ——
   真播只会静默失败（没有 TTS，连报错都没有）。所以下发给模型之前必须先看引擎。
   ⛔ 为什么用缓存：拼指令是同步的（每轮都可能跑），而 `voiceModelsStatus` 要扫盘 + 校验文件。
     开机预热一次、每次 `voice:models-status`（渲染层探针/设置页都会调）顺带刷新即可。
   ⛔ 未知时按 **就绪** 处理（null → true）：宁可多写一段被剥掉的稿子，
     也别因为一次没探到就把正常用户的播报静音。 */
let announceReadyCache: boolean | null = null;

/** 供拼常驻指令同步读取（`?? true` 的语义见上）。 */
export function announceEngineReadyCached(): boolean {
  return announceReadyCache ?? true;
}

/** 扫一次磁盘刷新缓存；失败保持原值（⛔ 不要因为读不到就翻成"不可用"）。 */
export async function refreshAnnounceEngineReady(): Promise<void> {
  try {
    const root = requireVoiceModelsRoot();
    const st = await voiceModelsStatus(root, ALL_VOICE_REPOS);
    const base = st.totalFiles > 0 ? st.readyFiles === st.totalFiles : st.ready;
    /* 任一套可用即算就绪（用户可以只装 Kokoro）。情感语音的 runnable 恒 false（缺 onnxruntime），
       这里按"装了也合成不出来"处理 ⇒ 不计入就绪，与设置页那张卡的口径一致。 */
    announceReadyCache = base || kokoroReady(root);
  } catch { /* 保持原值 */ }
}

/**
 * 取 voiceService 单例（10-03 由 main.ts 构造完成后经 runtime-refs 注入）。
 *
 * ⛔ 未注入时**明确抛错**而不是返回 null：域注册在组合表挂载时，而 `new VoiceService()`
 *   在 main.ts 后段 ⇒ 正常启动顺序下这里一定拿得到。拿不到说明启动链被改坏了
 *   （例如有人把 setVoiceService 删了），此时静默返回 null 会让所有语音 handler
 *   在**用户点下按钮那一刻**才炸在别处，极难归因 —— 宁可现在就失败。
 */
function requireVoiceService(): VoiceService {
  if (!voiceService) throw new Error("voice: 语音服务尚未初始化（main.ts 应在启动链里调 setVoiceService）");
  return voiceService;
}
/** 同上：模型根目录必须已注入（它由 app.getPath("userData") 派生，模块体求值会拿到错值）。 */
function requireVoiceModelsRoot(): string {
  if (!voiceModelsRoot) throw new Error("voice: 模型根目录尚未注入（main.ts 应调 setVoiceModelsRoot）");
  return voiceModelsRoot;
}

export function registerVoiceIpc1(deps: { ipcHost: IpcHost; host: HostCaps }) {
  const { ipcHost, host } = deps;
  /**
   * ⛔⛔ `svc()` / `modelsRoot()` **必须延后取**（10-03）：组合表 import 在 main.ts
   *   前部，而 `new VoiceService(...)` 在其后数百行 ⇒ 挂载时这两个值还不存在。
   *   若在函数签名里解构捕获，会永久拿到 null，症状是「语音一点反应都没有」且无任何报错。
   *   每次使用时经基座门面现取 ⇒ 拿到的永远是当前实例。
   */
  const svc = (): VoiceService => requireVoiceService();
  const modelsRoot = (): string => requireVoiceModelsRoot();
  /** 语音模型安装的并发与取消由 voiceService 内部管（installController），主进程不再包一层。 */
  ipcHost.handle("voice:status", () => svc().status());

  ipcHost.handle("voice:settings-get", () => {
    const { loadVoiceSettings, ttsVoiceNamesFor, MODEL_HOST_PRESETS, MODEL_HOST_LABELS } = require("../../voice/voice-settings");
    const settings = svc().getSettings();
    // 把枚举的可选值一起回传，渲染层不用自己硬码
    return {
      settings,
      /* ⛔ 音色表必须**跟着引擎走**：Kokoro 是 103 个音色，vits 是 5 个。
         给错表 = 用户在下拉里选到不存在的音色（vits 的 sid=42 在 kokoro 里是另一个声音）。 */
      ttsVoices: ttsVoiceNamesFor(settings.tts?.engine),
      modelHosts: MODEL_HOST_LABELS,
      modelHostOptions: Object.keys(MODEL_HOST_PRESETS),
    };
  });

  ipcHost.handle("voice:settings-set", async (_event, patch: any) => {
    const { saveVoiceSettings } = require("../../voice/voice-settings");
    const prevEngine = svc().getSettings()?.tts?.engine;
    const next = saveVoiceSettings(app.getPath("userData"), patch ?? {});
    svc().updateSettings(next);
    /* ⛔ 换了引擎 ⇒ 必须重建合成线程：TTS 模型在 worker `create` 时就固定了
       （vits 的 model.onnx 与 kokoro 的 model.int8.onnx 是两套），
       光改设置的话用户听到的还是旧引擎的声音。 */
    if (next.tts?.engine !== prevEngine) {
      await svc().reloadTtsVoice().catch(() => undefined);
    }
    // ★ 广播出去：语音唤醒这类「按设置常驻」的能力必须能**立刻**重挂。
    //   旧实现：VoiceCallFloat 的唤醒 effect 只在 phase 变化时读一次设置 →
    //   在设置页打开开关后毫无反应（用户 09-13 反馈「唤醒功能不太行」的直接原因之一）。
    sendToWindow("voice:event", { type: "settings", settings: next });
    return next;
  });

  ipcHost.handle("voice:start", async (event, threadId: string, options?: { mode?: "conversation" | "dictation" }) => {
    // ⛔ 全局互斥（09-13 用户要求）：语音通话是**全应用唯一**的（麦克风/ASR/TTS 线程只有一份），
    // 多窗口下每个窗口都渲染了自己的悬浮球——A 窗口通话中，B 窗口再点会被 svc()
    // 静默复用（`if (this.active) return ok`），把 B 的会话绑不上、音频还全喂给了 A 的通话。
    // 规则：同一会话重复 start = 恢复语义放行；不同会话 → 明确拒绝，前端据此把悬浮球置灰。
    const status = svc().status();
    const requestedThread = String(threadId ?? "");
    if (status.active && status.threadId && requestedThread && status.threadId !== requestedThread) {
      return { ok: false, busy: true, error: "另一个窗口正在语音通话中，请先挂断那边的通话再试" };
    }
    const result = await svc().start({ threadId: requestedThread, mode: options?.mode });
    return { ...result, status: svc().status() };
  });

  ipcHost.handle("voice:dictation-finish", async () => svc().finishDictation());
  /** 提前端点（审计 ④）：渲染层判定「句末标点 + 停口 0.5s」时调用，立即提交这一句 */
  ipcHost.handle("voice:endpoint-now", async () => svc().endpointNow());
  ipcHost.handle("voice:stop", async () => {
    await svc().stop();
    return { ok: true, status: svc().status() };
  });

  // 音频块走 send（不等回包），避免每 64ms 一次 IPC 往返带来的抖动
  // ⛔ 10-03：用 `ipcHost.on`（单向监听）而非 `ipcMain.on` —— 后者无法被插件卸载摘除。
  ipcHost.on("voice:audio", (_event, samples: Float32Array) => {
    void svc().handleAudio(samples).catch((error) => console.error("[voice] audio:", error));
  });

  /**
   * TTS 音频跨 Electron IPC 的安全封装。
   * Float32Array 直接从 worker/native 一路返回给 renderer 时，Electron 的 structured clone
   * 会拒绝某些 external backing store（"External buffers are not allowed"）。
   * 所以主进程统一转 Base64 字符串：字符串 IPC 最稳定，渲染层再还原 Float32Array。
   */
  function voiceAudioForIpc(result: Awaited<ReturnType<VoiceService["speak"]>>):
    | { ok: true; sampleRate: number; audioBase64: string }
    | { ok: false; error: string } {
    if (!result.ok) return result;
    const samples = result.samples;
    const bytes = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
    return {
      ok: true,
      sampleRate: result.sampleRate,
      audioBase64: bytes.toString("base64"),
    };
  }

  ipcHost.handle("voice:speak", async (_event, text: string, options?: { sid?: number; speed?: number; numSteps?: number }) => {
    return voiceAudioForIpc(await svc().speak(String(text ?? ""), options));
  });
  ipcHost.handle("voice:preview-voice", async (_event, input?: { sid?: number; speed?: number; text?: string; profileId?: string; warm?: boolean; numSteps?: number }) => {
    // 只预热（加载模型）不合成：播报端在开关打开/换音色时调用，避免第一句还等模型冷加载
    if (input?.warm) return svc().warmPreviewVoice();
    // 设置页「音色试听」：不必在通话中，内部会临时起一个 TTS worker，合成完即销毁
    return voiceAudioForIpc(await svc().previewVoice(input ?? {}));
  });

  // ── 语音通话「按键启动」：系统级快捷键（Electron globalShortcut）──
  // 用全局快捷键而不是页面内 keydown：即便应用没聚焦、焦点在别处也能唤起语音。
  let registeredVoiceHotkey = "";
  function applyVoiceHotkey(accelerator: string): { ok: boolean; error?: string } {
    try {
      if (!accelerator) {
        if (registeredVoiceHotkey) {
          globalShortcut.unregister(registeredVoiceHotkey);
          registeredVoiceHotkey = "";
        }
        return { ok: true };
      }
      // 同键重复设置直接视为成功（globalShortcut 对已注册的键二次 register 会失败，
      // 而设置页开关切换时会用同一个键反复 set）
      if (accelerator === registeredVoiceHotkey) return { ok: true };
      // 先注册新键、成功后才放旧键：反过来（先注销再注册）一旦新键被占用，
      // 旧键已没了、新键又没注册上，快捷键两头空——「改了一下就用不了」的主因之一
      const ok = globalShortcut.register(accelerator, () => {
        // 触发时把事件推给渲染层，由 VoiceCallFloat 决定开始/结束通话
        sendToWindow("voice:hotkey", { accelerator });
      });
      if (!ok) return { ok: false, error: `快捷键「${accelerator}」注册失败（可能被其它程序占用）` };
      if (registeredVoiceHotkey) globalShortcut.unregister(registeredVoiceHotkey);
      registeredVoiceHotkey = accelerator;
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  }
  // 启动时按已保存的设置注册一次
  app.whenReady().then(() => {
    const s = require("../../voice/voice-settings").loadVoiceSettings(app.getPath("userData"));
    if (s.hotkey?.enabled && s.hotkey.accelerator) applyVoiceHotkey(s.hotkey.accelerator);
  });
  ipcHost.handle("voice:hotkey-set", async (_event, input: { accelerator: string; enabled?: boolean }) => {
    const accelerator = input?.enabled === false ? "" : String(input?.accelerator ?? "");
    return applyVoiceHotkey(accelerator);
  });
  ipcHost.handle("voice:hotkey-get", () => ({ registered: registeredVoiceHotkey }));

  // ── 语音唤醒（持续聆听 + 文本匹配唤醒词）──
  ipcHost.handle("voice:wake-start", () => svc().startWakeListener());
  ipcHost.handle("voice:wake-audio", async (_event, samples: Float32Array) => svc().feedWakeAudio(samples));
  ipcHost.handle("voice:wake-reset", async () => { await svc().resetWakeStream(); return { ok: true }; });
  ipcHost.handle("voice:wake-stop", async () => { await svc().stopWakeListener(); return { ok: true }; });

  ipcHost.handle("voice:barge", () => svc().barge());

  ipcHost.handle("voice:playback-done", () => {
    svc().notifyPlaybackDone();
    return { ok: true };
  });

  ipcHost.handle("voice:models-status", async () => {
    const status = await voiceModelsStatus(modelsRoot(), ALL_VOICE_REPOS);
    /* 顺带刷新播报就绪缓存（同一个判据、同一次扫盘，不额外开销）—— 见文件顶部那段说明 */
    {
      const base = status.totalFiles > 0 ? status.readyFiles === status.totalFiles : status.ready;
      announceReadyCache = base || kokoroReady(modelsRoot());
    }
    // ⛔ 10-03：启用状态要与"是否就绪"**分开**回传 —— 两者正交：
    //    停用中的资源文件仍在磁盘（installed 仍为 true），只是不加载（enabled=false）。
    //    只回一个就必然丢信息：回 installed 会让「停用」显示成「已就绪」，
    //    回 enabled 会让「没下载」显示成「已停用」。渲染层靠这两个字段组合出四态。
    const settings = loadVoiceSettings(app.getPath("userData"));
    return {
      ...status,
      bytes: modelsSizeOnDisk(modelsRoot()),
      root: modelsRoot(),
      // 提示 UI「本地导入」该期望的目录结构（HF 仓库 id 很长，用户需要明确看到）
      repos: ALL_VOICE_REPOS.map((r) => ({ id: r.repo, lastSegment: r.repo.split("/").pop() ?? r.repo })),
      // 音色克隆模型（ZipVoice，归档型资源，单独安装）：UI 按它显示独立条目
      zipvoice: {
        ready: zipvoiceReady(modelsRoot()),
        enabled: isVoiceResourceEnabled(settings, "zipvoice"),
        bytes: ZIPVOICE_ARCHIVE.bytes + ZIPVOICE_ARCHIVE.vocoder.bytes,
        dir: ZIPVOICE_DIR,
      },
      // 语音唤醒关键词模型（KWS，归档型资源，单独安装）：唤醒卡片按它决定显示「一键下载」还是「已就绪」
      kws: {
        ready: kwsReady(modelsRoot()),
        enabled: isVoiceResourceEnabled(settings, "kws"),
        bytes: KWS_ARCHIVE.bytes,
        dir: KWS_DIR,
      },
      /* 10-26：两个可选**合成引擎**包（按需下载，与基础模型并存）。
         ⛔ emotivoice 的 `runnable` 单独回：模型能下载 ≠ 能合成（还缺通用 onnxruntime）。
            UI 必须照它给说法，不能点了没反应。 */
      kokoro: {
        ready: kokoroReady(modelsRoot()),
        enabled: isVoiceResourceEnabled(settings, "kokoro"),
        bytes: KOKORO_ARCHIVE.bytes,
        dir: KOKORO_DIR,
        runnable: true,
      },
      emotivoice: {
        ready: emotivoiceReady(modelsRoot()),
        enabled: isVoiceResourceEnabled(settings, "emotivoice"),
        bytes: EMOTIVOICE_FILES.reduce((sum, f) => sum + f.bytes, 0),
        dir: EMOTIVOICE_DIR,
        runnable: false,
        hostNote: EMOTIVOICE_HOST_NOTE,
      },
      // 基础模型：readyFiles/totalFiles 已说明装了多少，这里补启用状态
      baseEnabled: isVoiceResourceEnabled(settings, "base"),
      resources: voiceResourceStates(settings),
    };
  });

  /** 音色克隆模型的安装与取消（归档型资源：GitHub release 整包 + 声码器，按需下载）。 */
  let zipvoiceAbort: AbortController | null = null;
  ipcHost.handle("voice:zipvoice-install", async () => {
    // ⛔ 10-03：停用状态下拒绝下载。停用 = "暂时不要用但别删"，若还照下 156MB
    //    就成了"下完不用"，与用户预期相反，也会白耗流量。
    if (!isVoiceResourceEnabled(loadVoiceSettings(app.getPath("userData")), "zipvoice")) {
      return { ok: false, error: "音色克隆模型已被停用 —— 请先重新启用再下载" };
    }
    if (zipvoiceAbort) return { ok: false, error: "正在安装中" };
    zipvoiceAbort = new AbortController();
    try {
      const result = await ensureZipvoice(
        modelsRoot(),
        writeToolsRoot(),
        (progress) => sendToWindow("voice:event", { type: "download", ...progress, target: "zipvoice" }),
        zipvoiceAbort.signal,
      );
      sendToWindow("voice:event", { type: "downloadDone", ok: result.ok, error: result.ok ? undefined : (result as any).error, target: "zipvoice" });
      return result;
    } finally {
      zipvoiceAbort = null;
    }
  });
  ipcHost.handle("voice:zipvoice-cancel", () => {
    zipvoiceAbort?.abort();
    return { ok: true };
  });

  /* ── 10-26：可选**合成引擎**包（Kokoro / EmotiVoice）的按需下载 ──────────────
     两个引擎共用这一对通道（入参 `pack` 区分），避免每种资源都造一对通道把通道表撑爆。
     ⛔ 事件带 `target: pack`，渲染层按 target 归位到对应卡片。 */
  let packAbort: AbortController | null = null;
  ipcHost.handle("voice:tts-pack-install", async (_event: unknown, pack: string) => {
    if (pack !== "kokoro" && pack !== "emotivoice") return { ok: false, error: `未知的引擎包：${String(pack)}` };
    if (!isVoiceResourceEnabled(loadVoiceSettings(app.getPath("userData")), pack as any)) {
      return { ok: false, error: "该模型已被停用 —— 请先重新启用再下载" };
    }
    if (packAbort) return { ok: false, error: "正在安装中" };
    packAbort = new AbortController();
    try {
      const send = (progress: any) => sendToWindow("voice:event", { type: "download", ...progress, target: pack });
      const result = pack === "kokoro"
        ? await ensureKokoro(modelsRoot(), writeToolsRoot(), send, packAbort.signal)
        : await ensureEmotivoice(modelsRoot(), send);
      sendToWindow("voice:event", { type: "downloadDone", ok: result.ok, error: result.ok ? undefined : (result as any).error, target: pack });
      return result;
    } finally {
      packAbort = null;
    }
  });
  ipcHost.handle("voice:tts-pack-cancel", () => {
    packAbort?.abort();
    return { ok: true };
  });

  /**
   * 语音唤醒关键词模型（KWS，31MB 归档）：只服务「语音唤醒」，与三个主模型分开装 ——
   * 不装也能用（回退到识别模型匹配），装了才是不误唤醒 + 低 CPU 的那条路。
   */
  let kwsAbort: AbortController | null = null;
  ipcHost.handle("voice:kws-install", async () => {
    const { ensureKws } = require("../../voice/model-store");
    const { kwsReady } = require("../../voice/model-manifest");
    if (kwsReady(modelsRoot())) return { ok: true };
    // ⛔ 10-03：同上，停用状态下不下载（停用是"暂时不用"，不是"照下但不用"）
    if (!isVoiceResourceEnabled(loadVoiceSettings(app.getPath("userData")), "kws")) {
      return { ok: false, error: "语音唤醒模型已被停用 —— 请先重新启用再下载" };
    }
    if (kwsAbort) return { ok: false, error: "正在安装中" };
    kwsAbort = new AbortController();
    try {
      const result = await ensureKws(
        modelsRoot(),
        writeToolsRoot(),
        (progress: any) => sendToWindow("voice:event", { type: "download", ...progress, target: "kws" }),
        kwsAbort.signal,
      );
      sendToWindow("voice:event", { type: "downloadDone", ok: result.ok, error: result.ok ? undefined : (result as any).error, target: "kws" });
      // 装好了让唤醒用上关键词模型：唤醒词没变也要重挂（引擎从 asr 换成 kws）
      if (result.ok && svc().wakeListening()) {
        await svc().stopWakeListener();
        await svc().startWakeListener();
      }
      return result;
    } finally {
      kwsAbort = null;
    }
  });
  ipcHost.handle("voice:kws-cancel", () => {
    kwsAbort?.abort();
    return { ok: true };
  });
  ipcHost.handle("voice:kws-status", () => {
    const { kwsReady } = require("../../voice/model-manifest");
    return { ready: kwsReady(modelsRoot()) };
  });
  // ⛔ bag 必须把 ipcHost / host 传给 2、3 段 —— 它们只拿 ibA（顺序即契约，不许另开参数）。
  //    漏传的症状很隐蔽：2/3 段里 `ipcHost` 是 undefined，tsc 直接报而不是运行时报。
  return { ipcHost, host, svc, modelsRoot, voiceAudioForIpc, registeredVoiceHotkey, applyVoiceHotkey, zipvoiceAbort, kwsAbort };
}
