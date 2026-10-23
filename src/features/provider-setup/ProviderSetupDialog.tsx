/**
 * 供应商自动配置大弹窗（10-24，用户令「全程自动化 + 一个流程自动化显示进度对应」）。
 *
 * 一条流程：账号/凭据 → 自动检测模型 → 勾选（默认全选，可一键全选/全不选）→
 * 保存并启用（旧供应商自动停用）→ 重启应用。每一步都有明确状态，失败停在原地可重试。
 *
 * ⛔ 本组件自包含（只走 window.codex），登录页 / 模型设置页 / 云账号页共用同一份；
 *   落盘与互斥全在主进程（custom-model:save / cloud-models:*），⛔ 这里不写第二套档案逻辑。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, CircleAlert, CircleGauge, Cloud, KeyRound, ListChecks, RefreshCw, Search, ShieldCheck, Sparkles, Wallet, X } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import {
  applySetupSelection,
  detectSetupModels,
  pickDefaultModel,
  type DetectedSetup,
  type SetupModel,
  type SetupSaveResult,
  type SetupSource,
} from "../../lib/provider-setup";

export type ProviderSetupIntent = {
  provider: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  source: SetupSource;
  /** 来源显示名（覆盖 default，如 PPtoken / 公司网关）；缺省用 source 的通用名。 */
  sourceLabel?: string;
  /** 允许在弹窗里改地址/密钥（自定义供应商；登录页也允许，检测失败时就地改）。 */
  editable?: boolean;
  /** 打开即自动检测（登录页 true；设置页手动入口 false）。 */
  autoStart?: boolean;
  /** 账号/来源的补充说明（登录页传用户名或邮箱）。 */
  account?: string;
  /** 中转站登录解析出的激活记录：保存成功后由登录页补写（取消则不写）。 */
  relayActive?: any;
};

export type ProviderSetupCompleted = {
  result: SetupSaveResult;
  intent: ProviderSetupIntent;
};

type Phase = "credentials" | "detecting" | "error" | "selecting" | "saving" | "saved";

const SOURCE_META: Record<SetupSource, { label: string; icon: ReactNode; detectHint: string }> = {
  cloud: { label: "云账号", icon: <Cloud size={14} />, detectHint: "正在读取云账号的模型目录…" },
  relay: { label: "中转站账户", icon: <Wallet size={14} />, detectHint: "正在从网关拉取模型列表…" },
  openai: { label: "OpenAI 官方订阅", icon: <CircleGauge size={14} />, detectHint: "正在读取官方订阅模型目录…" },
  custom: { label: "自定义 API", icon: <KeyRound size={14} />, detectHint: "正在连接网关并拉取模型列表…" },
};

const RELAUNCH_SECONDS = 6;

function fmtCtx(n: number | undefined): string {
  if (!n) return "";
  return n >= 1_000_000 ? `${Math.round(n / 1_000_000 * 10) / 10}M` : `${Math.round(n / 1000)}K`;
}

export function ProviderSetupDialog({
  intent,
  onClose,
  onCompleted,
}: {
  intent: ProviderSetupIntent;
  onClose: () => void;
  onCompleted: (completed: ProviderSetupCompleted, options: { restart: boolean }) => void | Promise<void>;
}) {
  const editable = intent.editable === true;
  const meta = SOURCE_META[intent.source] ?? SOURCE_META.custom;
  const [draft, setDraft] = useState({ name: intent.name, baseUrl: intent.baseUrl, apiKey: intent.apiKey });
  const [phase, setPhase] = useState<Phase>(intent.autoStart === false && editable ? "credentials" : "detecting");
  const [detected, setDetected] = useState<DetectedSetup | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SetupSaveResult | null>(null);
  const [countdown, setCountdown] = useState(RELAUNCH_SECONDS);
  const autoStartedRef = useRef(false);
  /* 自定义供应商：地址与密钥都填好后，离开密钥输入框就自动检测（用户令「配好地址密钥后自动检测」）。 */
  const lastAutoDetectRef = useRef("");
  const detectingRef = useRef(false);
  const resultRef = useRef<SetupSaveResult | null>(null);
  const finishedRef = useRef(false);
  const intentRef = useRef(intent);
  intentRef.current = intent;

  const draftRef = useRef(draft);
  draftRef.current = draft;

  const runDetect = useCallback(async (override?: { baseUrl?: string; apiKey?: string; name?: string }) => {
    if (detectingRef.current) return;
    detectingRef.current = true;
    setError("");
    setPhase("detecting");
    const current = { ...draftRef.current, ...override };
    try {
      const found = await detectSetupModels({
        provider: intentRef.current.provider,
        baseUrl: current.baseUrl.trim(),
        apiKey: current.apiKey.trim(),
        source: intentRef.current.source,
      });
      setDetected(found);
      setSelected(found.selected);
      setPhase("selecting");
    } catch (e: any) {
      setError(String(e?.message ?? e) || "检测失败");
      setPhase("error");
    } finally {
      detectingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (intent.autoStart === false) return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    void runDetect();
  }, [intent.autoStart, runDetect]);

  const finish = useCallback((restart: boolean) => {
    const saved = resultRef.current;
    if (!saved || finishedRef.current) return;
    finishedRef.current = true;
    void onCompleted({ result: saved, intent: intentRef.current }, { restart });
  }, [onCompleted]);

  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    if (phase !== "saved") return;
    setCountdown(RELAUNCH_SECONDS);
    const timer = window.setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          finishRef.current(true);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (saving) return;
      if (phase === "saved") finish(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [saving, phase, finish, onClose]);

  const models = detected?.models ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? models.filter((m) => m.id.toLowerCase().includes(q)) : models;
  }, [models, query]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected = models.length > 0 && selected.length === models.length;
  const selectedModels = models.filter((m) => selectedSet.has(m.id));

  const toggle = (id: string) => {
    setSelected((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  };
  const selectAll = () => setSelected(models.map((m) => m.id));
  const selectNone = () => setSelected([]);

  const save = async () => {
    if (!detected || !selected.length || saving) return;
    setSaving(true);
    setPhase("saving");
    setError("");
    try {
      const applied = await applySetupSelection({
        provider: intent.provider,
        name: (draft.name || intent.name).trim() || intent.name,
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey,
        source: intent.source,
        models: detected.models,
        selected,
      });
      resultRef.current = applied;
      setResult(applied);
      const finalIds = (applied.saved?.models ?? []).map((m: any) => String(m?.id ?? "")).filter(Boolean);
      if (finalIds.length && finalIds.length !== selected.length) setSelected(finalIds);
      setPhase("saved");
    } catch (e: any) {
      setError(String(e?.message ?? e) || "保存失败");
      setPhase("selecting");
    } finally {
      setSaving(false);
    }
  };

  const stepState = (step: "account" | "detect" | "select" | "save" | "restart") => {
    if (step === "account") {
      if (phase === "credentials" || phase === "detecting") return intent.autoStart === false && !detected ? "active" : "done";
      return "done";
    }
    if (step === "detect") {
      if (phase === "detecting") return "active";
      if (phase === "error") return "error";
      return detected ? "done" : "pending";
    }
    if (step === "select") {
      if (phase === "selecting" || phase === "error") return detected ? "active" : "pending";
      if (phase === "saving" || phase === "saved") return "done";
      return "pending";
    }
    if (step === "save") {
      if (phase === "saving") return "active";
      if (phase === "saved") return "done";
      if (phase === "selecting" && error) return "error";
      return "pending";
    }
    if (phase === "saved") return "active";
    return "pending";
  };

  const steps: { id: "account" | "detect" | "select" | "save" | "restart"; label: string; detail: string }[] = [
    { id: "account", label: editable ? "地址与密钥" : "账号登录", detail: editable ? (draft.name || intent.name || "待填写") : (intent.account || `${meta.label}已授权`) },
    { id: "detect", label: "自动检测模型", detail: detected ? detected.detail : (phase === "error" ? "检测失败，可重试" : "正在连接…") },
    { id: "select", label: "勾选要用的模型", detail: detected ? `已选 ${selected.length} / ${models.length} 个` : "等待模型列表" },
    { id: "save", label: "保存并启用", detail: result ? `旧供应商自动停用${result.disabled.length ? `（${result.disabled.join("、")}）` : ""}` : "启用新供应商，旧供应商自动停用" },
    { id: "restart", label: "重启应用", detail: phase === "saved" ? `${countdown} 秒后自动重启` : "保存完成后执行" },
  ];

  const closeOrFinish = () => {
    if (saving) return;
    if (phase === "saved") finish(false);
    else onClose();
  };

  return createPortal(
    <div className="modal-backdrop provider-setup-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeOrFinish(); }}>
      <div className="provider-setup-modal" role="dialog" aria-modal="true" aria-label="自动配置模型供应商" data-testid="provider-setup">
        <header className="provider-setup-head">
          <span className="provider-setup-icon"><Sparkles size={18} /></span>
          <div className="provider-setup-head-copy">
            <strong>自动配置模型</strong>
            <span>{intent.sourceLabel || meta.label}{intent.account ? ` · ${intent.account}` : ""} · 检测 → 勾选 → 保存 → 重启，全程自动</span>
          </div>
          <button className="icon-button" title={phase === "saved" ? "关闭（稍后重启）" : "关闭"} disabled={saving} onClick={closeOrFinish}><X size={16} /></button>
        </header>

        <div className="provider-setup-body">
          <aside className="provider-setup-steps">
            {steps.map((step, index) => {
              const state = stepState(step.id);
              return (
                <div className={`provider-setup-step ${state}`} key={step.id} data-step={step.id} data-state={state}>
                  <span className="provider-setup-step-dot">
                    {state === "done" ? <Check size={12} /> : state === "error" ? <CircleAlert size={12} /> : index + 1}
                  </span>
                  <div>
                    <b>{step.label}</b>
                    <small>{step.detail}</small>
                  </div>
                </div>
              );
            })}
          </aside>

          <section className="provider-setup-main">
            {(phase === "credentials" || (phase === "error" && editable)) && (
              <div className="provider-setup-credentials">
                <div className="provider-setup-section-title"><KeyRound size={15} /><b>填入 API 地址与密钥</b></div>
                <p className="provider-setup-hint">填好后自动检测并刷新模型列表；密钥只保存在本机（系统安全存储加密）。</p>
                <label className="provider-field"><span>供应商名称</span>
                  <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例如：公司网关 / 我的中转站" />
                </label>
                <label className="provider-field"><span>Base URL</span>
                  <input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
                </label>
                <label className="provider-field"><span>API Key</span>
                  <input
                    type="password"
                    value={draft.apiKey}
                    onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                    placeholder="sk-...（本地服务可留空）"
                    onKeyDown={(e) => { if (e.key === "Enter" && draft.baseUrl.trim() && !saving) void runDetect(); }}
                    onBlur={() => {
                      const pair = `${draft.baseUrl.trim()}|${draft.apiKey.trim()}`;
                      if (phase !== "credentials" || saving || !draft.baseUrl.trim() || !draft.apiKey.trim()) return;
                      if (lastAutoDetectRef.current === pair) return;
                      lastAutoDetectRef.current = pair;
                      void runDetect();
                    }}
                  />
                </label>
                {error && <div className="provider-setup-error"><CircleAlert size={15} /><span>{error}</span></div>}
                <button className="primary-setting provider-setup-detect" disabled={!draft.baseUrl.trim()} onClick={() => void runDetect()}>
                  <RefreshCw size={15} />自动检测并获取模型
                </button>
              </div>
            )}

            {phase === "detecting" && (
              <div className="provider-setup-center">
                <span className="provider-setup-orbit"><Spinner /></span>
                <b>{meta.detectHint}</b>
                <p>按当前账号自动拉取目录；检测完成后会列出全部可用模型，默认全选。</p>
                <div className="provider-setup-skeleton">{[0, 1, 2, 3].map((n) => <span key={n} />)}</div>
              </div>
            )}

            {phase === "error" && !editable && (
              <div className="provider-setup-center">
                <span className="provider-setup-danger"><CircleAlert size={22} /></span>
                <b>自动检测失败</b>
                <p>{error}</p>
                <div className="provider-setup-center-actions">
                  <button className="secondary-setting" onClick={onClose}>取消</button>
                  <button className="primary-setting" onClick={() => void runDetect()}><RefreshCw size={14} />重新检测</button>
                </div>
              </div>
            )}

            {(phase === "selecting" || phase === "saving") && (
              <>
                <div className="provider-setup-select-head">
                  <div>
                    <div className="provider-setup-section-title"><ListChecks size={15} /><b>选择要启用的模型</b></div>
                    <p className="provider-setup-hint">
                      已选 <b>{selected.length}</b> / {models.length} 个。默认全选；不用的取消勾选即可。
                      {intent.source === "cloud" ? " 云端勾选会同步到账号（其它设备也会跟随）。" : ""}
                    </p>
                  </div>
                  {models.length > 5 && (
                    <label className="provider-setup-search">
                      <Search size={14} />
                      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索模型" />
                    </label>
                  )}
                </div>
                <div className="provider-setup-toolbar">
                  <button className={`provider-setup-chip ${allSelected ? "on" : ""}`} onClick={allSelected ? selectNone : selectAll} disabled={saving}>
                    {allSelected ? <X size={13} /> : <Check size={13} />}{allSelected ? "全不选" : "一键全选"}
                  </button>
                  <span>默认模型：<b>{pickDefaultModel(selectedModels) || "—"}</b></span>
                </div>
                <div className="provider-setup-models">
                  {filtered.map((model: SetupModel) => {
                    const on = selectedSet.has(model.id);
                    const vision = (model.inputTypes ?? []).some((t) => t === "image" || t === "video");
                    return (
                      <label className={`provider-setup-model ${on ? "on" : ""}`} key={model.id} data-model={model.id}>
                        <input type="checkbox" checked={on} disabled={saving} onChange={() => toggle(model.id)} />
                        <span className="provider-setup-check"><Check size={11} /></span>
                        <span className="provider-setup-model-id">{model.id}</span>
                        <span className="provider-setup-model-tags">
                          {vision && <b className="ps-tag vision">视觉</b>}
                          {model.contextWindow ? <b className="ps-tag">{fmtCtx(model.contextWindow)}</b> : null}
                        </span>
                      </label>
                    );
                  })}
                  {!filtered.length && <div className="provider-setup-empty">没有匹配「{query}」的模型</div>}
                </div>
                {error && <div className="provider-setup-error"><CircleAlert size={15} /><span>{error}</span></div>}
                <footer className="provider-setup-foot">
                  <span className="provider-setup-foot-hint"><ShieldCheck size={14} />保存后旧供应商自动停用，勾选与密钥立即生效</span>
                  <div>
                    <button className="secondary-setting" disabled={saving} onClick={() => void runDetect()}><RefreshCw size={14} />重新检测</button>
                    <button className="secondary-setting" disabled={saving} onClick={onClose}>取消</button>
                    <button className="primary-setting" disabled={saving || !selected.length} onClick={() => void save()}>
                      {saving ? <Spinner /> : <Check size={15} />}{saving ? "正在保存并启用…" : `保存并启用（${selected.length} 个模型）`}
                    </button>
                  </div>
                </footer>
              </>
            )}

            {phase === "saved" && result && (
              <div className="provider-setup-done">
                <span className="provider-setup-done-icon"><Check size={26} /></span>
                <strong>已保存并启用</strong>
                <p className="provider-setup-done-provider">{result.saved?.name || intent.name} · {result.models.length} 个模型</p>
                <ul className="provider-setup-receipt">
                  <li className="ok"><Check size={13} />模型列表已刷新（{result.models.length} 个）</li>
                  <li className="ok"><Check size={13} />{result.previous && result.previous !== result.saved?.name ? `旧供应商已自动停用：${result.previous}` : "已确认为唯一启用的供应商"}</li>
                  {result.disabled.filter((name) => name !== result.previous).map((name) => <li className="ok" key={name}><Check size={13} />已自动停用：{name}</li>)}
                  {result.others.length ? <li className="warn"><CircleAlert size={13} />仍有其他供应商处于启用态：{result.others.join("、")}</li> : null}
                  <li className="ok"><Check size={13} />引擎已切到新配置</li>
                </ul>
                <p className="provider-setup-restart-hint">应用将在 <b>{countdown}</b> 秒后自动重启，使配置完全生效。</p>
                <div className="provider-setup-done-actions">
                  <button className="secondary-setting" onClick={() => finish(false)}>稍后重启</button>
                  <button className="primary-setting" onClick={() => finish(true)}><RefreshCw size={14} />立即重启</button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
