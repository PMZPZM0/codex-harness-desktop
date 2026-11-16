/**
 * 开源语音模型卡片（11-16 用户令）
 *
 * 用户口径：把 11 个开源项目做成「基础模型」弹窗里的卡片，按需下载；
 * **默认只展示 4 张（推荐）**，其余「更多展开 / 收起」；启用与播报/通话联动，
 * 同一时间只允许启用一个（8GB 显存）。
 *
 * ⛔ 目录与状态来自主进程 `voice:external-list`（单一真相源）；
 *   进度复用 `voice:event` 的 download/downloadDone，target = external:<id>。
 * ⛔ 非商用权重（F5 / Fish / IndexTTS-2.0）必须在卡片上显式打徽标。
 */
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Download, ExternalLink, FolderOpen, LoaderCircle, Trash2, TriangleAlert, X } from "lucide-react";
import { ToggleSwitch } from "../SettingsWidgets";
import { VOICE_EXTERNAL_CATEGORIES, VOICE_EXTERNAL_DEFAULT_IDS, isHighDemand } from "../../lib/voice-external-engines.mjs";

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

export default function VoiceExternalEnginesSection({ onNotice, onActiveChange }: {
  onNotice: (message: string) => void;
  /** 当前启用的引擎（null = 没有）；父组件据此把本机模型标成「兜底」，保证全局面只有一个「使用中」。 */
  onActiveChange?: (engine: { id: string; name: string } | null) => void;
}) {
  const [data, setData] = useState<ListPayload | null>(null);
  const [category, setCategory] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const [progress, setProgress] = useState<Record<string, { percent: number; message: string }>>({});
  const [toggling, setToggling] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");

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

  const engines = data?.engines ?? [];
  const recommended = useMemo(() => {
    const set = new Set(VOICE_EXTERNAL_DEFAULT_IDS);
    return VOICE_EXTERNAL_DEFAULT_IDS.map((id) => engines.find((engine) => engine.id === id)).filter((engine): engine is EngineCard => Boolean(engine) && set.has(engine!.id));
  }, [engines]);
  const filtered = category === "all" ? engines : engines.filter((engine) => engine.category === category);
  const visible = category === "all" && !expanded ? recommended : filtered;
  const hiddenCount = Math.max(0, filtered.length - visible.length);

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
        <span>按需下载、不随包；<strong>同一时间只生效一个</strong>（8GB 显存）。开启新引擎会自动停用当前的，并接管本机播报；参考音频用「我的音色」。</span>
      </div>
      <div className="voice-ext-hint">标「需高配」的引擎建议 12GB+ 显存；8GB 显卡优先用 F5 / Chatterbox / GPT-SoVITS / Qwen3。</div>

      <div className="voice-ext-filters" role="group" aria-label="开源语音模型分类">
        {VOICE_EXTERNAL_CATEGORIES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`voice-ext-chip${category === entry.id ? " is-active" : ""}`}
            onClick={() => { setCategory(entry.id); setDetails(null); }}
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
                  </>
                ) : !engine.installed ? (
                  <button type="button" className="primary-setting" disabled={Boolean(running) || Boolean(toggling)} onClick={() => void install(engine)}>
                    {running ? <><LoaderCircle size={13} className="spin" />安装中…</> : <><Download size={13} />安装</>}
                  </button>
                ) : (
                  <>
                    <span className="voice-ext-toggle">
                      <ToggleSwitch checked={engine.enabled} disabled={toggling === engine.id} label={`启用 ${engine.name}`} onChange={(next) => void toggle(engine, next)} />
                      <span>启用</span>
                    </span>
                    <button type="button" className="secondary-setting" onClick={() => void window.codex.voiceExternalReveal(engine.id).catch(() => undefined)}><FolderOpen size={13} />目录</button>
                    <button type="button" className="secondary-setting" onClick={() => void remove(engine)}>
                      <Trash2 size={13} />{confirmRemove === engine.id ? "确认卸载" : "卸载"}
                    </button>
                  </>
                )}
                <button type="button" className="voice-ext-detail-btn" onClick={() => setDetails((current) => (current === engine.id ? null : engine.id))}>
                  {details === engine.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}详情
                </button>
              </div>

              {details === engine.id && (
                <div className="voice-ext-details">
                  <div className="voice-ext-detail-row"><span>许可</span><b>{engine.license}</b></div>
                  <div className="voice-ext-detail-row"><span>硬件要求</span><b>{engine.hardware || engine.vram}</b></div>
                  <div className="voice-ext-detail-row"><span>类型</span><b>{engine.kind === "engine" ? "可接入引擎" : engine.kind === "studio" ? "独立工作台" : "模型聚合 UI"}</b></div>
                  <ul>
                    {engine.pros.map((item) => <li key={item}><Check size={12} />{item}</li>)}
                    {engine.cons.map((item) => <li key={item}><TriangleAlert size={12} />{item}</li>)}
                  </ul>
                  <button type="button" className="secondary-setting" onClick={() => void window.codex.openExternal(engine.repo).catch(() => undefined)}>
                    <ExternalLink size={13} />打开项目主页
                  </button>
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
    </div>
  );
}
