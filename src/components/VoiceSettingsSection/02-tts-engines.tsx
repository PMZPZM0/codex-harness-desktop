/**
 * VoiceSettingsSectionTtsEngines —— 合成引擎三选一（10-26 用户令：「三个模型卡片做好看一点，
 * 每个优势劣势都写清楚」「模型按需下载，原有的模型保留」）。
 *
 * ⛔ 设计约束（都是踩过的坑，别改回去了）：
 *   · **原有模型保留**：vits-zh-ll 是默认引擎，装了 Kokoro / EmotiVoice 也不会动它，
 *     三个包各自独立目录、独立下载、独立删除。
 *   · **不许用 disabled 表达"能不能用"**：EmotiVoice 目前缺推理运行时，按钮照常可点，
 *     点了给**明确说明**（10-20 教训：灰按钮点了没反应是最差体验）。
 *   · 优势/劣势必须写**实测数字**，不写"更快更好"这种空话。
 */
import { Check, Download, LoaderCircle, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Settings } from "../VoiceSettingsSection";

type Props = {
  apply: (patch: Partial<Settings>) => void;
  onNotice: (m: string) => void;
  settings: Settings;
  /** 重拉音色表（换引擎后必须调：vits 5 个音色 vs Kokoro 103 个） */
  reloadMeta: () => Promise<void>;
};

type PackId = "vits" | "kokoro" | "emotivoice";

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
    tagline: "vits-zh-ll · 现在用的这个",
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
    id: "kokoro",
    name: "自然多音色",
    tagline: "Kokoro v1.1 int8 · 中英 103 音色",
    role: "想让播报更像真人在说话时用它。",
    sizeMB: 140,
    speakerCount: "103 个音色",
    pros: [
      "103 个音色（中英），韵律自然度明显好于 VITS",
      "压缩包仅 140MB（int8），解压后 206MB",
      "和现有引擎同一套运行时（sherpa-onnx），装完即可切换",
    ],
    cons: [
      "CPU 慢约 1.8 倍（官方 RTF 4.47 vs 2.49 @2 线程）",
      "需要额外带 espeak-ng 数据（120 个文件的目录）",
      "音色多但没有情绪控制，仍是「照着念」",
    ],
  },
  {
    id: "emotivoice",
    name: "情感语气",
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

export function VoiceSettingsSectionTtsEngines({ apply, onNotice, reloadMeta, settings }: Props) {
  const [packs, setPacks] = useState<Partial<Record<PackId, PackState>>>({});
  const [busy, setBusy] = useState<PackId | null>(null);
  const [progress, setProgress] = useState<{ pack: PackId; percent: number; message: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const status: any = await window.codex.voiceModelsStatus();
      const next: Partial<Record<PackId, PackState>> = {
        vits: { ready: Boolean(status?.ready), enabled: true, bytes: 0, runnable: true },
        kokoro: status?.kokoro
          ? { ready: Boolean(status.kokoro.ready), enabled: status.kokoro.enabled !== false, bytes: status.kokoro.bytes ?? 0, runnable: status.kokoro.runnable !== false }
          : { ready: false, enabled: true, bytes: 147_031_220, runnable: true },
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
    } catch {
      /* 读不到就保持现状，卡片各自显示未安装 */
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const unsub = window.codex.onVoiceEvent((event: any) => {
      const target = event?.target;
      if (target !== "kokoro" && target !== "emotivoice") return;
      if (event?.type === "download") {
        setProgress({ pack: target, percent: Number(event.percent ?? -1), message: String(event.message ?? "下载中…") });
      } else if (event?.type === "downloadDone") {
        setProgress(null);
        setBusy(null);
        void refresh();
        if (!event.ok) onNotice(`下载失败：${event.error ?? "未知原因"}`);
        else onNotice(target === "kokoro" ? "Kokoro 模型已就绪，可切换试用" : "情感语音模型已下载");
      }
    });
    return () => { try { unsub?.(); } catch { /* 忽略 */ } };
  }, [onNotice, refresh]);

  const current: PackId = useMemo(() => {
    const id = settings?.tts?.engine;
    return id === "kokoro" || id === "emotivoice" ? id : "vits";
  }, [settings]);

  const install = useCallback(async (id: PackId) => {
    if (id === "vits") {
      onNotice("轻量播报跟着基础语音模型一起装：到下方「语音模型」里下载/导入基础模型即可");
      return;
    }
    setBusy(id);
    setProgress({ pack: id, percent: -1, message: "准备下载…" });
    try {
      const r: any = await window.codex.voiceTtsPackInstall(id);
      if (!r?.ok) {
        setBusy(null);
        setProgress(null);
        onNotice(r?.error ?? "下载失败");
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
      if (!r?.ok) onNotice(r?.error ?? "删除失败");
      else {
        onNotice("已删除，需要时可重新下载");
        if (current === id) apply({ tts: { ...settings.tts, engine: "vits" } });
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
    if (id !== "vits" && state && !state.runnable) {
      onNotice(`模型已下载，但还缺推理运行时（约 287MB），运行时接入后才能用它合成；现在仍用「${packLabel(current)}」`);
      return;
    }
    apply({ tts: { ...settings.tts, engine: id } });
    /* ⛔ 换引擎 ⇒ 音色表跟着换（主进程按引擎给）⇒ 必须重拉，否则下拉里还是旧引擎的音色。 */
    void reloadMeta();
    onNotice(`已切换到「${packLabel(id)}」（通话与播报都用它）`);
  }, [apply, current, onNotice, packs, reloadMeta, settings]);

  return (
    <div className="voice-card voice-engines">
      <div className="voice-card-head">
        <Sparkles size={15} />
        <span>合成引擎</span>
        <span className="voice-card-value">当前：{packLabel(current)}</span>
      </div>
      <div className="voice-card-body">
        <div className="voice-card-hint">
          三个引擎并存、互不干扰：下载新的不会动旧的，删掉新的旧的照样能用。切换后通话与播报都用它。
        </div>
        <div className="voice-engine-grid">
          {ENGINES.map((engine) => {
            const state = packs[engine.id];
            const ready = engine.id === "vits" ? Boolean(state?.ready) : Boolean(state?.ready);
            const active = current === engine.id;
            const downloading = busy === engine.id || progress?.pack === engine.id;
            return (
              <div key={engine.id} className={`voice-engine-card${active ? " is-active" : ""}${ready ? " is-ready" : ""}`}>
                <div className="voice-engine-head">
                  <div className="voice-engine-title">
                    <strong>{engine.name}</strong>
                    <span className="voice-engine-tagline">{engine.tagline}</span>
                  </div>
                  {active && <span className="voice-engine-flag"><Check size={12} />使用中</span>}
                </div>

                <div className="voice-engine-meta">
                  <span>{engine.speakerCount}</span>
                  <span>{engine.id === "vits" ? "随基础模型" : `${Math.round(engine.sizeMB)}MB`}</span>
                  <span className={`voice-engine-state${ready ? " ok" : ""}`}>{ready ? "已安装" : "未安装"}</span>
                </div>

                <div className="voice-engine-role">{engine.role}</div>

                <ul className="voice-engine-pros">
                  {engine.pros.map((p) => <li key={p}><Check size={12} />{p}</li>)}
                </ul>
                <ul className="voice-engine-cons">
                  {engine.cons.map((c) => <li key={c}><TriangleAlert size={12} />{c}</li>)}
                </ul>

                {downloading && (
                  <div className="voice-engine-progress">
                    <div className="voice-engine-progress-bar">
                      <span style={{ width: `${(progress?.percent ?? 0) >= 0 ? progress?.percent : 8}%` }} />
                    </div>
                    <small>{progress?.message ?? "下载中…"}</small>
                  </div>
                )}
                {engine.id === "emotivoice" && !state?.runnable && (
                  <div className="voice-engine-note">
                    模型可下载，但合成能力要等 ONNX 推理运行时接入后才可用（点了会给说明，不会静默失败）。
                    {state?.hostNote ? ` 当前：${state.hostNote}` : ""}
                  </div>
                )}

                <div className="voice-engine-actions">
                  {ready ? (
                    <>
                      <button className="secondary-setting" onClick={() => choose(engine.id)} disabled={active}>
                        {active ? "使用中" : "用它"}
                      </button>
                      {engine.id !== "vits" && (
                        <button className="secondary-setting" onClick={() => void remove(engine.id)} title="删除这个引擎的模型文件">
                          <Trash2 size={13} />删除
                        </button>
                      )}
                    </>
                  ) : (
                    <button className="secondary-setting" onClick={() => void install(engine.id)} disabled={downloading}>
                      {downloading ? <><LoaderCircle size={13} className="spin" />下载中…</> : <><Download size={13} />下载模型</>}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function packLabel(id: PackId): string {
  return ENGINES.find((e) => e.id === id)?.name ?? "轻量播报";
}
