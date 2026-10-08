/**
 * registerVoiceIpc2 —— registerVoiceIpc 按序切分出的第 2 段（纯搬迁、零改写）。
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { app, dialog, globalShortcut, shell, systemPreferences } from "electron";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import * as voiceProfiles from "../../voice/voice-profiles";
import { ALL_VOICE_REPOS, KWS_ARCHIVE, KWS_DIR, kwsReady, ZIPVOICE_ARCHIVE, ZIPVOICE_DIR, zipvoiceReady } from "../../voice/model-manifest";
import type { registerVoiceIpc1 } from "./01-voice-hotkey-models";

export function registerVoiceIpc2(ibA: ReturnType<typeof registerVoiceIpc1>) {
  const { svc, modelsRoot, ipcHost } = ibA;
  // ── 音色档案（音色克隆 ZipVoice）：导入/录制参考音频 → 本机 ASR 转写参考文本 → 保存为专属音色 ──
  const voiceProfilesDirOf = () => path.join(app.getPath("userData"), "voice-profiles");

  /** 把一段音频做成草稿：落盘 + 重采样到 16k 用本机 ASR 自动转写「参考文本」。
   *  参考文本必须与音频内容一致（zeroshot 硬约束，对不上音质会明显劣化）——
   *  所以这里转成草稿后**一定**要让用户校对一遍再保存。 */
  async function draftProfileAudio(samples: Float32Array, sampleRate: number, sourceName: string) {
    const root = voiceProfilesDirOf();
    await fs.mkdir(root, { recursive: true });
    const draftFile = ".draft-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + ".wav";
    await fs.writeFile(path.join(root, draftFile), voiceProfiles.encodeWav16(samples, sampleRate));
    const at16k = voiceProfiles.resampleLinear(samples, sampleRate, 16000);
    const tmp16 = draftFile.replace(/\.wav$/, "-16k.wav");
    await fs.writeFile(path.join(root, tmp16), voiceProfiles.encodeWav16(at16k, 16000));
    let refText = "";
    let transcribeError = "";
    try {
      const done = await svc().transcribeAudioFile(path.join(root, tmp16));
      if (done.ok) refText = String(done.text ?? "").trim();
      else transcribeError = String(done.error ?? "");
    } catch (error) {
      transcribeError = String((error as any)?.message ?? error);
    }
    await fs.rm(path.join(root, tmp16), { force: true }).catch(() => undefined);
    return {
      ok: true,
      draftFile,
      refText,
      transcribeError,
      sampleRate,
      durationSec: Math.round((samples.length / sampleRate) * 10) / 10,
      sourceName,
    };
  }

  ipcHost.handle("voice:profiles-list", async () => ({
    profiles: await voiceProfiles.listProfiles(app.getPath("userData")),
    zipvoiceReady: zipvoiceReady(modelsRoot()),
  }));

  /** 内置音色预设（合成音源的克隆预设）：wav+参考文本随包分发，一键创建档案。
   *  目录解析与 resolveFfmpegPath 同规则：开发版用项目 resources/，打包版用 process.resourcesPath/。 */
  function voicePresetsDir(): string {
    const dev = path.join(process.cwd(), "resources", "voice-presets");
    if (existsSync(dev)) return dev;
    return path.join(process.resourcesPath ?? process.cwd(), "voice-presets");
  }

  ipcHost.handle("voice:preset-list", async () => {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(voicePresetsDir(), "presets.json"), "utf8"));
      const profiles = await voiceProfiles.listProfiles(app.getPath("userData"));
      const presets = (Array.isArray(raw) ? raw : []).map((p: any) => ({
        id: String(p.id ?? ""),
        name: String(p.name ?? ""),
        desc: String(p.desc ?? ""),
        lang: String(p.lang ?? "zh"),
        applied: profiles.some((profile) => profile.name === String(p.name ?? "")),
      }));
      return { presets };
    } catch { return { presets: [] }; }
  });

  ipcHost.handle("voice:preset-apply", async (_event, presetId: string) => {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(voicePresetsDir(), "presets.json"), "utf8"));
      const preset = (Array.isArray(raw) ? raw : []).find((p: any) => p.id === String(presetId ?? ""));
      if (!preset) return { ok: false, error: "内置音色不存在" };
      const parsed = voiceProfiles.readWav(await fs.readFile(path.join(voicePresetsDir(), String(preset.wav ?? ""))));
      if (!parsed) return { ok: false, error: "预设音频缺失或格式不对" };
      const existing = await voiceProfiles.listProfiles(app.getPath("userData"));
      const already = existing.find((profile) => profile.name === String(preset.name ?? ""));
      if (already) return { ok: true, profile: already, existed: true };
      const profile = await voiceProfiles.createProfile(app.getPath("userData"), {
        name: String(preset.name ?? ""),
        refText: String(preset.refText ?? ""),
        samples: parsed.samples,
        sampleRate: parsed.sampleRate,
      });
      return { ok: true, profile };
    } catch (error: any) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });

  ipcHost.handle("voice:profiles-import", async () => {
    const picked = await dialog.showOpenDialog({
      title: "选择一段参考音频（16-bit PCM wav，10 秒左右效果最好）",
      filters: [{ name: "音频", extensions: ["wav"] }],
      properties: ["openFile"],
    });
    if (picked.canceled || !picked.filePaths?.[0]) return { ok: false, canceled: true };
    const file = picked.filePaths[0];
    try {
      const parsed = voiceProfiles.readWav(await fs.readFile(file));
      if (!parsed || !parsed.samples.length) {
        return { ok: false, error: "只能读取 16-bit PCM 的 wav 文件（mp3/m4a 请先用音频工具转成 wav）" };
      }
      if (parsed.samples.length / parsed.sampleRate > 60) {
        return { ok: false, error: "参考音频请控制在 60 秒以内（10 秒左右效果最好）" };
      }
      return await draftProfileAudio(parsed.samples, parsed.sampleRate, path.basename(file));
    } catch (error: any) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });

  /**
   * 音色上传接口（10-08 新增，用户要求「预留音色上传接口，方便用户自行上传音色」）。
   *
   * 三种来源 `source`：当前实现两种、第三种**预留**（接口形态已定，实现留待后续）——
   *   · `"base64"` 渲染层 / 外部工具直接把音频样本（Float32 小端 + 采样率）传进来
   *                （给「拖拽上传」与将来的音色市场用）；
   *   · `"file"`   打开文件选择器挑一个 wav（UI 的「上传音色」按钮走这条，默认值）；
   *   · `"pack"`   **预留**：音色包整体导入（zip：`ref.wav` + `ref.txt`/`profile.json`）。
   *                现在明确返回「暂未开放」——**不静默失败**（本项目最忌讳「看着能用其实没接」）。
   *
   * ⛔ 与「导入音频」共用同一条草稿链（落盘 → 本机 ASR 转写参考文本 → 用户校对 → 保存），
   *    差别只在入口（以及能否被外部程序调用）。所以复用 `draftProfileAudio`，不另写一套。
   * ⛔ 返回的是**草稿**（`draftFile` + `refText`）：参考文本必须与音频内容一致（zeroshot 硬约束），
   *    一律让用户核对后再保存 —— 绝不在这里直接落成音色。
   */
  ipcHost.handle("voice:profile-upload", async (_event, input?: {
    source?: "base64" | "file" | "pack";
    name?: string;
    refText?: string;
    audioBase64?: string;
    sampleRate?: number;
  }) => {
    const source = String(input?.source ?? "file");
    if (source === "pack") {
      return { ok: false, error: "音色包（zip）上传暂未开放（接口已预留：source=\"pack\"）—— 请先用「上传音色」选一个 wav 音频" };
    }
    if (source === "base64") {
      const b64 = String(input?.audioBase64 ?? "").trim();
      if (!b64) return { ok: false, error: "缺少音频数据（audioBase64 为空）" };
      const rate = Math.max(8000, Math.min(48000, Number(input?.sampleRate ?? 16000) || 16000));
      let samples: Float32Array;
      try {
        const buf = Buffer.from(b64, "base64");
        // 约定：base64 里是 **Float32 小端**原始样本（与 voice:speak 回传音频同一口径）
        const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
        samples = new Float32Array(copy);
      } catch (error: any) {
        return { ok: false, error: `音频数据解码失败：${error?.message ?? error}` };
      }
      if (samples.length < rate) return { ok: false, error: "音频太短了，至少 1 秒" };
      if (samples.length / rate > 60) return { ok: false, error: "参考音频请控制在 60 秒以内（10 秒左右效果最好）" };
      return await draftProfileAudio(samples, rate, String(input?.name ?? "").trim() || "上传的音色");
    }
    const picked = await dialog.showOpenDialog({
      title: "上传音色：选一段参考音频（16-bit PCM wav，10 秒左右效果最好）",
      filters: [{ name: "音频 / 音色包", extensions: ["wav", "zip"] }],
      properties: ["openFile"],
    });
    if (picked.canceled || !picked.filePaths?.[0]) return { ok: false, canceled: true };
    const file = picked.filePaths[0];
    if (/\.zip$/i.test(file)) {
      return { ok: false, error: "音色包（zip）上传暂未开放（接口已预留）—— 请先用「上传音色」选一个 wav 音频" };
    }
    try {
      const parsed = voiceProfiles.readWav(await fs.readFile(file));
      if (!parsed || !parsed.samples.length) {
        return { ok: false, error: "只能读取 16-bit PCM 的 wav 文件（mp3/m4a 请先用音频工具转成 wav）" };
      }
      if (parsed.samples.length / parsed.sampleRate > 60) {
        return { ok: false, error: "参考音频请控制在 60 秒以内（10 秒左右效果最好）" };
      }
      return await draftProfileAudio(parsed.samples, parsed.sampleRate, String(input?.name ?? "").trim() || path.basename(file));
    } catch (error: any) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });

  /** 渲染层录制（麦克风）→ PCM 回传 → 与导入走同一条草稿链路。 */
  ipcHost.handle("voice:profiles-record", async (_event, input: { samples?: number[]; sampleRate?: number }) => {
    try {
      const samples = Float32Array.from(Array.isArray(input?.samples) ? input!.samples! : []);
      const rate = Number(input?.sampleRate ?? 16000) || 16000;
      if (samples.length < rate * 1) return { ok: false, error: "录得太短了，至少录 1 秒" };
      return await draftProfileAudio(samples, rate, "麦克风录制");
    } catch (error: any) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });

  ipcHost.handle("voice:profiles-save", async (_event, input: { draftFile?: string; name?: string; refText?: string }) => {
    try {
      const root = voiceProfilesDirOf();
      const draft = String(input?.draftFile ?? "");
      const parsed = voiceProfiles.readWav(await fs.readFile(path.join(root, draft)));
      if (!parsed) return { ok: false, error: "草稿音频已失效，请重新导入或录制" };
      const profile = await voiceProfiles.createProfile(app.getPath("userData"), {
        name: String(input?.name ?? ""),
        refText: String(input?.refText ?? ""),
        samples: parsed.samples,
        sampleRate: parsed.sampleRate,
      });
      await fs.rm(path.join(root, draft), { force: true }).catch(() => undefined);
      return { ok: true, profile };
    } catch (error: any) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });

  ipcHost.handle("voice:profiles-delete", async (_event, id: string) => ({
    ok: await voiceProfiles.deleteProfile(app.getPath("userData"), String(id ?? "")),
  }));

  /** 选用某个音色（写进语音设置 tts.profileId；空串 = 用内置预置音色）。 */
  ipcHost.handle("voice:profiles-select", async (_event, id: string) => {
    const { saveVoiceSettings } = require("../../voice/voice-settings");
    const current = svc().getSettings();
    const next = saveVoiceSettings(app.getPath("userData"), {
      tts: { ...current.tts, profileId: String(id ?? "") },
    });
    svc().updateSettings(next);
    return { ok: true, profileId: String(id ?? "") };
  });
  return { voiceProfilesDirOf, draftProfileAudio, voicePresetsDir };
}
