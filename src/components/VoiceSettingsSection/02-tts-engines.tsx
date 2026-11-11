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
import { Check, Download, LoaderCircle, Power, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ToggleSwitch } from "../SettingsWidgets";
import { Settings } from "../VoiceSettingsSection";
import VoiceDevToolsSection from "../VoiceDevToolsSection";

type Props = {
  apply: (patch: Partial<Settings>) => Promise<void>;
  onNotice: (m: string) => void;
  settings: Settings;
  /** 重拉音色表（换引擎后必须调：主进程按引擎给音色表） */
  reloadMeta: () => Promise<void>;
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
export function VoiceSettingsSectionTtsEngines({ apply, onNotice, reloadMeta, settings }: Props) {
  const [packs, setPacks] = useState<Partial<Record<PackId, PackState>>>({});
  const [moss, setMoss] = useState<{ configured: boolean; runnable: boolean; baseUrl: string; model: string; hasKey: boolean; keyHint: string; docs?: string } | null>(null);
  const [mossDraft, setMossDraft] = useState({ baseUrl: "", model: "", apiKey: "" });
  const [busy, setBusy] = useState<PackId | null>(null);
  const [progress, setProgress] = useState<{ pack: PackId; percent: number; message: string } | null>(null);
  /** 卡片内反馈条（下载成功/失败、切换成功）—— ⛔ 不能只靠一闪而过的 toast */
  const [flash, setFlash] = useState<{ pack: PackId; kind: "ok" | "err" | "info"; text: string } | null>(null);

  const refresh = useCallback(async (): Promise<any | null> => {
    try {
      const status: any = await window.codex.voiceModelsStatus();
      setMoss(status?.mossLive ?? null);
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
        if (event?.type === "downloadDone") void refresh();
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
  useEffect(() => {
    setMossDraft((d) => ({ ...d, baseUrl: savedMoss?.baseUrl ?? d.baseUrl, model: savedMoss?.model ?? d.model }));
  }, [savedMoss?.baseUrl, savedMoss?.model]);

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
  const setCallBackend = useCallback(async (next: boolean) => {
    if (next) {
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
  const currentReady = Boolean(packs[current]?.ready) && packs[current]?.enabled !== false;
  const currentDisabled = Boolean(packs[current]?.ready) && packs[current]?.enabled === false;
  const anyReady = Object.values(packs).some((p) => Boolean(p?.ready));

  return (
    <div className="voice-card voice-engines">
      <div className="voice-card-head">
        <Sparkles size={15} />
        <span>合成引擎</span>
        <span className="voice-card-value">
          当前：{packLabel(current)}{currentReady ? "" : currentDisabled ? " · 已停用" : " · 未安装"}
        </span>
      </div>
      <div className="voice-card-body">
        <div className="voice-card-hint">
          轻量播报（vits-zh-ll）跟着基础语音模型一起装，不额外下载；通话与播报都用它。
        </div>
        {!anyReady && (
          <div className="voice-engine-empty">
            <TriangleAlert size={13} />
            <span>
              现在<strong>合成引擎还没装</strong>，语音通话与播报都无法出声。
              轻量播报随「基础语音模型」一起装 —— 用下方「轻量播报」卡里的「下载模型 / 本地导入」。
            </span>
          </div>
        )}
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

        {/* 11-10 远程实时语音模型（MOSS-Live）：不下载模型、需 API 密钥。
            11-11 接通实时通话链路：开启后 VoiceService 走全双工 S2S，连不上自动回落本地。 */}
        <div className="voice-engine-card voice-engine-remote">
          <div className="voice-engine-head">
            <div className="voice-engine-title">
              <span className="voice-engine-name-row">
                <strong>MOSS-Live</strong>
                <span className="voice-engine-tag">远程 · 全双工实时</span>
              </span>
              <span className="voice-engine-tagline">边听边说 · 自然打断 · 不占本机磁盘</span>
            </div>
            <div className="voice-engine-head-right">
              <span className={`voice-engine-state${moss?.configured ? " ok" : ""}`}>
                {moss?.configured ? "已配置" : "未配置"}
              </span>
            </div>
          </div>
          <div className="voice-engine-role">
            远程实时对话模型，需提供方 API 密钥。保存配置并开启下方开关后，语音通话走 MOSS-Live 全双工对话。
          </div>
          <div className="voice-remote-form">
            <label>接口地址
              <input value={mossDraft.baseUrl} placeholder="wss://…/v1/realtime（实时 WebSocket 接口）"
                onChange={(e) => setMossDraft((d) => ({ ...d, baseUrl: e.target.value }))} />
            </label>
            <label>模型
              <input value={mossDraft.model} placeholder="moss-live"
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
          <div className="voice-engine-note">
            对话内容会发送到提供方服务器；离线不可用。官方接口是 WebSocket 长连接（上行 16k PCM16，下行 48k PCM16），连不上会自动回落本地语音。
          </div>
        </div>
      </div>
    </div>
  );
}

function packLabel(id: PackId): string {
  return ENGINES.find((e) => e.id === id)?.name ?? "轻量播报";
}
