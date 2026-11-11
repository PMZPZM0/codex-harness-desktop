/**
 * Codex 工具：MOSS 音色查询 / 切换（11-11 用户令「moss live 里面的音色要让 codex 可以自己选」）。
 *
 * 通话与播报共用同一个 voice_id：改完写进 settings.remote["moss-tts"].voiceId，
 * 正在进行的 MOSS 通话会收到 change_voice（下一轮回复生效）。
 * ⛔ 独立成模块：`dispatch-rpc.ts` 受守卫【265】行数棘轮约束。
 * ⛔ 返回值只含音色 id/name 与状态，绝不回显 API Key。
 */
import { app } from "electron";
import { listMossVoices, MOSS_TTS_DEFAULT_MODEL, MOSS_TTS_DEFAULT_URL } from "../voice/moss-tts";
import { loadVoiceSettings, publicVoiceSettings, saveVoiceSettings } from "../voice/voice-settings";
import { voiceService } from "../runtime-refs";
import { sendToWindow } from "./window-bus";

export type MossVoiceToolResult = { ok: boolean; output?: string; error?: string };

/** 列出 MOSS 音色 + 当前选择 / 语速 / 播报开关。 */
export async function mossVoiceList(args: Record<string, unknown>): Promise<MossVoiceToolResult> {
  const settings = loadVoiceSettings(app.getPath("userData"));
  const listed = await listMossVoices(settings);
  if (!listed.ok) return { ok: false, error: listed.error ?? "查询 MOSS 音色失败" };
  const query = String(args.query ?? "").trim().toLowerCase();
  const voices = (listed.voices ?? []).filter((voice) =>
    !query || voice.name.toLowerCase().includes(query) || voice.id.toLowerCase().includes(query));
  const entry = settings.remote?.["moss-tts"];
  const currentId = String(entry?.voiceId ?? "");
  const currentName = (listed.voices ?? []).find((voice) => voice.id === currentId)?.name || "";
  return {
    ok: true,
    output: [
      `当前 MOSS 音色：${currentName ? `${currentName}（${currentId}）` : currentId || "未选择"}；播报：${settings.tts?.remote === true ? "MOSS" : "本地"}；语速：${settings.tts?.speed}×；模型：${entry?.model || MOSS_TTS_DEFAULT_MODEL}`,
      `可用音色（${voices.length}）：`,
      ...voices.map((voice) => `- ${voice.name}  id=${voice.id}${voice.id === currentId ? "  ← 当前" : ""}`),
      "换音色：moss_voice_set({voiceName:\"名字\"}) 或 {voiceId:\"id\"}；可同时传 speed。",
    ].join("\n"),
  };
}

/** 按名字/id 切换 MOSS 音色（可同时调语速/模型/播报开关）。 */
export async function mossVoiceSet(args: Record<string, unknown>): Promise<MossVoiceToolResult> {
  const settings = loadVoiceSettings(app.getPath("userData"));
  const listed = await listMossVoices(settings);
  if (!listed.ok) return { ok: false, error: listed.error ?? "查询 MOSS 音色失败" };
  const voices = listed.voices ?? [];
  const wantedId = String(args.voiceId ?? "").trim();
  const wantedName = String(args.voiceName ?? args.name ?? "").trim();
  let hit = wantedId ? voices.find((voice) => voice.id === wantedId) : undefined;
  if (!hit && wantedName) {
    const exact = voices.filter((voice) => voice.name === wantedName);
    const loose = exact.length ? exact : voices.filter((voice) => voice.name.toLowerCase().includes(wantedName.toLowerCase()));
    if (loose.length === 1) hit = loose[0];
    else if (loose.length > 1) {
      return { ok: false, error: `「${wantedName}」匹配到 ${loose.length} 个音色：${loose.slice(0, 8).map((voice) => voice.name).join("、")}；请给更精确的名字或 id` };
    }
  }
  if (!hit) return { ok: false, error: "没找到这个音色：先调 moss_voice_list 看可用列表（别猜 id）" };
  const speedArg = Number(args.speed);
  const speed = Number.isFinite(speedArg) && speedArg > 0 ? Math.max(0.5, Math.min(2, speedArg)) : undefined;
  const model = String(args.model ?? "").trim() || String(settings.remote?.["moss-tts"]?.model ?? "").trim() || MOSS_TTS_DEFAULT_MODEL;
  const enable = args.enable !== false;
  const next = saveVoiceSettings(app.getPath("userData"), {
    remote: { ...(settings.remote ?? {}), "moss-tts": { baseUrl: String(settings.remote?.["moss-tts"]?.baseUrl ?? MOSS_TTS_DEFAULT_URL), model, voiceId: hit.id } },
    tts: { ...settings.tts, ...(speed ? { speed } : {}), remote: enable },
  });
  voiceService?.updateSettings?.(next);
  try { voiceService?.setRemoteVoice?.(hit.id); } catch { /* 没在远程通话时忽略 */ }
  sendToWindow("voice:event", { type: "settings", settings: publicVoiceSettings(next) });
  const live = (() => { try { return voiceService?.remoteActive?.() === true; } catch { return false; } })();
  return {
    ok: true,
    output: `已切换 MOSS 音色：${hit.name}（${hit.id}）；播报${enable ? "已开启" : "未开启"}；语速 ${next.tts.speed}×。`
      + (live ? "当前通话已请求实时换声，下一轮回复生效。" : "下次通话/播报即使用该音色。"),
  };
}
