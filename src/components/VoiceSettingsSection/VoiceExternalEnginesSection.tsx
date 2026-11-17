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
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Download, ExternalLink, FolderOpen, LoaderCircle, Trash2, TriangleAlert, X } from "lucide-react";
import { ToggleSwitch } from "../SettingsWidgets";
import { AppSelect } from "../AppSelect";
import { SettingsDialog } from "../SettingsDialog";
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
  /** 11-17：引擎自带默认音色（Chatterbox 的 conds.pt），音色下拉多一项。 */
  nativeVoice?: boolean;
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
  const [toggling, setToggling] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  /* 不可安装的平台型卡片（Fish / Zonos 等）没有配置弹窗，详情就在卡内展开。 */
  const [details, setDetails] = useState<string | null>(null);
  /* 11-17：点卡片进二级弹窗，配置（启用/安装/音色/详情）都在弹窗里。 */
  const [configId, setConfigId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  /* 引擎音色 = 内置参考样本（本机模型说话人，首次生成约 10 秒）+ 我的音色。 */
  const [builtins, setBuiltins] = useState<{ sid: number; name: string }[]>([]);
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);

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
      .then((r) => { if (alive) setProfiles(Array.isArray(r?.profiles) ? r.profiles.map((p: { id: string; name?: string }) => ({ id: String(p.id), name: String(p.name || "我的音色") })) : []); })
      .catch(() => undefined);
    setVoicesLoading(true);
    window.codex.voiceExternalVoices()
      .then((r) => { if (alive) setBuiltins(Array.isArray(r?.voices) ? r.voices.map((v: { sid: number; name: string }) => ({ sid: Number(v.sid), name: String(v.name) })) : []); })
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

  /** 该引擎卡片里的音色下拉选项（原生默认音色 / 内置参考样本 / 我的音色）。 */
  const voiceOptionsFor = (engine: EngineCard) => [
    { value: "", label: profiles.length ? "跟随「我的音色」当前选择" : "未选音色（需要参考音频）" },
    ...(engine.nativeVoice ? [{ value: "native", label: "默认音色（引擎自带）" }] : []),
    ...builtins.map((v) => ({ value: `builtin:${v.sid}`, label: `内置音色 · ${v.name}` })),
    ...profiles.map((p) => ({ value: `profile:${p.id}`, label: `我的音色 · ${p.name}` })),
  ];

  const chooseVoice = (engine: EngineCard, value: string) => {
    if (!settings?.tts) return;
    void apply?.({ tts: { ...settings.tts, engineVoice: value } });
    const picked = voiceOptionsFor(engine).find((o) => o.value === value)?.label ?? value;
    onNotice(value ? `「${engine.name}」音色已切换到：${picked}` : "音色已改为跟随「我的音色」当前选择");
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
    try {
      const result = await window.codex.voiceExternalRemove(engine.id);
      onNotice(result?.ok ? `${engine.name} 已卸载` : `卸载失败：${result?.error ?? "未知"}`);
      setConfigId(null);
      refresh();
    } catch (error) {
      onNotice(`卸载失败：${String((error as Error)?.message ?? error)}`);
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
      <div className="voice-ext-hint">标「需高配」的引擎建议 12GB+ 显存；8GB 显卡优先用 F5 / Chatterbox / GPT-SoVITS / Qwen3。</div>

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
          const isExternalOnly = engine.kind !== "engine" || !engine.installable;
          return (
            <div key={engine.id} className={`voice-engine-card voice-ext-card${engine.enabled ? " is-active" : ""}`} data-external-card={engine.id}>
              <div className="voice-engine-head">
                <div className="voice-engine-title">
                  <span className="voice-engine-name-row">
                    <strong>{engine.name}</strong>
                    <span className={`voice-ext-badge is-${engine.commercial}`}>{engine.badge ?? engine.commercialLabel}</span>
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
                <span className={`voice-engine-state${engine.installed ? " ok" : ""}`}>{statusOf(engine)}</span>
              </div>

              <div className="voice-engine-role">{engine.licenseNote}</div>

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

              {isExternalOnly && details === engine.id && (
                <div className="voice-ext-details">
                  <div className="voice-ext-detail-row"><span>许可</span><b>{engine.license}</b></div>
                  <div className="voice-ext-detail-row"><span>硬件要求</span><b>{engine.hardware || engine.vram}</b></div>
                  <div className="voice-ext-detail-row"><span>类型</span><b>{engine.kind === "engine" ? "可接入引擎" : engine.kind === "studio" ? "独立工作台" : "模型聚合 UI"}</b></div>
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
          hint={`${statusOf(configEngine)}${configEngine.installed ? " · 按需下载、只监听 127.0.0.1" : " · 未安装"}`}
          size="md-auto"
          elevated
          onClose={() => setConfigId(null)}
        >
          <div className="settings-section stack voice-ext-config">
            {progress[configEngine.id] && (
              <div className="voice-engine-progress">
                <div className="voice-engine-progress-bar">
                  <span style={{ width: `${Math.max(0, Math.min(99, progress[configEngine.id].percent))}%` }} />
                </div>
                <div className="voice-engine-progress-line">
                  <small>{progress[configEngine.id].message || "安装中…"}</small>
                  <b>{progress[configEngine.id].percent >= 0 ? `${Math.round(progress[configEngine.id].percent)}%` : "…"}</b>
                  <button type="button" className="voice-engine-cancel" onClick={() => cancelInstall(configEngine)}><X size={12} />取消</button>
                </div>
              </div>
            )}

            {!configEngine.installed ? (
              <button type="button" className="primary-setting" disabled={Boolean(progress[configEngine.id])} onClick={() => void install(configEngine)}>
                {progress[configEngine.id] ? <><LoaderCircle size={13} className="spin" />安装中…</> : <><Download size={13} />安装（{configEngine.sizeLabel}）</>}
              </button>
            ) : (
              <>
                <div className="runtime-row installed">
                  <span className="runtime-icon">{configEngine.enabled ? <Check size={15} /> : <Download size={15} />}</span>
                  <span className="runtime-copy">
                    <strong>启用 {configEngine.name}</strong>
                    <small>{configEngine.enabled ? (configEngine.service === "running" ? "使用中：播报 / 通话由它接管" : configEngine.service === "starting" ? "模型加载中（可随时关闭）…" : "已启用") : "启用后接管本机播报与通话（同一时间只一个）"}</small>
                  </span>
                  <div className="runtime-actions">
                    <ToggleSwitch checked={configEngine.enabled} disabled={toggling === configEngine.id} label={`启用 ${configEngine.name}`} onChange={(next) => void toggle(configEngine, next)} />
                  </div>
                </div>

                <div className="voice-card">
                  <div className="voice-card-head"><span>音色</span></div>
                  <div className="voice-card-body">
                    <div className="voice-row">
                      <AppSelect
                        className="voice-input"
                        value={String(settings?.tts?.engineVoice ?? "")}
                        onChange={(value) => chooseVoice(configEngine, value)}
                        ariaLabel={`${configEngine.name} 音色`}
                        options={voiceOptionsFor(configEngine)}
                      />
                      {voicesLoading && <small className="voice-ext-voice-loading"><LoaderCircle size={12} className="spin" />生成内置音色…</small>}
                    </div>
                    <div className="voice-card-hint">
                      {configEngine.nativeVoice
                        ? "这个引擎自带默认音色；也可以选内置参考音色（本机模型说话人生成的参考样本）或你自己的「我的音色」。"
                        : "这个引擎是克隆型：选内置参考音色（本机模型说话人生成的参考样本）或你的「我的音色」；首次生成内置音色约 10 秒。"}
                    </div>
                  </div>
                </div>

                <div className="settings-actions voice-ext-config-actions">
                  <button type="button" className="secondary-setting" onClick={() => void window.codex.voiceExternalReveal(configEngine.id).catch(() => undefined)}><FolderOpen size={13} />打开目录</button>
                  <button type="button" className="secondary-setting" onClick={() => open(configEngine)}><ExternalLink size={13} />打开官网</button>
                  <button type="button" className="secondary-setting" onClick={() => void window.codex.openExternal(configEngine.repo).catch(() => undefined)}>项目主页</button>
                  <button type="button" className="secondary-setting danger" onClick={() => void remove(configEngine)}>
                    <Trash2 size={13} />{confirmRemove === configEngine.id ? "确认卸载" : "卸载"}
                  </button>
                </div>
              </>
            )}

            <div className="voice-ext-details">
              <div className="voice-ext-detail-row"><span>许可</span><b>{configEngine.license}</b></div>
              <div className="voice-ext-detail-row"><span>硬件要求</span><b>{configEngine.hardware || configEngine.vram}</b></div>
              <div className="voice-ext-detail-row"><span>类型</span><b>{configEngine.kind === "engine" ? "可接入引擎" : configEngine.kind === "studio" ? "独立工作台" : "模型聚合 UI"}</b></div>
              <ul>
                {configEngine.pros.map((item) => <li key={item}><Check size={12} />{item}</li>)}
                {configEngine.cons.map((item) => <li key={item}><TriangleAlert size={12} />{item}</li>)}
              </ul>
            </div>
          </div>
        </SettingsDialog>
      )}
    </div>
  );
}
