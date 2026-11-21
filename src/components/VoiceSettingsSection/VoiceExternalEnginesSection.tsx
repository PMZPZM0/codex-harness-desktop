/**
 * 开源语音模型卡片（11-16 用户令；11-17 改二级弹窗）
 *
 * 用户口径（11-17）：「音色选择就放到每个语音模型卡片里面，语音模型卡片做二级弹窗预览里面设置」
 *   ⇒ 一级卡片只做摘要（名称 / 徽标 / 体积 / 状态 / 下载进度），点卡片进**该引擎自己的二级弹窗**：
 *     启用、安装/卸载、目录、音色（原生默认音色 / 内置参考样本 / 我的音色）、许可与硬件详情。
 *
 * ⛔ 目录与状态来自主进程 `voice:external-list`（单一真相源）；
 *   进度复用 `voice:event` 的 download/downloadDone，target = external:<id>；
 *   服务状态推进（type=service）也会刷新卡片 —— 否则永远停在「启动中」。
 * ⛔ 非商用权重（F5 / Fish / IndexTTS-2.0）必须在卡片上显式打徽标。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Download, ExternalLink, FolderOpen, LoaderCircle, Play, Square, Trash2, TriangleAlert, X } from "lucide-react";
import { ToggleSwitch } from "../SettingsWidgets";
import { SettingsDialog } from "../SettingsDialog";
import { decodeFloat32Base64 } from "../../voice/audio-transport";
import { playSamples } from "../VoiceSettingsSection";
import { VOICE_EXTERNAL_CATEGORIES, VOICE_EXTERNAL_DEFAULT_IDS, isHighDemand } from "../../lib/voice-external-engines.mjs";
import type { Settings } from "../VoiceSettingsSection";

type EngineCard = {
  id: string;
  name: string;
  category: string;
  recommended: boolean;
  kind: "engine" | "studio" | "webui";
  adapter: string | null;
  repo: string;
  license: string;
  licenseNote: string;
  commercial: string;
  commercialLabel: string;
  badge?: string;
  languages: string;
  sizeLabel: string;
  vram: string;
  demand: "high" | "medium" | "light";
  hardware: string;
  tagline: string;
  pros: string[];
  cons: string[];
  installable: boolean;
  installed: boolean;
  enabled: boolean;
  /** 11-17：引擎自带默认音色（Chatterbox 的 conds.pt），音色列表多一项。 */
  nativeVoice?: boolean;
  /** 11-17：开箱默认音色（没手动选过时用它；随包默认音色，不依赖本机基础模型）。 */
  defaultVoice?: string;
  /** 11-17 mac 适配：当前平台是否支持安装/运行（false = 仅展示，别让用户白下 8GB）。 */
  supported?: boolean;
  /** 11-17：「怎么用」步骤（目录里的单一真相源，弹窗里逐条展示）。 */
  usage?: string[];
  service: string;
  serviceError: string;
};

type ListPayload = { engines: EngineCard[]; active: string };

const CATEGORY_NAME: Record<string, string> = Object.fromEntries(VOICE_EXTERNAL_CATEGORIES.map((entry) => [entry.id, entry.name]));

/** 卡片状态文案（安装/服务两态合并成一句人话）。 */
function statusOf(engine: EngineCard): string {
  if (!engine.installed) return "未安装";
  if (engine.enabled) return engine.service === "running" ? "使用中" : engine.service === "starting" ? "启动中…" : "已启用";
  return "已安装";
}

export default function VoiceExternalEnginesSection({ onNotice, onActiveChange, settings, apply }: {
  onNotice: (message: string) => void;
  /** 当前启用的引擎（null = 没有）；父组件据此把本机模型标成「兜底」，保证全局面只有一个「使用中」。 */
  onActiveChange?: (engine: { id: string; name: string } | null) => void;
  /** 当前设置（读 engineVoice / profileId）与写回（切引擎音色）。 */
  settings?: Settings | null;
  apply?: (patch: Partial<Settings>) => void | Promise<void>;
}) {
  const [data, setData] = useState<ListPayload | null>(null);
  const [category, setCategory] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const [progress, setProgress] = useState<Record<string, { percent: number; message: string }>>({});
  /**
   * 卸载进度（与安装分开一份）。
   * ⛔ 11-22 用户实测「所有语音模型卸载都没有反馈，也没有气泡小弹窗提醒」，截图标题栏是
   *    「未响应」—— 真因是主进程同步 rmSync 删 8GB 目录把整个应用卡死（见 removeExternalEngine）。
   *    现在删除改成异步逐文件 + 推 remove 事件，这里必须**渲染出来**，否则等于没修。
   */
  const [removing, setRemoving] = useState<Record<string, { percent: number; message: string }>>({});
  const [toggling, setToggling] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  /* 不可安装的平台型卡片（Fish / Zonos 等）没有配置弹窗，详情就在卡内展开。 */
  const [details, setDetails] = useState<string | null>(null);
  /* 11-17：点卡片进二级弹窗，配置（启用/安装/音色/详情）都在弹窗里。 */
  const [configId, setConfigId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  /* 引擎音色 = 随包默认音色（不依赖模型）+ 本机模型说话人样本 + 我的音色。 */
  const [builtins, setBuiltins] = useState<{ sid: number; name: string }[]>([]);
  const [presets, setPresets] = useState<{ id: string; name: string; desc?: string; lang?: string }[]>([]);
  const [profiles, setProfiles] = useState<{ id: string; name: string; builtIn?: boolean }[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  /* 11-17 用户实测「都没有试听功能」：每个引擎的每行音色都要能**用这个引擎自己**合成试听。 */
  const [voicePreview, setVoicePreview] = useState<{ key: string; phase: "synth" | "playing" } | null>(null);
  const previewCtlRef = useRef<{ stop: () => void } | null>(null);
  useEffect(() => () => { previewCtlRef.current?.stop(); previewCtlRef.current = null; }, []);

  const refresh = () => {
    window.codex.voiceExternalList()
      .then((payload) => {
        const next = payload as ListPayload;
        setData(next);
        setLoadError("");
        const active = (next?.engines ?? []).find((engine) => engine.enabled);
        onActiveChange?.(active ? { id: active.id, name: active.name } : null);
      })
      .catch((error) => setLoadError(String((error as Error)?.message ?? error)));
  };

  useEffect(() => {
    refresh();
    const unsubscribe = window.codex.onVoiceEvent((event) => {
      const target = String((event as { target?: string })?.target ?? "");
      if (!target.startsWith("external:")) return;
      const id = target.slice("external:".length);
      const type = String((event as { type?: string })?.type ?? "");
      /* 服务状态推进（starting → running/error/stopped）也要立刻刷新 —— 否则卡片永远停在
         「启动中… 模型加载中」（用户实测：模型其实 68 秒就绪了，界面还挂着加载中）。 */
      if (type === "service") { refresh(); return; }
      if (type === "download") {
        const percent = Number((event as { percent?: number })?.percent ?? -1);
        const message = String((event as { message?: string })?.message ?? "");
        setProgress((current) => ({ ...current, [id]: { percent, message } }));
        return;
      }
      /* 卸载进度（11-22）：主进程逐文件删 8GB 级目录时每批推一次，界面必须动起来。 */
      if (type === "remove") {
        const percent = Number((event as { percent?: number })?.percent ?? -1);
        const message = String((event as { message?: string })?.message ?? "");
        setRemoving((current) => ({ ...current, [id]: { percent, message } }));
        return;
      }
      if (type === "removeDone") {
        setRemoving((current) => { const next = { ...current }; delete next[id]; return next; });
        refresh();
        const ok = Boolean((event as { ok?: boolean })?.ok);
        const error = String((event as { error?: string })?.error ?? "");
        if (ok) onNotice("已卸载（安装目录已删除）");
        else onNotice(`卸载失败：${error || "未知错误"}`);
        return;
      }
      if (type === "downloadDone") {
        setProgress((current) => { const next = { ...current }; delete next[id]; return next; });
        refresh();
        const ok = Boolean((event as { ok?: boolean })?.ok);
        const error = String((event as { error?: string })?.error ?? "");
        onNotice(ok ? "外部引擎安装完成，可在卡片上启用" : `外部引擎安装失败：${error || "未知错误"}`);
      }
    });
    return () => unsubscribe?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 本机卡把外部引擎关掉时（「启用本机」），通知这里重拉，避免卡片还显示「使用中」。 */
  useEffect(() => {
    const onRefresh = () => refresh();
    window.addEventListener("harness:voice-external-refresh", onRefresh);
    return () => window.removeEventListener("harness:voice-external-refresh", onRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 引擎音色：内置参考样本（首次会现生成）+ 我的音色。 */
  useEffect(() => {
    let alive = true;
    window.codex.voiceProfilesList()
      .then((r) => { if (alive) setProfiles(Array.isArray(r?.profiles) ? r.profiles.map((p: { id: string; name?: string; builtIn?: boolean }) => ({ id: String(p.id), name: String(p.name || "我的音色"), builtIn: p.builtIn === true })) : []); })
      .catch(() => undefined);
    setVoicesLoading(true);
    window.codex.voiceExternalVoices()
      .then((r) => {
        if (!alive) return;
        setBuiltins(Array.isArray(r?.voices) ? r.voices.map((v: { sid: number; name: string }) => ({ sid: Number(v.sid), name: String(v.name) })) : []);
        setPresets(Array.isArray(r?.presets) ? r.presets.map((p: { id: string; name: string; desc?: string; lang?: string }) => ({ id: String(p.id), name: String(p.name), desc: p.desc, lang: p.lang })) : []);
      })
      .catch(() => undefined)
      .finally(() => { if (alive) setVoicesLoading(false); });
    return () => { alive = false; };
  }, []);

  const engines = data?.engines ?? [];
  /* 兜底轮询：有引擎在启动时每 2 秒刷新一次（事件丢失也不会永远停在「启动中…」）。 */
  const anyStarting = engines.some((engine) => engine.enabled && engine.service === "starting");
  useEffect(() => {
    if (!anyStarting) return;
    const timer = window.setInterval(() => refresh(), 2000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyStarting]);

  const recommended = useMemo(() => {
    const set = new Set(VOICE_EXTERNAL_DEFAULT_IDS);
    return VOICE_EXTERNAL_DEFAULT_IDS.map((id) => engines.find((engine) => engine.id === id)).filter((engine): engine is EngineCard => Boolean(engine) && set.has(engine!.id));
  }, [engines]);
  const filtered = category === "all" ? engines : engines.filter((engine) => engine.category === category);
  const visible = category === "all" && !expanded ? recommended : filtered;
  const hiddenCount = Math.max(0, filtered.length - visible.length);
  const configEngine = configId ? engines.find((engine) => engine.id === configId) : undefined;
  /* 弹窗顶部的进度条：安装与卸载共用一条位置（同一时刻只会有一个在进行）。 */
  const configBusy = configEngine ? removing[configEngine.id] ?? progress[configEngine.id] : undefined;
  const configRemoving = Boolean(configEngine && removing[configEngine.id]);

  /** 每个引擎自己的音色（默认音色 / 模型说话人 / 我的音色）——三组分开列，不再混在一个下拉里。 */
  const myProfiles = profiles.filter((profile) => !profile.builtIn);
  const voiceGroupsFor = (engine: EngineCard) => {
    const groups: { title: string; hint: string; items: { value: string; label: string; tag: string }[] }[] = [];
    if (engine.nativeVoice) {
      groups.push({ title: "引擎默认音色", hint: "模型自带，无需参考音频", items: [{ value: "native", label: "默认音色", tag: "自带" }] });
    }
    if (presets.length) {
      groups.push({
        title: "默认音色",
        hint: "随应用自带的参考音色，装上引擎就能用（不依赖本机基础模型）",
        items: presets.map((preset) => ({ value: `preset:${preset.id}`, label: preset.name, tag: preset.lang === "en" ? "英" : "中" })),
      });
    }
    if (builtins.length) {
      groups.push({
        title: "模型音色",
        hint: "用本机基础模型的真实说话人生成（首次约 10 秒）",
        items: builtins.map((voice) => ({ value: `builtin:${voice.sid}`, label: voice.name, tag: "模型" })),
      });
    }
    if (myProfiles.length) {
      groups.push({
        title: "我的音色",
        hint: "你自己导入 / 录制 / 克隆的参考音频",
        items: myProfiles.map((profile) => ({ value: `profile:${profile.id}`, label: profile.name, tag: "我的" })),
      });
    }
    return groups;
  };

  /** 该引擎当前生效的音色：自己的选择 > 老档案的 engineVoice（仅当对本引擎有效） > 开箱默认音色。 */
  const voiceFor = (engine: EngineCard) => {
    const own = String(settings?.tts?.engineVoices?.[engine.id] ?? "").trim();
    if (own) return own;
    const legacy = String(settings?.tts?.engineVoice ?? "").trim();
    if (legacy && (legacy !== "native" || engine.nativeVoice)) return legacy;
    return String(engine.defaultVoice ?? "");
  };

  const chooseVoice = (engine: EngineCard, value: string) => {
    if (!settings?.tts) return;
    /* ⛔ 按引擎独立落盘：换引擎不串音色（用户要求「每个语音模型配置独立、互不影响」）。 */
    void apply?.({ tts: { ...settings.tts, engineVoices: { ...(settings.tts.engineVoices ?? {}), [engine.id]: value } } });
    const picked = voiceGroupsFor(engine).flatMap((group) => group.items).find((item) => item.value === value)?.label ?? value;
    onNotice(`「${engine.name}」音色已切换到：${picked}`);
  };

  /**
   * 用**指定引擎 + 指定音色**合成并播放（11-17 用户：「不会每个音色在不同语音模型播放都一样吧」）。
   * ⛔ 同一时间只运行一个外部引擎：引擎没启用时先启用它（会停掉当前那个），试听后保持启用态，
   *    这样用户能直接对比不同引擎对同一段参考音色的还原差异（不是同一份音频换皮）。
   */
  const previewEngineVoice = async (engine: EngineCard, value: string) => {
    const key = `${engine.id}:${value}`;
    if (voicePreview?.key === key && voicePreview.phase === "playing") {
      previewCtlRef.current?.stop();
      return;
    }
    previewCtlRef.current?.stop();
    previewCtlRef.current = null;
    setVoicePreview({ key, phase: "synth" });
    try {
      if (!engine.enabled) {
        const previous = (data?.engines ?? []).find((entry) => entry.enabled && entry.id !== engine.id);
        const result = await window.codex.voiceExternalEnable(engine.id, true);
        if (!result?.ok) { onNotice(result?.error || "启用引擎失败，无法试听"); return; }
        refresh();
        onNotice(`正在用 ${engine.name} 试听${previous ? `（${previous.name} 已自动停用）` : ""}${engine.service === "running" ? "" : "；首次加载模型要 10–60 秒"}`);
      }
      const result = await window.codex.voicePreviewVoice({
        engineId: engine.id,
        engineVoice: value,
        speed: Number(settings?.tts?.speed ?? 1),
        text: "你好，我是你的语音助手，很高兴为你服务。",
      });
      if (!result?.ok) { onNotice(`试听失败：${result?.error ?? "未知"}`); return; }
      const samples = decodeFloat32Base64(result.audioBase64);
      if (!samples.length) { onNotice("试听失败：合成结果没有音频数据"); return; }
      const ctl = await playSamples(samples, result.sampleRate);
      previewCtlRef.current = ctl;
      setVoicePreview({ key, phase: "playing" });
      await ctl.done;
    } catch (error) {
      onNotice(`试听失败：${String((error as Error)?.message ?? error)}`);
    } finally {
      previewCtlRef.current = null;
      setVoicePreview(null);
    }
  };

  const install = async (engine: EngineCard) => {
    if (progress[engine.id]) return;
    setProgress((current) => ({ ...current, [engine.id]: { percent: 0, message: "准备下载…" } }));
    try {
      const result = await window.codex.voiceExternalInstall(engine.id);
      if (!result?.ok) {
        setProgress((current) => { const next = { ...current }; delete next[engine.id]; return next; });
        onNotice(result?.error || "安装没能开始");
      }
    } catch (error) {
      setProgress((current) => { const next = { ...current }; delete next[engine.id]; return next; });
      onNotice(`安装失败：${String((error as Error)?.message ?? error)}`);
    }
  };

  const cancelInstall = (engine: EngineCard) => {
    void window.codex.voiceExternalCancel(engine.id).catch(() => undefined);
    setProgress((current) => { const next = { ...current }; delete next[engine.id]; return next; });
  };

  const toggle = async (engine: EngineCard, next: boolean) => {
    setToggling(engine.id);
    const previous = (data?.engines ?? []).find((entry) => entry.enabled && entry.id !== engine.id);
    try {
      const result = await window.codex.voiceExternalEnable(engine.id, next);
      if (!result?.ok) onNotice(result?.error || "切换失败");
      else onNotice(next
        ? `已启用 ${engine.name}${previous ? `（${previous.name} 已自动停用）` : ""}：播报/通话由它接管`
        : `已停用 ${engine.name}：播报回落到本机 / MOSS`);
      refresh();
    } catch (error) {
      onNotice(`切换失败：${String((error as Error)?.message ?? error)}`);
    } finally {
      setToggling(null);
    }
  };

  const remove = async (engine: EngineCard) => {
    if (confirmRemove !== engine.id) {
      setConfirmRemove(engine.id);
      window.setTimeout(() => setConfirmRemove((current) => (current === engine.id ? null : current)), 3000);
      return;
    }
    setConfirmRemove(null);
    /* ⛔ 11-22：先落「正在卸载」态再 await —— 删除期间界面必须有东西在动。 */
    setRemoving((current) => ({ ...current, [engine.id]: { percent: -1, message: "正在停止引擎并删除文件…" } }));
    try {
      const result = await window.codex.voiceExternalRemove(engine.id);
      if (result?.ok) {
        onNotice(`${engine.name} 已卸载`);
        setConfigId(null);
      } else {
        onNotice(`卸载失败：${result?.error ?? "未知"}`);
      }
      refresh();
    } catch (error) {
      onNotice(`卸载失败：${String((error as Error)?.message ?? error)}`);
    } finally {
      setRemoving((current) => { const next = { ...current }; delete next[engine.id]; return next; });
    }
  };

  const open = (engine: EngineCard) => {
    void window.codex.voiceExternalOpen(engine.id).catch((error) => onNotice(`打开失败：${String((error as Error)?.message ?? error)}`));
  };

  return (
    <div className="voice-ext-section" data-external-engines>
      <div className="voice-ext-head">
        <strong>更多开源语音模型</strong>
        <span>按需下载、不随包；<strong>同一时间只生效一个</strong>（8GB 显存）。点卡片进入配置：启用、音色与安装都在里面；开启新引擎会自动停用当前的。</span>
      </div>
      <div className="voice-ext-hint">标「需高配」的引擎建议 12GB+ 显存；8GB 显卡优先用 Chatterbox / GPT-SoVITS / Qwen3 / CosyVoice。</div>
      <div className="voice-ext-hint">外部引擎的安装器与推理后端目前只适配 <strong>Windows</strong>；macOS / Linux 上用「基础模型」或 MOSS 即可，随包默认音色同样可用。</div>

      <div className="voice-ext-filters" role="group" aria-label="开源语音模型分类">
        {VOICE_EXTERNAL_CATEGORIES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`voice-ext-chip${category === entry.id ? " is-active" : ""}`}
            onClick={() => { setCategory(entry.id); }}
          >
            {entry.name}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="voice-ext-error">
          <TriangleAlert size={13} />
          <span>读取开源模型列表失败：{loadError}</span>
          <button type="button" className="secondary-setting" onClick={refresh}>重试</button>
        </div>
      )}

      {!data && !loadError && <div className="voice-ext-loading"><LoaderCircle size={13} className="spin" />读取中…</div>}

      <div className="voice-ext-grid">
        {visible.map((engine) => {
          const running = progress[engine.id];
          /* 卸载进度（11-22）：卡片上也要看得到 —— 用户可能已经关掉配置弹窗。 */
          const removingNow = removing[engine.id];
          /* 11-17 mac 适配：当前平台不支持的引擎与「纯展示卡片」同一处理 —— 不提供安装/配置入口。 */
          const unsupported = engine.supported === false;
          const isExternalOnly = engine.kind !== "engine" || !engine.installable || unsupported;
          return (
            <div key={engine.id} className={`voice-engine-card voice-ext-card${engine.enabled ? " is-active" : ""}`} data-external-card={engine.id}>
              <div className="voice-engine-head">
                <div className="voice-engine-title">
                  <span className="voice-engine-name-row">
                    <strong>{engine.name}</strong>
                    <span className={`voice-ext-badge is-${engine.commercial}`}>{engine.badge ?? engine.commercialLabel}</span>
                    {unsupported && <span className="voice-ext-badge is-no">当前平台不可用</span>}
                  </span>
                  <span className="voice-engine-tagline">{engine.tagline}</span>
                </div>
                <div className="voice-engine-head-right">
                  {engine.enabled && <span className="voice-engine-flag"><Check size={12} />使用中</span>}
                </div>
              </div>

              <div className="voice-engine-meta">
                <span>{engine.languages}</span>
                <span>{engine.sizeLabel}</span>
                <span>{engine.vram}</span>
                {isHighDemand(engine) && <span className="voice-ext-demand">需高配</span>}
              </div>

              <div className="voice-engine-role" title={engine.licenseNote}>{engine.licenseNote}</div>

              {running && (
                <div className="voice-engine-progress">
                  <div className="voice-engine-progress-bar">
                    <span style={{ width: `${running.percent >= 0 ? Math.min(99, running.percent) : 8}%` }} />
                  </div>
                  <div className="voice-engine-progress-line">
                    <small>{running.message || "安装中…"}</small>
                    <b>{running.percent >= 0 ? `${Math.round(running.percent)}%` : "…"}</b>
                    <button type="button" className="voice-engine-cancel" onClick={() => cancelInstall(engine)}><X size={12} />取消</button>
                  </div>
                </div>
              )}

              {removingNow && (
                <div className="voice-engine-progress" data-engine-removing={engine.id}>
                  <div className="voice-engine-progress-bar">
                    <span style={{ width: `${removingNow.percent >= 0 ? Math.min(99, removingNow.percent) : 8}%` }} />
                  </div>
                  <div className="voice-engine-progress-line">
                    <small>{removingNow.message || "正在卸载…"}</small>
                    <b>{removingNow.percent >= 0 ? `${Math.round(removingNow.percent)}%` : "…"}</b>
                  </div>
                </div>
              )}

              {engine.enabled && engine.service === "starting" && (
                <div className="voice-ext-starting">
                  <LoaderCircle size={12} className="spin" />
                  <span>模型加载中（可随时关闭）…</span>
                </div>
              )}

              {engine.enabled && engine.service === "error" && engine.serviceError && (
                <div className="voice-ext-service-error" title={engine.serviceError}>
                  <TriangleAlert size={12} />
                  <span>服务启动失败：{engine.serviceError}</span>
                </div>
              )}

              <div className="voice-ext-foot">
                <span className={`voice-ext-status${engine.installed ? " is-ok" : ""}`}>{statusOf(engine)}</span>
                <div className="voice-ext-actions">
                  {isExternalOnly ? (
                    <>
                      <button type="button" className="secondary-setting" onClick={() => open(engine)}><ExternalLink size={13} />打开官网</button>
                      <button type="button" className="secondary-setting" onClick={() => void window.codex.openExternal(engine.repo).catch(() => undefined)}>项目主页</button>
                      <button type="button" className="voice-ext-detail-btn" onClick={() => setDetails((current) => (current === engine.id ? null : engine.id))}>
                        {details === engine.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}详情
                      </button>
                    </>
                  ) : (
                    <button type="button" className="primary-setting voice-ext-config-open" onClick={() => setConfigId(engine.id)}>
                      配置{engine.installed ? "" : " · 安装"}
                    </button>
                  )}
                </div>
              </div>

              {isExternalOnly && details === engine.id && (
                <div className="voice-ext-details">
                  <div className="voice-ext-detail-row"><span>许可</span><b>{engine.license}</b></div>
                  <div className="voice-ext-detail-row"><span>硬件要求</span><b>{engine.hardware || engine.vram}</b></div>
                  <div className="voice-ext-detail-row"><span>类型</span><b>{engine.kind === "engine" ? "可接入引擎" : engine.kind === "studio" ? "独立工作台" : "模型聚合 UI"}</b></div>
                  {unsupported && (
                    <div className="voice-ext-detail-row"><span>当前平台</span><b>暂不支持（安装器与推理后端只适配 Windows）；macOS 用基础模型 / MOSS</b></div>
                  )}
                  <ul>
                    {engine.pros.map((item) => <li key={item}><Check size={12} />{item}</li>)}
                    {engine.cons.map((item) => <li key={item}><TriangleAlert size={12} />{item}</li>)}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {category === "all" && hiddenCount > 0 && (
        <button type="button" className="voice-ext-expand" onClick={() => setExpanded(true)}>
          <ChevronDown size={14} />更多展开（还有 {hiddenCount} 个）
        </button>
      )}
      {category === "all" && expanded && (
        <button type="button" className="voice-ext-expand" onClick={() => setExpanded(false)}>
          <ChevronUp size={14} />收起
        </button>
      )}
      {category !== "all" && (
        <div className="voice-ext-category-hint">当前分类：{CATEGORY_NAME[category] ?? category}（共 {filtered.length} 个）</div>
      )}

      {configEngine && (
        <SettingsDialog
          title={`${configEngine.name} · 配置`}
          hint={configEngine.installed ? `${statusOf(configEngine)} · 按需下载、只监听 127.0.0.1` : "按需下载 · 只监听 127.0.0.1"}
          size="md-auto"
          elevated
          onClose={() => setConfigId(null)}
        >
          <div className="settings-section stack voice-ext-config">
            {configBusy && (
              <div className="voice-engine-progress">
                <div className="voice-engine-progress-bar">
                  <span style={{ width: `${Math.max(0, Math.min(99, configBusy.percent))}%` }} />
                </div>
                <div className="voice-engine-progress-line">
                  <small>{configBusy.message || (configRemoving ? "正在卸载…" : "安装中…")}</small>
                  <b>{configBusy.percent >= 0 ? `${Math.round(configBusy.percent)}%` : "…"}</b>
                  {/* 卸载不可取消（删到一半停手只会留下半残目录）；安装才给取消 */}
                  {!configRemoving && configEngine && (
                    <button type="button" className="voice-engine-cancel" onClick={() => cancelInstall(configEngine)}><X size={12} />取消</button>
                  )}
                </div>
              </div>
            )}

            {/* 11-17 用户令「配置界面也一样」：弹窗内部也按卡片分区（状态 / 音色 / 怎么用 / 来源），
                每块标题 + 单行对齐，不再混用 runtime-row / 散按钮。 */}
            <div className="voice-card">
              <div className="voice-card-head">
                <span>启用与安装</span>
                <span className="voice-card-value">{statusOf(configEngine)}</span>
              </div>
              <div className="voice-card-body">
                {configEngine.installed ? (
                  <>
                    <div className="voice-row">
                      <span className="voice-ext-config-copy">
                        <b>启用 {configEngine.name}</b>
                        <small>
                          {configEngine.enabled
                            ? (configEngine.service === "running" ? "使用中：播报 / 通话由它接管" : configEngine.service === "starting" ? "模型加载中（可随时关闭）…" : "已启用")
                            : "启用后接管本机播报与通话（同一时间只一个）"}
                        </small>
                      </span>
                      <ToggleSwitch checked={configEngine.enabled} disabled={toggling === configEngine.id} label={`启用 ${configEngine.name}`} onChange={(next) => void toggle(configEngine, next)} />
                    </div>
                    <div className="voice-ext-config-actions">
                      <button type="button" className="secondary-setting" onClick={() => void window.codex.voiceExternalReveal(configEngine.id).catch(() => undefined)}><FolderOpen size={13} />打开目录</button>
                      <button type="button" className="secondary-setting" onClick={() => open(configEngine)}><ExternalLink size={13} />打开官网</button>
                      <button type="button" className="secondary-setting" onClick={() => void window.codex.openExternal(configEngine.repo).catch(() => undefined)}>项目主页</button>
                      <button type="button" className="secondary-setting danger" disabled={Boolean(removing[configEngine.id])} onClick={() => void remove(configEngine)}>
                        <Trash2 size={13} />{removing[configEngine.id] ? "卸载中…" : confirmRemove === configEngine.id ? "确认卸载" : "卸载"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="voice-ext-install-row">
                    <span className="voice-ext-config-copy">
                      <b>还没安装</b>
                      <small>{configEngine.sizeLabel} · 装完只监听 127.0.0.1</small>
                    </span>
                    <button type="button" className="primary-setting" disabled={Boolean(progress[configEngine.id])} onClick={() => void install(configEngine)}>
                      {progress[configEngine.id] ? <><LoaderCircle size={13} className="spin" />安装中…</> : <><Download size={13} />安装</>}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {configEngine.installed && (
              <div className="voice-card" data-engine-voices={configEngine.id}>
                <div className="voice-card-head">
                  <span>音色</span>
                  <span className="voice-card-value">{voiceGroupsFor(configEngine).flatMap((group) => group.items).find((item) => item.value === voiceFor(configEngine))?.label ?? "未选"}</span>
                </div>
                <div className="voice-card-body">
                  {voicesLoading && <div className="voice-card-hint"><LoaderCircle size={12} className="spin" /> 正在准备默认音色…</div>}
                  {voiceGroupsFor(configEngine).map((group) => (
                    <div key={group.title} className="voice-ext-voice-group">
                      <div className="voice-subhead">
                        <strong>{group.title}</strong>
                        <span className="voice-group-sub">{group.hint}</span>
                      </div>
                      <div className="voice-profile-list">
                        {group.items.map((item) => {
                          const rowKey = `${configEngine.id}:${item.value}`;
                          const thisPreview = voicePreview?.key === rowKey ? voicePreview.phase : null;
                          return (
                            <div key={item.value} className="voice-profile-item">
                              <label className="voice-profile-pick">
                                <input
                                  type="radio"
                                  name={`voice-${configEngine.id}`}
                                  checked={voiceFor(configEngine) === item.value}
                                  onChange={() => chooseVoice(configEngine, item.value)}
                                />
                                <span>{item.label}</span>
                                <em>{item.tag}</em>
                              </label>
                              <button
                                type="button"
                                className="secondary-setting"
                                onClick={() => void previewEngineVoice(configEngine, item.value)}
                                disabled={Boolean(voicePreview) && thisPreview === null}
                                title={`用 ${configEngine.name} 合成这个音色试听`}
                              >
                                {thisPreview === "synth"
                                  ? <><LoaderCircle size={12} className="spin" />合成中…</>
                                  : thisPreview === "playing"
                                    ? <><Square size={12} />停止</>
                                    : <><Play size={12} />试听</>}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {!voicesLoading && voiceGroupsFor(configEngine).length === 0 && (
                    <div className="voice-card-hint">
                      默认音色还没准备好：先安装基础语音模型（约 270MB）生成模型音色，或到「我的音色」导入一段参考音频。
                    </div>
                  )}
                  <div className="voice-card-hint">
                    每行「试听」都是用<strong>当前这个引擎</strong>现场合成 —— 同一段参考音色在不同引擎里音色与自然度会不同，可以直接对比。
                    首次试听要先加载模型（10–60 秒），引擎卡上会显示「模型加载中」。
                  </div>
                  <div className="voice-card-hint">
                    音色按引擎独立保存：切换引擎不会改动这里的选择，每个语音模型各用各的配置。
                    {configEngine.nativeVoice ? " 这个引擎也自带默认音色（无需参考音频）。" : ""}
                  </div>
                </div>
              </div>
            )}

            {(configEngine.usage ?? []).length > 0 && (
              <div className="voice-card voice-ext-usage">
                <div className="voice-card-head"><span>怎么用</span></div>
                <div className="voice-card-body">
                  <ol className="voice-ext-steps">
                    {(configEngine.usage ?? []).map((step) => <li key={step}>{step}</li>)}
                  </ol>
                </div>
              </div>
            )}

            <div className="voice-card">
              <div className="voice-card-head"><span>来源与许可</span></div>
              <div className="voice-card-body">
                <dl className="voice-ext-kv">
                  <dt>许可</dt><dd>{configEngine.license}</dd>
                  <dt>硬件要求</dt><dd>{configEngine.hardware || configEngine.vram}</dd>
                  <dt>类型</dt><dd>{configEngine.kind === "engine" ? "可接入引擎" : configEngine.kind === "studio" ? "独立工作台" : "模型聚合 UI"}</dd>
                </dl>
                <div className="voice-ext-proscons">
                  <div>
                    <b><Check size={12} />优点</b>
                    <ul>{configEngine.pros.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                  <div>
                    <b><TriangleAlert size={12} />注意</b>
                    <ul>{configEngine.cons.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </SettingsDialog>
      )}
    </div>
  );
}
