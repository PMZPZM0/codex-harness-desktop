import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, Eye, RefreshCw, Play, Save, X, CircleCheck, CircleOff, ChevronRight } from "lucide-react";
import { ModelIdInput } from "./ModelIdInput";
import { imageSpecHint, matchImageSpec } from "../lib/image-model-specs";

type PluginKind = "image" | "vision";
type PluginConfig = { enabled?: boolean; baseUrl: string; apiKey: string; model: string };
type BuiltinCfg = { image?: PluginConfig; vision?: PluginConfig };

const emptyConfig = (): PluginConfig => ({ enabled: true, baseUrl: "", apiKey: "", model: "" });
const meta = (kind: PluginKind) => kind === "image"
  ? { title: "生图插件", desc: "配置图像生成 API，Codex 需要配图时调用", Icon: ImagePlus }
  : { title: "视觉辅助插件", desc: "主模型不支持图片时，用多模态模型识图", Icon: Eye };

export function BuiltinPluginsSection({ onNotice }: { onNotice: (m: string) => void }) {
  const [cfg, setCfg] = useState<BuiltinCfg>({});
  const [savedCfg, setSavedCfg] = useState<BuiltinCfg>({});
  const [active, setActive] = useState<PluginKind | null>(null);
  const [imageModels, setImageModels] = useState<string[]>([]);
  const [visionModels, setVisionModels] = useState<string[]>([]);
  const [probing, setProbing] = useState<PluginKind | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.codex.readBuiltinPlugins().then((value) => {
      const loaded = value as BuiltinCfg;
      setCfg(loaded);
      setSavedCfg(loaded);
    }).catch(() => undefined);
  }, []);

  const current = (kind: PluginKind) => cfg[kind] ?? emptyConfig();
  const setKind = (kind: PluginKind, patch: Partial<PluginConfig>) => {
    setCfg((prev) => ({ ...prev, [kind]: { ...emptyConfig(), ...prev[kind], ...patch } }));
  };
  const configured = (kind: PluginKind) => {
    const value = savedCfg[kind];
    return Boolean(value?.baseUrl?.trim() && value?.apiKey?.trim() && value?.model?.trim());
  };
  const closeEditor = () => {
    if (active) setCfg((prev) => ({ ...prev, [active]: savedCfg[active] ? { ...savedCfg[active]! } : emptyConfig() }));
    setActive(null);
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeEditor();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, savedCfg]);

  const probe = async (kind: PluginKind) => {
    const value = current(kind);
    if (!value.baseUrl.trim() || !value.apiKey.trim()) { onNotice("请先填写地址和密钥"); return; }
    setProbing(kind);
    try {
      const result = await window.codex.probeBuiltinModels({ kind, baseUrl: value.baseUrl, apiKey: value.apiKey });
      const models = result?.models ?? [];
      if (kind === "image") setImageModels(models); else setVisionModels(models);
      onNotice(`探测到 ${models.length} 个模型`);
    } catch (error: any) { onNotice(`探测失败：${error.message}`); }
    finally { setProbing(null); }
  };

  const save = async (closeAfter = false) => {
    setBusy(true);
    try {
      await window.codex.saveBuiltinPlugins(cfg);
      setSavedCfg(cfg);
      onNotice("内置插件配置已保存");
      if (closeAfter) setActive(null);
    } catch (error: any) { onNotice(`保存失败：${error.message}`); }
    finally { setBusy(false); }
  };

  /** 能力卡（09-18 排版重做）：整张卡是按钮，图标 + 名称/一句话 + 右侧状态徽标 + 箭头。
   *  ⛔ 旧版把「按钮」和「状态」挤在同一个 chip 里（`生图插件 | 已停用`），既像按钮又像徽标；
   *  且与左侧 4 行长文案在同一 flex 行里垂直居中 → 段落末行飘到按钮下面（用户截图反馈）。 */
  const pluginCard = (kind: PluginKind) => {
    const { title, desc, Icon } = meta(kind);
    const saved = savedCfg[kind];
    const ready = configured(kind);
    // 三态可视化（09-17 用户反馈「启用跟禁用一个状态，没有颜色区分」）：
    // 绿 = 已配置且启用；琥珀 = 已配置但被停用（enabled === false）；中性 = 未配置。
    // 状态取 savedCfg（保存后的权威值），编辑中的改动保存后才反映到卡上。
    const off = ready && saved?.enabled === false;
    const stateClass = !ready ? "" : off ? " off" : " configured";
    const stateText = !ready ? "未配置" : off ? "已停用" : "已启用";
    return <button type="button" className={`builtin-plugin-card${stateClass}`} onClick={() => setActive(kind)}>
      <span className="builtin-plugin-icon"><Icon size={16} /></span>
      <span className="builtin-plugin-title"><strong>{title}</strong><small>{desc}</small></span>
      <em className="builtin-plugin-state">{ready ? (off ? <CircleOff size={12} /> : <CircleCheck size={12} />) : null}{stateText}</em>
      <ChevronRight size={14} className="builtin-plugin-chevron" />
    </button>;
  };

  const editor = active ? (() => {
    const value = current(active);
    const { title, desc, Icon } = meta(active);
    const models = active === "image" ? imageModels : visionModels;
    // 生图模型的内置参数（尺寸 / 改图 / 质量档）：命中内置表就在字段下方摊开，
    // 免得用户选了模型却不知道它能出多大、能不能带参考图（09-18 用户要求的「内置参数」）。
    const specHint = active === "image" ? imageSpecHint(matchImageSpec(value.model)) : [];
    return createPortal(
      <div className="modal-backdrop builtin-plugin-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) closeEditor(); }}>
        <section className="connector-setup-modal builtin-plugin-modal" role="dialog" aria-modal="true" aria-label={`${title}配置`}>
          <header><div className="connector-setup-title"><span><Icon size={17} /></span><div><strong>{title}</strong><p>{desc}</p></div></div><button className="icon-button" title="关闭（Esc）" onClick={closeEditor}><X size={16} /></button></header>
          <div className="builtin-plugin-editor">
            <div className="builtin-plugin-enable-row"><div><strong>启用插件</strong><small>停用后 Codex 不会调用该能力</small></div><label className="auto-switch"><input type="checkbox" checked={value.enabled !== false} onChange={(event) => setKind(active, { enabled: event.target.checked })} /><i /></label></div>
            <label className="se-field"><span>API 地址</span><input autoFocus value={value.baseUrl} onChange={(event) => setKind(active, { baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label>
            <label className="se-field"><span>API 密钥</span><input type="password" value={value.apiKey} onChange={(event) => setKind(active, { apiKey: event.target.value })} placeholder="sk-..." /></label>
            <label className="se-field"><span>模型</span><div className="builtin-model-row"><ModelIdInput value={value.model} onChange={(next) => setKind(active, { model: next })} extraIds={models} placeholder="选择或输入模型 ID" ariaLabel={`${title}模型`} variant={active === "image" ? "image" : "chat"} /><button className="secondary-setting" onClick={() => void probe(active)}>{probing === active ? <RefreshCw size={13} className="spin" /> : <Play size={13} />}检测</button></div></label>
            {specHint.length > 0 && <div className="builtin-model-hint">{specHint.map((line) => <span key={line}>{line}</span>)}</div>}
          </div>
          <footer><button className="secondary-setting" disabled={busy} onClick={closeEditor}>取消</button><button className="primary-setting" disabled={busy || !value.baseUrl.trim() || !value.apiKey.trim() || !value.model.trim()} onClick={() => void save(true)}>{busy ? <RefreshCw size={14} className="spin" /> : <Save size={14} />}保存配置</button></footer>
        </section>
      </div>, document.body,
    );
  })() : null;

  return <section className="settings-section stack builtin-plugins">
    <div className="builtin-plugins-head">
      <div className="settings-copy">
        <h2>内置插件</h2>
        <p>生图 / 识图能力；保存后引擎自动重载，所有会话（含已打开的）都能调用。</p>
      </div>
      <button className="primary-setting" disabled={busy} onClick={() => void save()}>{busy ? <RefreshCw size={14} className="spin" /> : <Save size={14} />}保存配置</button>
    </div>
    <div className="builtin-plugin-grid">{pluginCard("image")}{pluginCard("vision")}</div>
    {editor}
  </section>;
}
