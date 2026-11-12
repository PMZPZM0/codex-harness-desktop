/**
 * VoiceSettingsSectionTtsEngines —— 合成引擎三选一（10-26 用户令：「三个模型卡片做好看一点，
 * 每个优势劣势都写清楚」「模型按需下载，原有的模型保留」）。
 *
 * ⛔ 设计约束（都是踩过的坑，别改回去了）：
 *   · **原有模型保留**：vits-zh-ll 是默认引擎，装了其它可选引擎也不会动它，
 *     每个包各自独立目录、独立下载、独立删除。
 *   · **不许用 disabled 表达"能不能用"**：EmotiVoice 目前缺推理运行时，按钮照常可点，
 *     点了给**明确说明**（10-20 教训：灰按钮点了没反应是最差体验）。
 *   · 优势/劣势必须写**实测数字**，不写"更快更好"这种空话。
 */
import { Check, Cloud, Download, FolderOpen, HardDrive, LoaderCircle, Play, Power, Settings2, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { AppSelect } from "../AppSelect";
import { useEscapeLayer } from "../../hooks/useEscapeLayer";
import { decodeFloat32Base64 } from "../../voice/audio-transport";
import { ToggleSwitch } from "../SettingsWidgets";
import { Settings, playSamples, VOICE_SPEED_PRESETS } from "../VoiceSettingsSection";
import VoiceDevToolsSection from "../VoiceDevToolsSection";

type Props = {
  apply: (patch: Partial<Settings>) => Promise<void>;
  onNotice: (m: string) => void;
  settings: Settings;
  /** 重拉音色表（换引擎后必须调：主进程按引擎给音色表） */
  reloadMeta: () => Promise<void>;
  /** 基础模型配置弹窗里的「音色 / 克隆」区（由设置页组合进来，避免把状态再拷一份） */
  localExtra?: ReactNode;
};

type PackId = "vits" | "emotivoice";

type PackState = {
  ready: boolean;
  enabled: boolean;
  bytes: number;
  /** 模型装了 ≠ 能合成（EmotiVoice 还缺通用 onnxruntime） */
  runnable: boolean;
  hostNote?: string;
};

type EngineInfo = {
  id: PackId;
  name: string;
  /** 角色标签（默认 / 可选·更自然 / 可选·有情绪）——新手第一眼要能分清"哪些是必装" */
  badge: string;
  /** 默认引擎（随基础模型一起装，不单独下载） */
  isDefault?: boolean;
  tagline: string;
  /** 一句话说清它是干嘛的 */
  role: string;
  sizeMB: number;
  speakerCount: string;
  pros: string[];
  cons: string[];
};

/** ⛔ 三张卡的文案与数字都来自实测（体积/SHA256 实测、RTF 取自 sherpa-onnx 官方表）。 */
const ENGINES: EngineInfo[] = [
  {
    id: "vits",
    name: "轻量播报",
    badge: "默认 · 随基础模型",
    isDefault: true,
    tagline: "vits-zh-ll · 装完基础模型就能用",
    role: "默认引擎。跟着基础语音模型一起装，不额外占地方。",
    sizeMB: 116,
    speakerCount: "5 个音色",
    pros: [
      "体积最小（116MB），跟识别模型打包一起下",
      "CPU 最快：官方 RTF 2.49（2 线程），长句也稳",
      "零额外依赖，装完即用，最不容易出问题",
    ],
    cons: ["偏机械，几乎没有语气变化", "只有 5 个音色可选", "不能克隆、不能指定情绪"],
  },
  {
    id: "emotivoice",
    name: "情感语气",
    badge: "可选 · 有情绪",
    tagline: "EmotiVoice · 真情绪控制",
    role: "要「高兴 / 悲伤 / 愤怒」这种语气时用它。",
    sizeMB: 612,
    speakerCount: "2014 个音色",
    pros: [
      "真的有情绪：同一句话可出 6 种不同语气（本机实测两两不同）",
      "2014 个音色；CPU 上 RTF ≈ 0.31，够快",
      "Apache-2.0，可商用",
    ],
    cons: [
      "体积最大（612MB：生成器 226MB + SimBERT 386MB）",
      "输出只有 16kHz，比另外两个低一档，听着偏闷",
      "需要额外的 ONNX 推理运行时（约 287MB），运行时未接入前不能合成",
    ],
  },
];

/** TTS 引擎与音色包管理卡：显示安装状态、下载进度、切换引擎，失败在卡内给反馈条。 */
export function VoiceSettingsSectionTtsEngines({ apply, onNotice, reloadMeta, settings, localExtra }: Props) {
  const [packs, setPacks] = useState<Partial<Record<PackId, PackState>>>({});
  const [moss, setMoss] = useState<{ configured: boolean; runnable: boolean; baseUrl: string; model: string; hasKey: boolean; keyHint: string; docs?: string } | null>(null);
  /** 11-12：MOSS-TTS 远程播报状态（配置齐全即可播，不依赖本机模型）。 */
  const [mossTts, setMossTts] = useState<{ enabled: boolean; configured: boolean; voiceId: string; error: string } | null>(null);
  /** 11-12 单一真相源：主进程按真实优先级（克隆 > MOSS > 本机）算出的合成状态。 */
  const [speech, setSpeech] = useState<{ effective: string; ready: boolean; label: string; reason: string } | null>(null);
  /** 旧主进程没有 speech 时的回退判据：克隆音色模型是否就绪。 */
  const [zipVoiceReady, setZipVoiceReady] = useState(false);
  const [mossDraft, setMossDraft] = useState({ baseUrl: "", model: "", apiKey: "" });
  /** MOSS 播报（TTS）：独立的模型/音色；密钥沿用 moss-live 那张卡，不在这里重复填。 */
  const [mossTtsDraft, setMossTtsDraft] = useState({ model: "moss-tts-1.5-flash", voiceId: "" });
  const [mossVoices, setMossVoices] = useState<{ id: string; name: string }[]>([]);
  /** 配置收进弹窗：卡面上只留状态/启用停用/试听；弹窗打开时 Esc 只关它（全局 ESC 栈）。 */
  const [mossModalOpen, setMossModalOpen] = useState(false);
  /** 基础模型（本地）的配置也收进弹窗：一级界面只留两张摘要卡。 */
  const [localModalOpen, setLocalModalOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const previewCtlRef = useRef<{ stop: () => void } | null>(null);
  useEscapeLayer(mossModalOpen, () => setMossModalOpen(false));
  useEscapeLayer(localModalOpen, () => setLocalModalOpen(false));
  useEffect(() => () => { previewCtlRef.current?.stop(); previewCtlRef.current = null; }, []);
  const [busy, setBusy] = useState<PackId | null>(null);
  const [progress, setProgress] = useState<{ pack: PackId; percent: number; message: string } | null>(null);
  /** 卡片内反馈条（下载成功/失败、切换成功）—— ⛔ 不能只靠一闪而过的 toast */
  const [flash, setFlash] = useState<{ pack: PackId; kind: "ok" | "err" | "info"; text: string } | null>(null);

  const refresh = useCallback(async (): Promise<any | null> => {
    try {
      const status: any = await window.codex.voiceModelsStatus();
      setMoss(status?.mossLive ?? null);
      setMossTts(status?.mossTts ?? null);
      setSpeech(status?.speech ?? null);
      setZipVoiceReady(Boolean(status?.zipvoice?.ready));
      const next: Partial<Record<PackId, PackState>> = {
        /* ⛔ 11-11 用户实测「点了停用，上面还写着使用中」：基础模型的 enabled 必须从
           `status.baseEnabled` 取，不能写死 true —— ready（文件在不在）与 enabled（加载不加载）
           是两个正交维度，只回一个必然自相矛盾。 */
        vits: { ready: Boolean(status?.ready), enabled: status?.baseEnabled !== false, bytes: 0, runnable: true },
        emotivoice: status?.emotivoice
          ? {
              ready: Boolean(status.emotivoice.ready),
              enabled: status.emotivoice.enabled !== false,
              bytes: status.emotivoice.bytes ?? 0,
              runnable: status.emotivoice.runnable !== false,
              hostNote: status.emotivoice.hostNote,
            }
          : { ready: false, enabled: true, bytes: 612_000_000, runnable: false },
      };
      setPacks(next);
      return status;
    } catch {
      /* 读不到就保持现状，卡片各自显示未安装 */
      return null;
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /* 反馈条 4 秒后收起；换一条新的会重置计时（同一张卡连着两次操作也看得见）。 */
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4200);
    return () => window.clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    const unsub = window.codex.onVoiceEvent((event: any) => {
      const target = event?.target;
      /* ⛔ 10-31 联动：基础模型（无 target）装完 ⇒ 轻量播报卡「已安装/缺模型」必须跟着刷新，
         否则装好了上面还写着「未安装」（用户实测「旧的内容不更新」）。 */
      if (!target) {
        /* 11-12：设置变化（切换播报本机/云端、选克隆音色）也要重探 speech，
           否则上面那张卡还挂着旧的「未就绪」。 */
        if (event?.type === "downloadDone" || event?.type === "settings") void refresh();
        return;
      }
      if (target !== "emotivoice") return;
      if (event?.type === "download") {
        setProgress({ pack: target, percent: Number(event.percent ?? -1), message: String(event.message ?? "下载中…") });
      } else if (event?.type === "downloadDone") {
        setProgress(null);
        setBusy(null);
        void refresh();
        if (!event.ok) {
          /* 用户主动取消 ⇒ 中性提示，不弹红色「下载失败」（abort 也算失败，但那不是故障）。 */
          const cancelled = /取消|abort|cancel/i.test(String(event.error ?? ""));
          const msg = cancelled ? "已取消下载" : `下载失败：${event.error ?? "未知原因"}`;
          if (!cancelled) onNotice(msg);
          setFlash({ pack: target, kind: cancelled ? "info" : "err", text: msg });
        } else {
          const msg = "情感语音模型已下载（还缺推理运行时，暂不能合成）";
          onNotice(msg);
          setFlash({ pack: target, kind: "ok", text: msg });
        }
      }
    });
    return () => { try { unsub?.(); } catch { /* 忽略 */ } };
  }, [onNotice, refresh]);

  const current: PackId = useMemo(() => {
    const id = settings?.tts?.engine;
    return id === "emotivoice" ? id : "vits";
  }, [settings]);

  /* MOSS-Live 配置草稿：地址/模型从已存配置回填；密钥不回显（只留占位），保存时留空=沿用旧密钥。 */
  const savedMoss = settings?.remote?.["moss-live"];
  const savedMossTts = settings?.remote?.["moss-tts"];
  useEffect(() => {
    setMossDraft((d) => ({ ...d, baseUrl: savedMoss?.baseUrl ?? d.baseUrl, model: savedMoss?.model ?? d.model }));
  }, [savedMoss?.baseUrl, savedMoss?.model]);
  useEffect(() => {
    setMossTtsDraft((d) => ({
      model: savedMossTts?.model ?? d.model ?? "moss-tts-1.5-flash",
      voiceId: savedMossTts?.voiceId ?? d.voiceId,
    }));
  }, [savedMossTts?.model, savedMossTts?.voiceId]);
  const ttsRemote = settings?.tts?.remote === true;

  const callBackend = settings?.call?.backend === "moss-live";
  /* ⛔ 用户填过 https://…/v1/audio/speech 或 moss-tts-*：那是普通语音合成（TTS），
     实时通话要的是 Realtime WebSocket + moss-live-1.0。不拦下就会得到一个「配置成功但连不上的开关」。 */
  const mossLooksLikeTts = /\/audio\/speech\b|moss-tts|\btts\b/i.test(`${savedMoss?.baseUrl ?? ""} ${savedMoss?.model ?? ""}`);

  const saveMoss = useCallback(async () => {
    const baseUrl = mossDraft.baseUrl.trim();
    const model = mossDraft.model.trim();
    /* ⛔ 渲染层拿不到明文密钥（settings-get 已脱敏）——留空 = 沿用已存密钥。
       只有「没存过密钥且这次也没填」才拒绝保存。 */
    const apiKey = mossDraft.apiKey.trim();
    if (!baseUrl || !model || (!apiKey && !moss?.hasKey)) {
      onNotice("接口地址、模型、API 密钥都要填");
      return;
    }
    const entry = { baseUrl, model, ...(apiKey ? { apiKey } : {}) };
    await apply({ remote: { ...(settings?.remote ?? {}), "moss-live": entry } });
    setMossDraft((d) => ({ ...d, apiKey: "" }));
    /* ⛔ 保存后必须重读主进程状态，否则卡片一直挂着旧的「未配置」（用户实测点名）。
       同时用回读值判定是否真的落盘 —— apply 内部吞掉 IPC 失败，只发成功提示会骗用户。 */
    const status: any = await refresh();
    const saved = Boolean(status?.mossLive?.configured
      && String(status.mossLive.baseUrl ?? "") === baseUrl
      && String(status.mossLive.model ?? "") === model);
    if (!saved) {
      onNotice("MOSS-Live 配置保存失败，请重试");
      return;
    }
    onNotice(/\/audio\/speech\b|moss-tts|\btts\b/i.test(`${baseUrl} ${model}`)
      ? "配置已保存；但这是语音合成（TTS）地址/模型，实时通话需要 wss://api.mosi.cn/v1/realtime + moss-live-1.0"
      : "MOSS-Live 配置已保存");
  }, [apply, moss?.hasKey, mossDraft, onNotice, refresh, settings?.remote]);

  /** 实时通话后端开关：开 = 通话走 MOSS-Live，连不上自动回落本地语音（VoiceService 里有回落）。 */
  const setCallBackend = useCallback(async (next: boolean) => {    if (next) {
      if (!moss?.configured) { onNotice("请先保存接口地址、模型和 API 密钥，再开启实时通话"); return; }
      if (mossLooksLikeTts) { onNotice("当前地址是语音合成（TTS）接口，不是实时通话接口：请改填 Realtime WebSocket 地址后再开启"); return; }
    }
    await apply({ call: { backend: next ? "moss-live" : "local" } });
    /* 以落盘回读为准：apply 吞掉失败时别报「已切换」。 */
    const status: any = await refresh();
    const actual = String(status?.call?.backend ?? "local");
    const ok = actual === (next ? "moss-live" : "local");
    onNotice(ok
      ? (next ? "实时通话将走 MOSS-Live（连不上会自动回落本地语音）" : "实时通话已切回本地语音")
      : "切换实时通话后端失败，请重试");
  }, [apply, moss?.configured, mossLooksLikeTts, onNotice, refresh]);

  /* MOSS 播报（TTS）：密钥沿用 moss-live，音色要单独查。 */
  const queryMossVoices = useCallback(async () => {
    /* ⛔ catch 的 err 用 unknown（11-12 把这里的 `e: any` 收掉：它让本文件 any 14→15，
       而 any 棘轮只许降不许涨 —— 这类纯类型收紧零行为变化，别靠 --update 记账绕过去）。 */
    const r: any = await window.codex.voiceMossVoices().catch((e: unknown) => ({ ok: false, error: String((e as { message?: unknown })?.message ?? e) }));
    if (!r?.ok) { onNotice(r?.error ?? "查询音色失败"); return; }
    const list = Array.isArray(r.voices) ? r.voices : [];
    setMossVoices(list);
    if (!list.length) { onNotice("这个 MOSS 账号还没有可用音色"); return; }
    setMossTtsDraft((d) => ({ ...d, voiceId: d.voiceId || list[0].id }));
    onNotice(`找到 ${list.length} 个音色，选一个再保存`);
  }, [onNotice]);

  const saveMossTts = useCallback(async () => {
    const model = mossTtsDraft.model.trim() || "moss-tts-1.5-flash";
    const voiceId = mossTtsDraft.voiceId.trim();
    if (!voiceId) { onNotice("先点「查询音色」并选一个音色"); return; }
    await apply({
      remote: { ...(settings?.remote ?? {}), "moss-tts": { baseUrl: "https://api.mosi.cn/v1/audio/speech", model, voiceId } },
      tts: { ...settings.tts, remote: ttsRemote },
    });
    /* 11-12：保存后重读状态 —— 顶部警告 / 播报开关的就绪判据都吃这一份（mossTts）。 */
    await refresh();
    const res: any = await window.codex.voiceSettingsGet().catch(() => null);
    const saved = res?.settings?.remote?.["moss-tts"];
    onNotice(saved?.voiceId === voiceId && saved?.model === model ? "MOSS 播报配置已保存" : "MOSS 播报配置保存失败，请重试");
  }, [apply, mossTtsDraft, onNotice, settings, ttsRemote]);

  /** 直接试听 MOSS 音色：按弹窗里的草稿 model/voiceId 合成，不要求先开启播报。 */
  const auditionMoss = useCallback(async () => {
    const voiceId = String(mossTtsDraft.voiceId || savedMossTts?.voiceId || "").trim();
    if (!voiceId) { onNotice("先点「查询音色」并选一个音色"); return; }
    previewCtlRef.current?.stop();
    setPreviewing(true);
    try {
      const result: any = await window.codex.voiceMossPreview({
        model: mossTtsDraft.model.trim(),
        voiceId,
        speed: settings.tts.speed,
        text: "你好，我是你的语音助手，这是 MOSS 音色试听。",
      });
      if (!result?.ok) { onNotice(result?.error ?? "试听失败"); return; }
      const samples = decodeFloat32Base64(result.audioBase64);
      if (!samples.length) { onNotice("试听音频为空"); return; }
      const ctl = await playSamples(samples, Number(result.sampleRate ?? 48000));
      previewCtlRef.current = ctl;
      await ctl.done;
    } catch (error: any) {
      onNotice(`试听失败：${error?.message ?? error}`);
    } finally {
      previewCtlRef.current = null;
      setPreviewing(false);
    }
  }, [mossTtsDraft.model, mossTtsDraft.voiceId, onNotice, savedMossTts?.voiceId, settings.tts.speed]);

  /* ⛔ 11-01 用户实测「取消不了」：主进程早就有 `voice:tts-pack-cancel`（abort 掉下载用的
     AbortController），但界面从来没接 —— 卡片上只有「下载中…」没有取消入口；而上面那张
     基础模型卡片的「取消下载」调的是 `voiceModelsCancel`（只取消基础语音模型），
     点多少次都停不掉 TTS 的下载。⇒ 这里补一个真取消。 */
  const cancelPack = useCallback(async (id: PackId) => {
    try { await window.codex.voiceTtsPackCancel(); } catch { /* 通道失败也不该把界面卡在"下载中" */ }
    setBusy(null);
    setProgress((p) => (p && p.pack === id ? null : p));
    setFlash({ pack: id, kind: "info", text: "已取消下载" });
  }, []);

  const install = useCallback(async (id: PackId) => {    if (id === "vits") {
      onNotice("轻量播报跟着基础语音模型一起装：点本卡的「下载模型 / 本地导入」装基础模型即可");
      return;
    }
    setBusy(id);
    setProgress({ pack: id, percent: -1, message: "准备下载…" });
    try {
      const r: any = await window.codex.voiceTtsPackInstall(id);
      if (!r?.ok) {
        setBusy(null);
        setProgress(null);
        const msg = r?.error ?? "下载失败";
        onNotice(msg);
        setFlash({ pack: id, kind: "err", text: msg });
      }
    } catch (e: any) {
      setBusy(null);
      setProgress(null);
      onNotice(`下载失败：${e?.message ?? e}`);
    }
  }, [onNotice]);

  const remove = useCallback(async (id: PackId) => {
    try {
      const r: any = await window.codex.voiceResourceDelete({ kind: id });
      if (!r?.ok) { onNotice(r?.error ?? "删除失败"); setFlash({ pack: id, kind: "err", text: r?.error ?? "删除失败" }); }
      else {
        onNotice("已删除，需要时可重新下载");
        if (current === id) apply({ tts: { ...settings.tts, engine: "vits" } });
        /* ⛔ 删除后清掉这个包的下载态：否则卡片上会留着一条已经没意义的进度条。 */
        setProgress((p) => (p?.pack === id ? null : p));
        setBusy((b) => (b === id ? null : b));
      }
      void refresh();
    } catch (e: any) {
      onNotice(`删除失败：${e?.message ?? e}`);
    }
  }, [apply, current, onNotice, refresh, settings]);

  const choose = useCallback((id: PackId) => {
    const state = packs[id];
    if (id !== "vits" && !state?.ready) {
      onNotice("这个引擎的模型还没下载，先点「下载」");
      return;
    }
    /* ⛔ 停用 ≠ 可用：文件还在磁盘但主进程不会加载它。点「用它」必须先引导去启用，
       否则用户会以为切过去了、实际通话仍旧不出声。 */
    if (state && state.enabled === false) {
      onNotice(id === "vits"
        ? "基础语音模型已停用：请先在本卡的「启用」按钮恢复（文件还在，无需重新下载）"
        : "该引擎已停用，请先重新启用再切换");
      return;
    }
    if (id !== "vits" && state && !state.runnable) {
      onNotice(`模型已下载，但还缺推理运行时（约 287MB），运行时接入后才能用它合成；现在仍用「${packLabel(current)}」`);
      return;
    }
    apply({ tts: { ...settings.tts, engine: id } });
    /* ⛔ 换引擎 ⇒ 音色表跟着换（主进程按引擎给）⇒ 必须重拉，否则下拉里还是旧引擎的音色。 */
    void reloadMeta();
    const msg = `已切换到「${packLabel(id)}」（通话与播报都用它）`;
    onNotice(msg);
    setFlash({ pack: id, kind: "info", text: msg });
  }, [apply, current, onNotice, packs, reloadMeta, settings]);

  /* ⛔ 10-26：「当前」也要说真话 —— 设置里选的是它，但没装就合成不了；
     停用的模型文件还在（ready=true）同样不能算「可用」（11-11 用户实测
     「点了停用，上面还写着使用中」）。 */
  const currentDisabled = Boolean(packs[current]?.ready) && packs[current]?.enabled === false;
  const anyReady = Object.values(packs).some((p) => Boolean(p?.ready));
  /* 11-12 联动：MOSS-TTS 配置齐全也算"能出声"；旧主进程没有 mossTts 时按
     「播报切了 MOSS + 实时密钥已配 + 选了音色」回退推算（否则新界面会一直显示不可用）。 */
  const cloneSelected = Boolean(settings?.tts?.profileId);
  const cloneReady = cloneSelected && zipVoiceReady;
  const mossTtsReady = mossTts?.configured === true
    || (mossTts == null && Boolean(savedMossTts?.voiceId) && Boolean(moss?.configured));
  const speechReady = cloneSelected
    ? cloneReady
    : (typeof speech?.ready === "boolean" ? speech.ready : anyReady || mossTtsReady);
  /** 克隆音色优先级最高：选了它时 MOSS 播报会被跳过，不能显示成「MOSS 缺配置」。 */
  const cloneActive = cloneSelected;
  /* MOSS-Live 实时通话：选中 + 配置齐全才算"使用中"；只选中没配好要显式报错，
     ⛔ 不能一边打「使用中」一边打「未配置」。 */
  const mossInUse = callBackend && Boolean(moss?.configured);
  const mossBroken = callBackend && !moss?.configured;
  /* 11-12 用户：「我点哪个，上面卡片就启用哪个」——卡片高亮只看**播报源**（tts.remote）。
     ⛔ 不能把实时通话后端也算进来：通话开着 MOSS、播报选本机时，右边仍会错误地显示使用中。 */
  const localActive = !ttsRemote;
  const remoteActive = ttsRemote;

  /** 11-12：基础模型卡也要有「启用 / 停用」并和状态联动（与 MOSS 卡同款按钮位）。
      停用是可逆动作（文件保留），第一次点变成「确认停用」，3 秒未确认自动复位。 */
  const [baseBusy, setBaseBusy] = useState(false);
  const [confirmDisableBase, setConfirmDisableBase] = useState(false);
  const toggleBase = useCallback(async (next: boolean) => {
    setBaseBusy(true);
    try {
      const r: any = await window.codex.voiceResourceSetEnabled({ kind: "base", enabled: next });
      if (!r?.ok) onNotice(r?.error ?? "操作失败");
      else {
        onNotice(next ? "基础模型已启用" : "基础模型已停用（文件仍保留，可随时重新启用）");
        await refresh();
        /* 正向联动：启用本机 ⇒ 播报切回本机；停用本机且云端可用 ⇒ 播报切到云端。 */
        if (next) await apply({ tts: { ...settings.tts, remote: false } });
        else if (mossTtsReady) {
          await apply({ tts: { ...settings.tts, remote: true, profileId: "" } });
          onNotice("播报已切到 MOSS（本机模型已停用）");
        }
      }
    } catch (e: any) {
      onNotice(`操作失败：${e?.message ?? e}`);
    } finally {
      setBaseBusy(false);
      setConfirmDisableBase(false);
    }
  }, [apply, mossTtsReady, onNotice, refresh, settings.tts]);

  return (
    <div className="voice-engines">
      {!speechReady && (
        <div className="voice-engine-empty">
          <TriangleAlert size={13} />
          <span>
            {speech?.reason
              ? <>{speech.reason}。</>
              : <>现在<strong>没有可用的合成引擎</strong>，语音通话与播报都无法出声。</>}
            点「基础模型（本地）」的「配置」下载基础语音模型；只用远程语音时，点「付费云端模型」的「配置」填 MOSS 密钥。
          </span>
        </div>
      )}
      {!anyReady && speech?.effective === "moss" && speech.ready && (
        <div className="voice-card-hint">
          本机合成模型未安装，<strong>播报已走 MOSS-TTS（远程）</strong>；语音通话要启用 MOSS-Live，或安装基础模型后走本地。
        </div>
      )}

      <div className="voice-model-grid">
        {/* ① 基础模型（本地）：一级界面只留摘要，模型/引擎/音色/克隆全进「配置」弹窗 */}
        <div className={`voice-model-card${localActive ? " is-active" : ""}${anyReady ? " is-ready" : ""}`}>
          <div className="voice-model-head">
            <span className="voice-model-icon"><HardDrive size={16} /></span>
            <div className="voice-model-titleblock">
              <div className="voice-model-name"><strong>基础模型（本地）</strong><span className="voice-engine-tag">免费 · 本机运行</span></div>
              <div className="voice-model-sub">离线合成 · 不联网 · 不额外付费</div>
            </div>
            {localActive && <span className="voice-engine-flag"><Check size={12} />使用中</span>}
            <span className={`voice-engine-state${anyReady ? " ok" : ""}`}>
              {anyReady ? (currentDisabled ? "已停用" : "已安装") : "未安装"}
            </span>
          </div>
          <div className="voice-model-meta">
            <span>{packLabel(current)}</span>
            <span>{cloneActive ? "克隆音色（优先）" : settings.tts.profileId ? "克隆音色" : "内置音色"}</span>
            <span>{cloneActive ? (cloneReady ? "克隆音色就绪" : "克隆音色未就绪") : anyReady ? "本机可用" : "未就绪"}</span>
          </div>
          <div className="voice-model-checks">
            <span className={anyReady ? "is-ok" : ""}>
              {anyReady ? <Check size={12} /> : <TriangleAlert size={12} />}语音识别
            </span>
            <span className={anyReady ? "is-ok" : ""}>
              {anyReady ? <Check size={12} /> : <TriangleAlert size={12} />}断句 / 端点
            </span>
            <span className={anyReady && !currentDisabled ? "is-ok" : ""}>
              {anyReady && !currentDisabled ? <Check size={12} /> : <TriangleAlert size={12} />}本机播报
            </span>
            <span className={zipVoiceReady ? "is-ok" : ""}>
              {zipVoiceReady ? <Check size={12} /> : <TriangleAlert size={12} />}音色克隆
            </span>
          </div>
          <div className="voice-model-note">模型下载、引擎、音色与克隆都在「配置」里。</div>
          <div className="voice-engine-actions">
            {!anyReady || currentDisabled ? (
              <button
                className="primary-setting"
                disabled={baseBusy}
                title={anyReady ? "重新启用基础模型（文件还在，无需重新下载）" : "还没下载基础模型：点「配置」下载或本地导入"}
                onClick={() => {
                  if (!anyReady) { onNotice("还没下载基础模型：点「配置」下载或本地导入"); return; }
                  void toggleBase(true);
                }}
              >
                {baseBusy ? <LoaderCircle size={13} className="spin" /> : <Power size={13} />}启用
              </button>
            ) : (
              <button
                className="secondary-setting"
                disabled={baseBusy}
                onClick={() => {
                  if (!confirmDisableBase) { setConfirmDisableBase(true); window.setTimeout(() => setConfirmDisableBase(false), 3000); return; }
                  void toggleBase(false);
                }}
              >
                {baseBusy ? <LoaderCircle size={13} className="spin" /> : <Power size={13} />}{confirmDisableBase ? "确认停用" : "停用"}
              </button>
            )}
            <button className={anyReady ? "secondary-setting" : "primary-setting"} onClick={() => setLocalModalOpen(true)}>
              <Settings2 size={13} />配置
            </button>
            <button className="secondary-setting" onClick={() => void window.codex.voiceModelsReveal().catch(() => undefined)}>
              <FolderOpen size={13} />打开目录
            </button>
          </div>
        </div>

        {/* 本地配置弹窗（模型 / 引擎 / 音色 / 克隆）—— 与云端那张卡的弹窗内容完全不同 */}
        {localModalOpen && createPortal((
          <div className="voice-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setLocalModalOpen(false); }}>
            <div className="voice-moss-modal voice-local-modal" role="dialog" aria-modal="true" aria-label="基础模型配置">
              <div className="voice-moss-modal-head">
                <strong>基础模型（本地）</strong>
                <button type="button" className="voice-confirm-close" aria-label="关闭" onClick={() => setLocalModalOpen(false)}>
                  <X size={15} />
                </button>
              </div>
              <div className="voice-moss-modal-body">
                <div className="voice-moss-section-title">模型与引擎</div>
                <div className="voice-engine-grid">
          {/* ⛔ 11-01 用户令：EmotiVoice 的生成器 ONNX 托管地址没配（EMOTIVOICE_ONNX_BASE），
              下载必然失败 —— 与其让用户点了白等、看着红字报错，不如**先不展示**。
              数据与后端通道都保留（配好地址后把这一行过滤删掉即可恢复）。 */}
          {ENGINES.filter((engine) => engine.id !== "emotivoice").map((engine) => {
            const state = packs[engine.id];
            const ready = Boolean(state?.ready);
            const enabled = state?.enabled !== false;
            const selected = current === engine.id;
            /* ⛔⛔ 10-26 用户实测：「我都没下载，怎么显示使用中」——
               `使用中` 是**能力声明**（能拿它合成），不是"设置里选了它"。
               11-11 又抓到同型另一半：停用后文件仍在（ready=true）却照样打「使用中」，
               下面却露出「启用」按钮。⇒ 在用 = 选中 **且** 已安装 **且** 未停用。 */
            const inUse = selected && ready && enabled;
            const selectedDisabled = selected && ready && !enabled;
            const downloading = busy === engine.id || progress?.pack === engine.id;
            return (
              <div
                key={engine.id}
                className={`voice-engine-card${inUse ? " is-active" : ""}${(selected && !ready) || selectedDisabled ? " is-pending" : ""}${ready ? " is-ready" : ""}`}
              >
                <div className="voice-engine-head">
                  <div className="voice-engine-title">
                    <span className="voice-engine-name-row">
                      <strong>{engine.name}</strong>
                      <span className={`voice-engine-tag${engine.isDefault ? " is-default" : ""}`}>{engine.badge}</span>
                    </span>
                    <span className="voice-engine-tagline">{engine.tagline}</span>
                  </div>
                  <div className="voice-engine-head-right">
                    {inUse && <span className="voice-engine-flag"><Check size={12} />使用中</span>}
                    {selectedDisabled && (
                      <span className="voice-engine-flag is-missing"><Power size={12} />已停用</span>
                    )}
                    {selected && !ready && (
                      <span className="voice-engine-flag is-missing"><TriangleAlert size={12} />缺模型</span>
                    )}
                    <div className="voice-engine-actions">
                      {ready ? (
                        <>
                          <button className="secondary-setting" onClick={() => choose(engine.id)} disabled={inUse} title={selectedDisabled ? "先在下方卡片点「启用」" : undefined}>
                            {inUse ? "使用中" : selectedDisabled ? "已停用" : "用它"}
                          </button>
                          {engine.id !== "vits" && (
                            <button className="secondary-setting" onClick={() => void remove(engine.id)} title="删除这个引擎的模型文件">
                              <Trash2 size={13} />删除
                            </button>
                          )}
                        </>
                      ) : engine.id === "vits" ? null : (
                        <button className="secondary-setting" onClick={() => void install(engine.id)} disabled={downloading}>
                          {downloading ? <><LoaderCircle size={13} className="spin" />下载中…</> : <><Download size={13} />下载引擎包</>}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="voice-engine-meta">
                  <span>{engine.speakerCount}</span>
                  <span>{engine.id === "vits" ? "随基础模型" : `${Math.round(engine.sizeMB)}MB`}</span>
                  <span className={`voice-engine-state${ready && enabled ? " ok" : ""}`}>{!ready ? "未安装" : enabled ? "已安装" : "已停用"}</span>
                </div>

                <div className="voice-engine-role">{engine.role}</div>

                {/* 优点/缺点并排（窄宽度自动落成上下两段）——长卡片下这样不浪费横向空间 */}
                <div className="voice-engine-lists">
                  <ul className="voice-engine-pros">
                    {engine.pros.map((p) => <li key={p}><Check size={12} />{p}</li>)}
                  </ul>
                  <ul className="voice-engine-cons">
                    {engine.cons.map((c) => <li key={c}><TriangleAlert size={12} />{c}</li>)}
                  </ul>
                </div>

                {/* ⛔ 10-31 用户令：「这两个卡片重复了，保留下面的就行了，把打开目录、卸载、停用放到卡片上去」——
                    基础模型（必需）不再单独占一张卡：路径 / 下载导入 / 打开目录 / 停用 / 删除 / 全部清空
                    全部并进「轻量播报」这张卡（它本来就写着「装完基础模型就能用」）。
                    ⛔ compact 模式复用 VoiceDevToolsSection 的全部状态与动作逻辑（不复制第二套 IPC 调用）。 */}
                {engine.id === "vits" && <VoiceDevToolsSection compact only="base" onNotice={onNotice} onStatusChange={refresh} />}

                {/* 下载中：进度条 + 百分比 + 主进程给的阶段说明（"已下载 42MB / 140MB" 这类） */}
                {downloading && (
                  <div className="voice-engine-progress">
                    <div className="voice-engine-progress-bar">
                      <span style={{ width: `${(progress?.percent ?? 0) >= 0 ? progress?.percent : 8}%` }} />
                    </div>
                    <div className="voice-engine-progress-line">
                      <small>{progress?.message ?? "下载中…"}</small>
                      <b>{(progress?.percent ?? -1) >= 0 ? `${Math.round(progress!.percent)}%` : "…"}</b>
                      {/* ⛔ 11-01：取消入口必须在**这一张卡**上（它才知道取消哪个包）。 */}
                      <button type="button" className="voice-engine-cancel" onClick={() => void cancelPack(engine.id)}>
                        <X size={12} />取消
                      </button>
                    </div>
                  </div>
                )}
                {/* 结果反馈：成功 / 失败 / 已切换 —— 卡片内留一条，不靠一闪而过的提示 */}
                {flash?.pack === engine.id && (
                  <div className={`voice-engine-feedback is-${flash.kind}`}>
                    {flash.kind === "ok" ? <Check size={12} />
                      : flash.kind === "err" ? <TriangleAlert size={12} />
                      : <Sparkles size={12} />}
                    <span>{flash.text}</span>
                  </div>
                )}
                {engine.id === "emotivoice" && !state?.runnable && (
                  <div className="voice-engine-note">
                    模型可下载，但合成能力要等 ONNX 推理运行时接入后才可用（点了会给说明，不会静默失败）。
                    {state?.hostNote ? ` 当前：${state.hostNote}` : ""}
                  </div>
                )}
              </div>
            );
          })}
        </div>
                {localExtra && (
                  <>
                    <div className="voice-moss-section-title">音色与克隆</div>
                    {localExtra}
                  </>
                )}
              </div>
            </div>
          </div>
        ), document.body)}

        {/* ② 付费云端模型：与左侧卡**同结构、同尺寸**（行高由 CSS 固定，内容多少都一样高） */}
        <div className={`voice-model-card${remoteActive ? " is-active" : ""}${moss?.configured ? " is-ready" : ""}`}>
          <div className="voice-model-head">
            <span className="voice-model-icon"><Cloud size={16} /></span>
            <div className="voice-model-titleblock">
              <div className="voice-model-name"><strong>MOSS-Live</strong><span className="voice-engine-tag">付费云端 · 全双工</span></div>
              <div className="voice-model-sub">边听边说 · 自然打断 · 不占本机磁盘</div>
            </div>
            {remoteActive && <span className="voice-engine-flag"><Check size={12} />使用中</span>}
            <span className={`voice-engine-state${moss?.configured ? " ok" : ""}`}>
              {moss?.configured ? "已配置" : "未配置"}
            </span>
          </div>
          <div className="voice-model-meta">
            <span>{moss?.model || "moss-live-1.0"}</span>
            <span>{callBackend ? "实时通话已启用" : "实时通话未启用"}</span>
            <span>{cloneActive ? (cloneReady ? "克隆音色" : "克隆音色未就绪") : ttsRemote ? (mossTtsReady ? "MOSS 播报" : "MOSS 缺配置") : "播报本地"}</span>
          </div>
          <div className="voice-model-checks">
            <span className={mossInUse ? "is-ok" : ""}>
              {mossInUse ? <Check size={12} /> : <TriangleAlert size={12} />}实时通话{mossInUse ? "使用中" : mossBroken ? "配置不完整" : "未启用"}
            </span>
            <span className={(cloneSelected ? cloneReady : mossTtsReady) ? "is-ok" : ""}>
              {(cloneSelected ? cloneReady : mossTtsReady) ? <Check size={12} /> : <TriangleAlert size={12} />}播报{cloneSelected ? (cloneReady ? "克隆音色" : "未就绪") : ttsRemote ? (mossTtsReady ? "MOSS" : "缺配置") : "本地"}
            </span>
            <span className={moss?.configured ? "is-ok" : ""}>
              {moss?.configured ? <Check size={12} /> : <TriangleAlert size={12} />}接口 / 模型{moss?.configured ? "已填" : "未填"}
            </span>
            <span className={moss?.hasKey ? "is-ok" : ""}>
              {moss?.hasKey ? <Check size={12} /> : <TriangleAlert size={12} />}API 密钥{moss?.hasKey ? "已保存" : "缺失"}
            </span>
          </div>
          <div className="voice-model-note">需提供方 API 密钥；连不上会回落本地语音。</div>
          <div className="voice-engine-actions">
            <button
              className={callBackend ? "secondary-setting" : "primary-setting"}
              onClick={() => {
                void (async () => {
                  if (!moss?.configured) { setMossModalOpen(true); onNotice("先填好地址、模型和 API 密钥再启用"); return; }
                  await setCallBackend(!callBackend);
                  /* 反向联动：启用云端 ⇒ 播报也切到云端（清克隆）；停用 ⇒ 播报切回本机。 */
                  if (!callBackend) await apply({ tts: { ...settings.tts, remote: true, profileId: "" } });
                  else await apply({ tts: { ...settings.tts, remote: false } });
                })();
              }}
            >
              <Power size={13} />{callBackend ? "停用" : "启用"}
            </button>
            <button className="secondary-setting" onClick={() => setMossModalOpen(true)}>
              <Settings2 size={13} />配置
            </button>
            <button
              className="secondary-setting"
              disabled={previewing || !(mossTtsDraft.voiceId || savedMossTts?.voiceId)}
              onClick={() => void auditionMoss()}
              title={(mossTtsDraft.voiceId || savedMossTts?.voiceId) ? "用 MOSS 音色试听一句" : "先在「配置」里选择音色"}
            >
              {previewing ? <LoaderCircle size={13} className="spin" /> : <Play size={13} />}试听音色
            </button>
          </div>
          {mossBroken && (
            <div className="voice-engine-feedback is-err">
              <TriangleAlert size={12} />
              <span>已选为实时通话后端，但地址 / 模型 / 密钥不完整 —— 通话会回落本地语音；点「配置」补齐。</span>
            </div>
          )}
          {ttsRemote && !cloneActive && !mossTtsReady && mossTts?.error && (
            <div className="voice-engine-feedback is-err">
              <TriangleAlert size={12} />
              <span>{mossTts.error}</span>
            </div>
          )}
        </div>
      </div>

        {mossModalOpen && createPortal((
          <div
            className="voice-confirm-backdrop"
            onMouseDown={(event) => { if (event.target === event.currentTarget) setMossModalOpen(false); }}
          >
            <div className="voice-moss-modal" role="dialog" aria-modal="true" aria-label="MOSS-Live 配置">
              <div className="voice-moss-modal-head">
                <strong>MOSS-Live 配置</strong>
                <button type="button" className="voice-confirm-close" aria-label="关闭" onClick={() => setMossModalOpen(false)}>
                  <X size={15} />
                </button>
              </div>
              <div className="voice-moss-modal-body">
                <div className="voice-moss-section-title">实时通话</div>
                <div className="voice-remote-form">
                  <label>接口地址
                    <input value={mossDraft.baseUrl} placeholder="wss://api.mosi.cn/v1/realtime"
                      onChange={(e) => setMossDraft((d) => ({ ...d, baseUrl: e.target.value }))} />
                  </label>
                  <label>模型
                    <input value={mossDraft.model} placeholder="moss-live-1.0"
                      onChange={(e) => setMossDraft((d) => ({ ...d, model: e.target.value }))} />
                  </label>
                  <label>API 密钥
                    <input type="password" value={mossDraft.apiKey}
                      placeholder={moss?.hasKey ? `已配置 ····${moss.keyHint}（留空沿用）` : "sk-…"}
                      onChange={(e) => setMossDraft((d) => ({ ...d, apiKey: e.target.value }))} />
                  </label>
                  <div className="voice-remote-actions">
                    <button className="secondary-setting" onClick={() => void saveMoss()}>保存配置</button>
                    <button className="secondary-setting" onClick={() => setMossDraft((d) => ({ ...d, baseUrl: "wss://api.mosi.cn/v1/realtime", model: "moss-live-1.0" }))}>填入官方地址</button>
                    {moss?.docs && (
                      <button className="secondary-setting" onClick={() => void window.codex.openExternal(moss.docs!)}>官方文档</button>
                    )}
                  </div>
                </div>
                <div className="voice-remote-toggle">
                  <div>
                    <strong>用作实时通话后端</strong>
                    <span>开 = 通话走 MOSS-Live；连不上会自动回落本地语音，不会静默失败。</span>
                  </div>
                  <ToggleSwitch checked={callBackend} label="用作实时通话后端" onChange={(next) => void setCallBackend(next)} />
                </div>
                {mossLooksLikeTts && (
                  <div className="voice-engine-feedback is-err">
                    <TriangleAlert size={12} />
                    <span>当前是普通语音合成（TTS）地址/模型。实时通话请用官方地址 wss://api.mosi.cn/v1/realtime + 模型 moss-live-1.0（可点「填入官方地址」）。</span>
                  </div>
                )}

                <div className="voice-moss-section-title">语音播报（MOSS-TTS）</div>
                <div className="voice-engine-note">
                  播报是否走 MOSS 在上一级「播报」卡里选（「播报使用」）；这里只配 MOSS 的模型、音色与语速。音色与实时通话共用，克隆音色仍优先本地。
                </div>
                <div className="voice-remote-form">
                  <label>TTS 模型
                    <input value={mossTtsDraft.model} placeholder="moss-tts-1.5-flash"
                      onChange={(e) => setMossTtsDraft((d) => ({ ...d, model: e.target.value }))} />
                  </label>
                  <label>音色 ID（通话 / 播报共用）
                    <input value={mossTtsDraft.voiceId} placeholder="点「查询音色」选择一个"
                      onChange={(e) => setMossTtsDraft((d) => ({ ...d, voiceId: e.target.value }))} />
                  </label>
                  {/* 11-11 用户令「MOSS 没有播报速度调整，加一个」：与全局语速共用 tts.speed（单一真相源）。 */}
                  <div className="voice-moss-speed">
                    <div className="voice-engine-meta">
                      <span>播报语速</span>
                      <span>{settings.tts.speed.toFixed(2)}×</span>
                    </div>
                    <div className="voice-speed-presets" role="group" aria-label="MOSS 播报语速">
                      {VOICE_SPEED_PRESETS.map((speed) => (
                        <button
                          key={speed}
                          type="button"
                          className={`voice-speed-chip${Math.abs(settings.tts.speed - speed) < 0.001 ? " is-active" : ""}`}
                          onClick={() => void apply({ tts: { ...settings.tts, speed } })}
                        >
                          {speed}×
                        </button>
                      ))}
                    </div>
                    <input
                      className="voice-range"
                      type="range"
                      min={0.5}
                      max={2.0}
                      step={0.05}
                      value={settings.tts.speed}
                      onChange={(e) => void apply({ tts: { ...settings.tts, speed: Number(e.target.value) } })}
                    />
                    <div className="voice-card-hint">与上方「语速」是同一个值（通话 / 本地播报 / MOSS 播报共用）。</div>
                  </div>
                  {mossVoices.length > 0 && (
                    <label>从列表选择
                      <AppSelect
                        value={mossTtsDraft.voiceId}
                        onChange={(id) => setMossTtsDraft((d) => ({ ...d, voiceId: id }))}
                        ariaLabel="MOSS 音色"
                        options={mossVoices.map((voice) => ({ value: voice.id, label: voice.name }))}
                      />
                    </label>
                  )}
                  <div className="voice-remote-actions">
                    <button className="secondary-setting" onClick={() => void queryMossVoices()}>查询音色</button>
                    <button className="secondary-setting" disabled={previewing || !mossTtsDraft.voiceId} onClick={() => void auditionMoss()}>
                      {previewing ? <LoaderCircle size={13} className="spin" /> : <Play size={13} />}试听
                    </button>
                    <button className="secondary-setting" onClick={() => void saveMossTts()}>保存播报配置</button>
                  </div>
                </div>
                <div className="voice-engine-note">
                  对话内容会发送到提供方服务器；离线不可用。实时通话是 WebSocket 长连接（上行 16k PCM16，下行 48k PCM16）；播报是 48k WAV。连不上都会如实报错。
                </div>
              </div>
            </div>
          </div>
        ), document.body)}

    </div>
  );
}

function packLabel(id: PackId): string {
  return ENGINES.find((e) => e.id === id)?.name ?? "轻量播报";
}
