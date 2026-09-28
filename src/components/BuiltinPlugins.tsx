import { useEffect, useState } from "react";
import { ImagePlus, Eye, RefreshCw, Play, Save } from "lucide-react";
import { ModelIdInput } from "./ModelIdInput";
import { BuiltinPluginRow } from "./BuiltinPluginRow";
import { imageSpecHint, matchImageSpec } from "../lib/image-model-specs";
import { VideoGenBuiltInCard } from "./VideoGenBuiltInCard";

/**
 * 内置插件配置（生图 / 视觉辅助）。
 *
 * ⛔ 09-28 重做（用户原话「太丑太老，而且没有 API 地址、密钥啊、模型啊这些自定义的填写功能」）：
 *   旧版把三个字段**全藏在一个弹层里** —— 页面上只看到两张卡片，不点开根本不知道去哪填，
 *   用户据此认为「没有填写功能」。视觉上又是一套 09-18 的老排版（卡片 + 弹层 + 独立保存按钮）。
 *   现在改成**字段直接摊在页面上**：进这页就能看到地址/密钥/模型的输入框，改完按各自「保存」。
 *   ⛔ 没有删掉任何能力：启用开关、模型探测（拉取列表）、内置参数提示、保存后引擎重载全部保留。
 */
type PluginKind = "image" | "vision";
type PluginConfig = { enabled?: boolean; baseUrl: string; apiKey: string; model: string };
type BuiltinCfg = { image?: PluginConfig; vision?: PluginConfig };

const emptyConfig = (): PluginConfig => ({ enabled: true, baseUrl: "", apiKey: "", model: "" });
const meta = (kind: PluginKind) => kind === "image"
  ? { title: "生图插件", desc: "配置图像生成 API；画布「生成图」与 Codex 需要配图时都调它", Icon: ImagePlus }
  : { title: "视觉辅助插件", desc: "主模型不支持图片时，用多模态模型识图", Icon: Eye };

export function BuiltinPluginsSection({ onNotice }: { onNotice: (m: string) => void }) {
  const [cfg, setCfg] = useState<BuiltinCfg>({});
  const [savedCfg, setSavedCfg] = useState<BuiltinCfg>({});
  const [imageModels, setImageModels] = useState<string[]>([]);
  const [visionModels, setVisionModels] = useState<string[]>([]);
  const [probing, setProbing] = useState<PluginKind | null>(null);
  const [busy, setBusy] = useState<PluginKind | null>(null);
  /** 二级弹窗当前编辑哪张卡（null = 全关）。09-28：字段从卡面收进弹窗 */
  const [editing, setEditing] = useState<PluginKind | null>(null);

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
  /** 有未保存改动 ⇒ 该卡片的「保存」才可用（避免点了个没变化的按钮） */
  const dirty = (kind: PluginKind) => JSON.stringify(current(kind)) !== JSON.stringify(savedCfg[kind] ?? emptyConfig());

  const probe = async (kind: PluginKind) => {
    const value = current(kind);
    if (!value.baseUrl.trim() || !value.apiKey.trim()) { onNotice("请先填写 API 地址和密钥"); return; }
    setProbing(kind);
    try {
      const result = await window.codex.probeBuiltinModels({ kind, baseUrl: value.baseUrl, apiKey: value.apiKey });
      const models = result?.models ?? [];
      if (kind === "image") setImageModels(models); else setVisionModels(models);
      onNotice(models.length ? `探测到 ${models.length} 个模型，可在模型框里下拉选择` : "探测成功，但该地址没有返回模型列表（可直接手填模型 ID）");
    } catch (error: any) { onNotice(`探测失败：${error.message}`); }
    finally { setProbing(null); }
  };

  const save = async (kind: PluginKind) => {
    setBusy(kind);
    // ⛔ 写盘要带**两份配置**（另一份保持已保存值），否则保存生图会把视觉插件的配置清掉
    const next: BuiltinCfg = { ...savedCfg, [kind]: current(kind) };
    try {
      await window.codex.saveBuiltinPlugins(next);
      setSavedCfg(next);
      setCfg(next);
      onNotice(`${meta(kind).title}配置已保存，引擎会自动重载`);
    } catch (error: any) { onNotice(`保存失败：${error.message}`); }
    finally { setBusy(null); }
  };

  const panel = (kind: PluginKind) => {
    const { title, desc, Icon } = meta(kind);
    const value = current(kind);
    const saved = savedCfg[kind];
    const ready = configured(kind);
    const off = ready && saved?.enabled === false;
    const models = kind === "image" ? imageModels : visionModels;
    // 生图模型的内置参数（尺寸 / 改图 / 质量档）：命中内置表就在字段下方摊开，
    // 免得用户选了模型却不知道它能出多大、能不能带参考图（09-18 用户要求的「内置参数」）。
    const specHint = kind === "image" ? imageSpecHint(matchImageSpec(value.model)) : [];
    const state = ready ? (off ? "已停用" : "已启用") : "未配置";
    return (
      <>
        {/* ⛔ 09-28 三次改版（用户：「为啥这三个卡片要占这么多，不会做出二级弹窗吗」）：
            上一版把三个字段直接摊在卡面上，三张卡吃掉大半个设置页 ⇒ 现在卡面只留
            **一行摘要 + 状态 + 一个入口**，字段全部收进点开的二级弹窗。 */}
        <BuiltinPluginRow
          icon={Icon}
          title={title}
          desc={desc}
          state={state}
          tone={ready ? (off ? "off" : "ready") : "none"}
          actionLabel={ready ? "配置" : "去配置"}
          onAction={() => setEditing(kind)}
        />

        {editing === kind ? (
          <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
            <section className="connector-setup-modal vg-modal" role="dialog" aria-modal="true" aria-label={`${title}配置`}>
              <header>
                <div className="connector-setup-title">
                  <span><Icon size={17} /></span>
                  <div><strong>{title}</strong><p>{desc}</p></div>
                </div>
                <button className="icon-button" title="关闭" onClick={() => setEditing(null)}>✕</button>
              </header>
              <div className="bi-modal-body">
                <label className="vg-field">
                  <span>API 地址</span>
                  <input value={value.baseUrl} onChange={(event) => setKind(kind, { baseUrl: event.target.value })} placeholder="https://api.example.com/v1" spellCheck={false} />
                  <small>兼容 OpenAI 协议的地址（含 /v1）；中转站 / 自部署网关也填这里</small>
                </label>
                <label className="vg-field">
                  <span>API 密钥</span>
                  <input type="password" value={value.apiKey} onChange={(event) => setKind(kind, { apiKey: event.target.value })} placeholder="sk-…" spellCheck={false} />
                  <small>只存在本机用户数据目录，不会上传</small>
                </label>
                <label className="vg-field">
                  <span>模型</span>
                  <div className="bi-model-row">
                    <ModelIdInput value={value.model} onChange={(next) => setKind(kind, { model: next })} extraIds={models} placeholder="选择或输入模型 ID" ariaLabel={`${title}模型`} variant={kind === "image" ? "image" : "chat"} />
                    <button className="secondary-setting" disabled={probing === kind} onClick={() => void probe(kind)} title="用上面的地址与密钥拉取可用模型列表">
                      {probing === kind ? <RefreshCw size={13} className="spin" /> : <Play size={13} />}检测
                    </button>
                  </div>
                  {specHint.length > 0
                    ? <small className="bi-spec">{specHint.map((line) => <span key={line}>{line}</span>)}</small>
                    : <small>模型 ID 可手填；点「检测」可拉取该地址支持的模型列表</small>}
                </label>
                <div className="bi-modal-foot">
                  <label className="bi-switch" title="停用后 Codex 不会调用该能力">
                    <input type="checkbox" checked={value.enabled !== false} onChange={(event) => setKind(kind, { enabled: event.target.checked })} />
                    <i />
                    <span>启用</span>
                  </label>
                  <button className="primary-setting" disabled={busy === kind || !dirty(kind)} onClick={() => void save(kind)}>
                    {busy === kind ? <RefreshCw size={14} className="spin" /> : <Save size={14} />}{dirty(kind) ? "保存" : "已保存"}
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </>
    );
  };

  return <section className="settings-section stack builtin-plugins">
    <div className="settings-copy">
      <h2>内置插件</h2>
      <p>随应用自带、无需安装的能力：生图 / 识图 / 视频生成。填好配置后引擎自动重载，所有会话（含已打开的）都能调用。</p>
    </div>
    {/* ⛔ 09-28：三张内置卡**同一区块同构**（用户：「三个内置插件跟下面插件市场区分开」）。
        视频生成接口原先挂在插件市场页顶部的「内置接口」块里，和市场的可安装插件混在一页 ——
        现在搬过来与生图/视觉并列，三张卡共用 .bi-plugin 规格（图标+标题+状态 / 字段或摘要 / 底部动作）。
        插件市场是另一件事（外部市场的可安装列表），在它自己的区块里。 */}
    <div className="bi-plugin-grid">
      {panel("image")}
      {panel("vision")}
      <VideoGenBuiltInCard />
    </div>
  </section>;
}
