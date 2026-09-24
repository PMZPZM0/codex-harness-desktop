/**
 * registerVoiceIpc1 —— registerVoiceIpc 按序切分出的第 1 段（纯搬迁、零改写）。
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { app, dialog, globalShortcut, ipcMain, shell, systemPreferences } from "electron";
import { VoiceService } from "../../voice/voice-service";
import { ALL_VOICE_REPOS, KWS_ARCHIVE, KWS_DIR, kwsReady, ZIPVOICE_ARCHIVE, ZIPVOICE_DIR, zipvoiceReady } from "../../voice/model-manifest";
import { ensureZipvoice, modelsSizeOnDisk, voiceModelsStatus } from "../../voice/model-store";
import { toolsRoot } from "../../toolchain";
import { sendToWindow } from "../window-bus";

export function registerVoiceIpc1(deps: { voiceService: VoiceService; voiceModelsRoot: string }) {
  const { voiceService, voiceModelsRoot } = deps;
  /** 语音模型安装的并发与取消由 voiceService 内部管（installController），主进程不再包一层。 */
  ipcMain.handle("voice:status", () => voiceService.status());

  ipcMain.handle("voice:settings-get", () => {
    const { loadVoiceSettings, TTS_VOICE_NAMES, MODEL_HOST_PRESETS, MODEL_HOST_LABELS } = require("../../voice/voice-settings");
    const settings = voiceService.getSettings();
    // 把枚举的可选值一起回传，渲染层不用自己硬码
    return {
      settings,
      ttsVoices: TTS_VOICE_NAMES,
      modelHosts: MODEL_HOST_LABELS,
      modelHostOptions: Object.keys(MODEL_HOST_PRESETS),
    };
  });

  ipcMain.handle("voice:settings-set", async (_event, patch: any) => {
    const { saveVoiceSettings } = require("../../voice/voice-settings");
    const next = saveVoiceSettings(app.getPath("userData"), patch ?? {});
    voiceService.updateSettings(next);
    // ★ 广播出去：语音唤醒这类「按设置常驻」的能力必须能**立刻**重挂。
    //   旧实现：VoiceCallFloat 的唤醒 effect 只在 phase 变化时读一次设置 →
    //   在设置页打开开关后毫无反应（用户 09-13 反馈「唤醒功能不太行」的直接原因之一）。
    sendToWindow("voice:event", { type: "settings", settings: next });
    return next;
  });

  ipcMain.handle("voice:start", async (event, threadId: string, options?: { mode?: "conversation" | "dictation" }) => {
    // ⛔ 全局互斥（09-13 用户要求）：语音通话是**全应用唯一**的（麦克风/ASR/TTS 线程只有一份），
    // 多窗口下每个窗口都渲染了自己的悬浮球——A 窗口通话中，B 窗口再点会被 voiceService
    // 静默复用（`if (this.active) return ok`），把 B 的会话绑不上、音频还全喂给了 A 的通话。
    // 规则：同一会话重复 start = 恢复语义放行；不同会话 → 明确拒绝，前端据此把悬浮球置灰。
    const status = voiceService.status();
    const requestedThread = String(threadId ?? "");
    if (status.active && status.threadId && requestedThread && status.threadId !== requestedThread) {
      return { ok: false, busy: true, error: "另一个窗口正在语音通话中，请先挂断那边的通话再试" };
    }
    const result = await voiceService.start({ threadId: requestedThread, mode: options?.mode });
    return { ...result, status: voiceService.status() };
  });

  ipcMain.handle("voice:dictation-finish", async () => voiceService.finishDictation());
  /** 提前端点（审计 ④）：渲染层判定「句末标点 + 停口 0.5s」时调用，立即提交这一句 */
  ipcMain.handle("voice:endpoint-now", async () => voiceService.endpointNow());
  ipcMain.handle("voice:stop", async () => {
    await voiceService.stop();
    return { ok: true, status: voiceService.status() };
  });

  // 音频块走 send（不等回包），避免每 64ms 一次 IPC 往返带来的抖动
  ipcMain.on("voice:audio", (_event, samples: Float32Array) => {
    void voiceService.handleAudio(samples).catch((error) => console.error("[voice] audio:", error));
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

  ipcMain.handle("voice:speak", async (_event, text: string, options?: { sid?: number; speed?: number }) => {
    return voiceAudioForIpc(await voiceService.speak(String(text ?? ""), options));
  });
  ipcMain.handle("voice:preview-voice", async (_event, input?: { sid?: number; speed?: number; text?: string }) => {
    // 设置页「音色试听」：不必在通话中，内部会临时起一个 TTS worker，合成完即销毁
    return voiceAudioForIpc(await voiceService.previewVoice(input ?? {}));
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
  ipcMain.handle("voice:hotkey-set", async (_event, input: { accelerator: string; enabled?: boolean }) => {
    const accelerator = input?.enabled === false ? "" : String(input?.accelerator ?? "");
    return applyVoiceHotkey(accelerator);
  });
  ipcMain.handle("voice:hotkey-get", () => ({ registered: registeredVoiceHotkey }));

  // ── 语音唤醒（持续聆听 + 文本匹配唤醒词）──
  ipcMain.handle("voice:wake-start", () => voiceService.startWakeListener());
  ipcMain.handle("voice:wake-audio", async (_event, samples: Float32Array) => voiceService.feedWakeAudio(samples));
  ipcMain.handle("voice:wake-reset", async () => { await voiceService.resetWakeStream(); return { ok: true }; });
  ipcMain.handle("voice:wake-stop", async () => { await voiceService.stopWakeListener(); return { ok: true }; });

  ipcMain.handle("voice:barge", () => voiceService.barge());

  ipcMain.handle("voice:playback-done", () => {
    voiceService.notifyPlaybackDone();
    return { ok: true };
  });

  ipcMain.handle("voice:models-status", async () => {
    const status = await voiceModelsStatus(voiceModelsRoot, ALL_VOICE_REPOS);
    return {
      ...status,
      bytes: modelsSizeOnDisk(voiceModelsRoot),
      root: voiceModelsRoot,
      // 提示 UI「本地导入」该期望的目录结构（HF 仓库 id 很长，用户需要明确看到）
      repos: ALL_VOICE_REPOS.map((r) => ({ id: r.repo, lastSegment: r.repo.split("/").pop() ?? r.repo })),
      // 音色克隆模型（ZipVoice，归档型资源，单独安装）：UI 按它显示独立条目
      zipvoice: { ready: zipvoiceReady(voiceModelsRoot), bytes: ZIPVOICE_ARCHIVE.bytes + ZIPVOICE_ARCHIVE.vocoder.bytes, dir: ZIPVOICE_DIR },
      // 语音唤醒关键词模型（KWS，归档型资源，单独安装）：唤醒卡片按它决定显示「一键下载」还是「已就绪」
      kws: { ready: kwsReady(voiceModelsRoot), bytes: KWS_ARCHIVE.bytes, dir: KWS_DIR },
    };
  });

  /** 音色克隆模型的安装与取消（归档型资源：GitHub release 整包 + 声码器，按需下载）。 */
  let zipvoiceAbort: AbortController | null = null;
  ipcMain.handle("voice:zipvoice-install", async () => {
    if (zipvoiceAbort) return { ok: false, error: "正在安装中" };
    zipvoiceAbort = new AbortController();
    try {
      const result = await ensureZipvoice(
        voiceModelsRoot,
        toolsRoot(),
        (progress) => sendToWindow("voice:event", { type: "download", ...progress, target: "zipvoice" }),
        zipvoiceAbort.signal,
      );
      sendToWindow("voice:event", { type: "downloadDone", ok: result.ok, error: result.ok ? undefined : (result as any).error, target: "zipvoice" });
      return result;
    } finally {
      zipvoiceAbort = null;
    }
  });
  ipcMain.handle("voice:zipvoice-cancel", () => {
    zipvoiceAbort?.abort();
    return { ok: true };
  });

  /**
   * 语音唤醒关键词模型（KWS，31MB 归档）：只服务「语音唤醒」，与三个主模型分开装 ——
   * 不装也能用（回退到识别模型匹配），装了才是不误唤醒 + 低 CPU 的那条路。
   */
  let kwsAbort: AbortController | null = null;
  ipcMain.handle("voice:kws-install", async () => {
    const { ensureKws } = require("../../voice/model-store");
    const { kwsReady } = require("../../voice/model-manifest");
    if (kwsReady(voiceModelsRoot)) return { ok: true };
    if (kwsAbort) return { ok: false, error: "正在安装中" };
    kwsAbort = new AbortController();
    try {
      const result = await ensureKws(
        voiceModelsRoot,
        toolsRoot(),
        (progress: any) => sendToWindow("voice:event", { type: "download", ...progress, target: "kws" }),
        kwsAbort.signal,
      );
      sendToWindow("voice:event", { type: "downloadDone", ok: result.ok, error: result.ok ? undefined : (result as any).error, target: "kws" });
      // 装好了让唤醒用上关键词模型：唤醒词没变也要重挂（引擎从 asr 换成 kws）
      if (result.ok && voiceService.wakeListening()) {
        await voiceService.stopWakeListener();
        await voiceService.startWakeListener();
      }
      return result;
    } finally {
      kwsAbort = null;
    }
  });
  ipcMain.handle("voice:kws-cancel", () => {
    kwsAbort?.abort();
    return { ok: true };
  });
  ipcMain.handle("voice:kws-status", () => {
    const { kwsReady } = require("../../voice/model-manifest");
    return { ready: kwsReady(voiceModelsRoot) };
  });
  return { voiceService, voiceModelsRoot, voiceAudioForIpc, registeredVoiceHotkey, applyVoiceHotkey, zipvoiceAbort, kwsAbort };
}
