/**
 * registerVoiceIpc2 —— registerVoiceIpc 按序切分出的第 2 段（纯搬迁、零改写）。
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { app, dialog, globalShortcut, ipcMain, shell, systemPreferences } from "electron";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import * as voiceProfiles from "../../voice/voice-profiles";
import { ALL_VOICE_REPOS, KWS_ARCHIVE, KWS_DIR, kwsReady, ZIPVOICE_ARCHIVE, ZIPVOICE_DIR, zipvoiceReady } from "../../voice/model-manifest";
import type { registerVoiceIpc1 } from "./01-voice-hotkey-models";

export function registerVoiceIpc2(ibA: ReturnType<typeof registerVoiceIpc1>) {
  const { voiceModelsRoot, voiceService } = ibA;
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
      const done = await voiceService.transcribeAudioFile(path.join(root, tmp16));
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

  ipcMain.handle("voice:profiles-list", async () => ({
    profiles: await voiceProfiles.listProfiles(app.getPath("userData")),
    zipvoiceReady: zipvoiceReady(voiceModelsRoot),
  }));

  /** 内置音色预设（合成音源的克隆预设）：wav+参考文本随包分发，一键创建档案。
   *  目录解析与 resolveFfmpegPath 同规则：开发版用项目 resources/，打包版用 process.resourcesPath/。 */
  function voicePresetsDir(): string {
    const dev = path.join(process.cwd(), "resources", "voice-presets");
    if (existsSync(dev)) return dev;
    return path.join(process.resourcesPath ?? process.cwd(), "voice-presets");
  }

  ipcMain.handle("voice:preset-list", async () => {
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

  ipcMain.handle("voice:preset-apply", async (_event, presetId: string) => {
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

  ipcMain.handle("voice:profiles-import", async () => {
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

  /** 渲染层录制（麦克风）→ PCM 回传 → 与导入走同一条草稿链路。 */
  ipcMain.handle("voice:profiles-record", async (_event, input: { samples?: number[]; sampleRate?: number }) => {
    try {
      const samples = Float32Array.from(Array.isArray(input?.samples) ? input!.samples! : []);
      const rate = Number(input?.sampleRate ?? 16000) || 16000;
      if (samples.length < rate * 1) return { ok: false, error: "录得太短了，至少录 1 秒" };
      return await draftProfileAudio(samples, rate, "麦克风录制");
    } catch (error: any) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });

  ipcMain.handle("voice:profiles-save", async (_event, input: { draftFile?: string; name?: string; refText?: string }) => {
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

  ipcMain.handle("voice:profiles-delete", async (_event, id: string) => ({
    ok: await voiceProfiles.deleteProfile(app.getPath("userData"), String(id ?? "")),
  }));

  /** 选用某个音色（写进语音设置 tts.profileId；空串 = 用内置预置音色）。 */
  ipcMain.handle("voice:profiles-select", async (_event, id: string) => {
    const { saveVoiceSettings } = require("../../voice/voice-settings");
    const current = voiceService.getSettings();
    const next = saveVoiceSettings(app.getPath("userData"), {
      tts: { ...current.tts, profileId: String(id ?? "") },
    });
    voiceService.updateSettings(next);
    return { ok: true, profileId: String(id ?? "") };
  });
  return { voiceProfilesDirOf, draftProfileAudio, voicePresetsDir };
}
