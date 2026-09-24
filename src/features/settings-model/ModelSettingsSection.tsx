/**
 * 设置页 · model（09-21 从 App.tsx 内联块搬出）。
 *
 * 纯搬迁：返回的 JSX 与原块逐字一致（仅去掉外层缩进）。
 * props = 该块用到的 App 状态与回调（tsc 驱动补齐，未做语义改动）。
 */
import { Check, ExternalLink, Eye, EyeOff, ListChecks, PenLine, Plus, RefreshCw, Rocket, Store, Trash2, X, Zap } from "lucide-react";
import { PageInfo } from "../../components/SettingsHead";
import { DEFAULT_MAX_CONCURRENCY, normalizeMaxConcurrency } from "../../lib/concurrency.mjs";
import { AVATAR_GRADIENTS, avatarToneOf } from "../../lib/entity-avatar";
import { Spinner } from "../../components/CardShell";
import { FieldHelp } from "../../features/auth";
import { UpstreamProtocol } from "../../hooks/useModelProviders";
import { ModelIdInput } from "../../components/ModelIdInput";
import { matchModelSpec } from "../../lib/model-specs";

export type ModelSettingsSectionProps = { autoCompactRatio: any; setAutoCompactRatio: any; setNotice: any; providersList: any; pptokenCardOff: any; editingProvider: any; setCustomDraft: any; setEditingProvider: any; uniqueModelCount: any; customModel: any; setPptokenCardOff: any; setProviderEnabled: any; currentProvider: any; probingProvider: any; probeActiveProvider: any; providerAutoOpenRef: any; customDraft: any; savingSettings: any; openAppConfirm: any; removeProvider: any; LOCAL_MODEL_PRESETS: any; showApiKey: any; setShowApiKey: any; probeProvider: any; saveCustomDraft: any; switchingModel: any; probeOneModel: any; openModelEditor: any; providerStatus: any; showToast: any; saveCustomModel: any; modelEditor: any; setModelEditor: any; targetProviderHint: any; applyModelIdInput: any; modelSuggestions: any; saveModelEditor: any };

export function ModelSettingsSection(props: ModelSettingsSectionProps) {
  const { autoCompactRatio, setAutoCompactRatio, setNotice, providersList, pptokenCardOff, editingProvider, setCustomDraft, setEditingProvider, uniqueModelCount, customModel, setPptokenCardOff, setProviderEnabled, currentProvider, probingProvider, probeActiveProvider, providerAutoOpenRef, customDraft, savingSettings, openAppConfirm, removeProvider, LOCAL_MODEL_PRESETS, showApiKey, setShowApiKey, probeProvider, saveCustomDraft, switchingModel, probeOneModel, openModelEditor, providerStatus, showToast, saveCustomModel, modelEditor, setModelEditor, targetProviderHint, applyModelIdInput, modelSuggestions, saveModelEditor } = props;
  return (
    <>
      <section className="settings-model-layout">
                    <div className="model-global-bar">
                      <div className="model-global-item">
                        <span className="model-global-label"><Zap size={13} />自动压缩比例</span>
                        <select value={autoCompactRatio} onChange={(event) => { const v = Number(event.target.value); setAutoCompactRatio(v); void window.codex.saveAppSettings({ autoCompactRatio: v }); setNotice('自动压缩比例已设为 ' + Math.round(v * 100) + '% ，达到该用量时自动压缩上下文'); }}>
                          {[0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95].map((r) => <option key={r} value={r}>{Math.round(r * 100)}%</option>)}
                        </select>
                        <small>上下文用量达到此比例时引擎自动压缩较早对话</small>
                      </div>
                    </div>
                    <div className="provider-list">
                      <div className="provider-list-head"><h2>模型供应商<PageInfo text={<>两种方式二选一：登录 ChatGPT 订阅账号，或添加第三方供应商并填入密钥。配好后再选模型——两者齐了才能发消息。</>} helpKey="model" label="模型配置" /></h2></div>
                      {(() => {
                        // PPtoken 赞助商卡常驻置顶：真实配置存在时用真实数据参与排序，否则显示未配置引导卡
                        const realPptoken = providersList.some((p: any) => p.provider === "pptoken");
                        const display = realPptoken
                          ? [...providersList].sort((a, b) => (a.provider === "pptoken" ? 0 : 1) - (b.provider === "pptoken" ? 0 : 1))
                          : [{ provider: "pptoken", name: "PPtoken", model: "", baseUrl: "https://api.pptoken.cc/v1", wireApi: "responses" as const, hasKey: false, models: [], enabled: true }, ...providersList];
                        return display.map((p) => {
                          const isPseudoPptoken = p.provider === "pptoken" && !realPptoken;
                          const pseudoOff = isPseudoPptoken && pptokenCardOff;
                          return (
                            <div
                              key={p.provider}
                              className={`provider-item ${p.provider === "pptoken" ? "sponsor" : ""} ${(p.enabled === false || pseudoOff) ? "disabled" : ""} ${p.provider === editingProvider ? "selected" : ""}`}
                              onClick={() => {
                                if (isPseudoPptoken) {
                                  // 未配置的常驻赞助商卡：进表单预填 PPtoken 端点，填密钥保存即可用；启用态与卡片开关联动
                                  setCustomDraft({ provider: "pptoken", name: "PPtoken", model: "", baseUrl: "https://api.pptoken.cc/v1", contextWindow: "128000", wireApi: "responses", apiKey: "", models: [], enabled: !pptokenCardOff, maxConcurrency: String(DEFAULT_MAX_CONCURRENCY) });
                                  setEditingProvider(null);
                                  return;
                                }
                                setEditingProvider(p.provider); setCustomDraft({ provider: p.provider, name: p.name, model: p.model, baseUrl: p.baseUrl, contextWindow: String(p.contextWindow ?? 128000), wireApi: p.wireApi ?? "responses", apiKey: "", models: p.models ?? (p.model ? [{ id: p.model }] : []), enabled: p.enabled ?? true, maxConcurrency: String(normalizeMaxConcurrency(p.maxConcurrency)) });
                              }}
                            >
                              <span
                                className="provider-item-icon"
                                style={{ background: p.provider === "pptoken" ? "linear-gradient(135deg, #e64980, #9775fa)" : AVATAR_GRADIENTS[avatarToneOf(p.name)], color: "#fff" }}
                              >
                                {p.provider === "pptoken" ? <Rocket size={13} /> : <Store size={13} />}
                              </span>
                              <div className="provider-item-main">
                                <span className="provider-name-row">
                                  <strong>{p.name}</strong>
                                  {p.provider === "pptoken" && <b className="provider-sponsor-badge">官方推荐</b>}
                                  {p.provider === "pptoken" && (
                                    <button className="provider-visit-btn" title="打开 PPtoken 官网（注册领额度）" onClick={(event) => { event.stopPropagation(); void window.codex.openExternal("https://api.pptoken.cc/register?aff=X82JSNVC3W3S"); }}>
                                      <ExternalLink size={11} />
                                    </button>
                                  )}
                                </span>
                                <small>{isPseudoPptoken ? (pseudoOff ? "已停用" : "未配置密钥") : p.hasKey === false && p.provider === "pptoken" ? "未配置密钥" : `${uniqueModelCount(p.models)} 个模型`}</small>
                              </div>
                              <label
                                className={`provider-switch ${p.enabled === false ? "off" : ""}`}
                                title={isPseudoPptoken ? (pseudoOff ? "推荐卡已停用 · 点击恢复展示" : "停用 PPtoken 推荐卡展示") : (p.enabled !== false ? "已启用 · 点击禁用" : (customModel && customModel.provider !== p.provider ? `已有供应商「${customModel.name}」生效，一次只能启用一个——先停用它再启用这个` : "已禁用 · 点击启用"))}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  // 启用/停用时**同步把右侧详情切到这个供应商**：原先开关只 stopPropagation，
                                  // 行点击被拦住 → 用户点了开关（开启某个供应商）右侧还停在上一个的界面
                                  // （用户 09-14 实测截图）。逻辑与行点击保持一致。
                                  if (isPseudoPptoken) {
                                    setCustomDraft({ provider: "pptoken", name: "PPtoken", model: "", baseUrl: "https://api.pptoken.cc/v1", contextWindow: "128000", wireApi: "responses", apiKey: "", models: [], enabled: !pptokenCardOff, maxConcurrency: String(DEFAULT_MAX_CONCURRENCY) });
                                    setEditingProvider(null);
                                  } else {
                                    setEditingProvider(p.provider);
                                    setCustomDraft({ provider: p.provider, name: p.name, model: p.model, baseUrl: p.baseUrl, contextWindow: String(p.contextWindow ?? 128000), wireApi: p.wireApi ?? "responses", apiKey: "", models: p.models ?? (p.model ? [{ id: p.model }] : []), enabled: p.enabled ?? true, maxConcurrency: String(normalizeMaxConcurrency(p.maxConcurrency)) });
                                  }
                                }}
                              >
                                <input type="checkbox" checked={isPseudoPptoken ? !pseudoOff : p.enabled !== false} disabled={!isPseudoPptoken && p.enabled === false && customModel != null && customModel.provider !== p.provider} onChange={(event) => { if (isPseudoPptoken) setPptokenCardOff(!event.target.checked); else void setProviderEnabled(p.provider, event.target.checked); }} />
                                <span className="provider-switch-ui" />
                              </label>
                              {!isPseudoPptoken && <span className={`provider-dot ${p.provider === currentProvider ? "on" : ""}`} title={p.provider === currentProvider ? "当前生效供应商" : ""} />}
                            </div>
                          );
                        });
                      })()}
                      {/* 不打开编辑器也能测当前生效供应商：切换/保存后最常用的自检动作。
                          失败会弹带排查清单的中文提示，认证类错误保留供应商原文。 */}
                      {customModel && <button className="add-provider-btn" title={`测试当前生效供应商：${customModel.name} · ${customModel.model}`} disabled={!!probingProvider} onClick={() => void probeActiveProvider()}>{probingProvider === "test" ? <Spinner /> : <RefreshCw size={13} />}测试当前供应商</button>}
                      <button className="add-provider-btn" onClick={() => { providerAutoOpenRef.current = true; setCustomDraft({ provider: "custom" + (Date.now() % 1000), name: "", model: "", baseUrl: "", contextWindow: "128000", wireApi: "responses", apiKey: "", models: [], enabled: true, maxConcurrency: String(DEFAULT_MAX_CONCURRENCY) }); setEditingProvider(null); }}><Plus size={13} />添加供应商</button>
                    </div>
                    <div className="provider-form">
                      <div className="provider-detail-head">
                        {/* 供应商名字**不在顶部**（09-17 用户要求）：挪到下方表单当普通字段，
                            顶部只留状态与操作，避开"标题栏里塞输入框"的别扭观感。 */}
                        {(() => {
                          // 未配置的 PPtoken 推荐卡：表单头部启用态与左侧卡片开关同一数据源（pptokenCardOff），双向联动
                          const pseudoPptokenForm = customDraft.provider === "pptoken" && !providersList.some((p: any) => p.provider === "pptoken");
                          const effectiveEnabled = pseudoPptokenForm ? !pptokenCardOff : customDraft.enabled !== false;
                          return (
                            <>
                              {/* 启用/停用合并成一颗状态药丸：状态与动作一眼可读 */}
                              {pseudoPptokenForm
                                ? <button className={`provider-state-btn pill ${effectiveEnabled ? "on" : "off"}`} onClick={() => setPptokenCardOff(!pptokenCardOff)}><span className="provider-state-dot" />{effectiveEnabled ? "展示中 · 点击停用" : "已停用 · 点击展示"}</button>
                                : editingProvider && <button className={`provider-state-btn pill ${effectiveEnabled ? "on" : "off"}`} disabled={savingSettings || (customDraft.enabled === false && customModel != null && customModel.provider !== editingProvider)} title={(customDraft.enabled === false && customModel && customModel.provider !== editingProvider) ? `已有供应商「${customModel.name}」生效，请先停用它再启用` : undefined} onClick={() => void setProviderEnabled(editingProvider, customDraft.enabled === false)}><span className="provider-state-dot" />{effectiveEnabled ? "启用中 · 点击停用" : "已停用 · 点击启用"}</button>}
                            </>
                          );
                        })()}
                        <span className="provider-head-spacer" />
                        {/* 「设为当前」已移除：启用即生效（全局只生效一个），不需要二次确认按钮 */}
                        {editingProvider && <button className="icon-button" title="删除供应商" onClick={async () => { if (!(await openAppConfirm("删除供应商", `供应商「${customDraft.name}」将被删除，此操作无法撤销。`, "删除"))) return; void removeProvider({ provider: customDraft.provider, name: customDraft.name, model: customDraft.model, baseUrl: customDraft.baseUrl }); }}><Trash2 size={14} /></button>}
                      </div>
                      {customDraft.provider === "pptoken" && !providersList.some((p: any) => p.provider === "pptoken") && (
                        <p className="provider-form-hint">只需下方填入 API Key 即可使用；<a href="https://api.pptoken.cc/register?aff=X82JSNVC3W3S" onClick={(event) => { event.preventDefault(); void window.codex.openExternal("https://api.pptoken.cc/register?aff=X82JSNVC3W3S"); }}>注册 PPtoken 领取体验额度 ↗</a></p>
                      )}
                      {/* 本地模型快捷预设（09-19 用户要求「做一下本地模型适配」）：
                          本地服务不必知道端口与路径，点一下把地址/名称/并发一次填好。

                          ⛔ **只在「新建供应商」时显示**（09-19 用户反馈：「应该要做新建的时候展示，
                          不能在已配置模型里面还能选，容易误点」）。判定用两个条件同时成立：
                            ① hook 的 editingProvider 为空（没在编辑已存供应商）；
                            ② 草稿的 id 不在已保存列表里（双保险：万一 editingProvider 状态滞后，
                               也不会对着一个已存在的供应商覆盖它的地址/并发）。
                          ⛔ 判定**不能**依赖「provider id 以 custom 开头」—— 点了预设后 id 会变成
                            `ollama` 之类，那样整排会在点击瞬间自己消失。

                          ⛔ **可取消**（同一条反馈：「选中一个没法取消选择」）：再点一次同一个 chip
                          即取消，只回退**确实是这个预设填进去的值**，用户手改过的字段不动。 */}
                      {(() => {
                        const editingExisting = Boolean(editingProvider)
                          || providersList.some((item: any) => item.provider === customDraft.provider);
                        // PPtoken 赞助卡是「尚未配置的推荐位」，不是新建本地供应商，不显示这排
                        if (editingExisting || customDraft.provider === "pptoken") return null;
                        return (
                          <div className="local-preset-row">
                            <span className="local-preset-label">本地模型<FieldHelp text={"一键填好本机服务的地址（Ollama / LM Studio / vLLM / llama.cpp）。\n\n本机服务一般不需要 API Key（留空即可），并发会设为 1 —— 单卡同时跑多路会让 KV cache 成倍占用，明显变慢甚至 OOM。\n\n再点一次已选中的按钮即可取消。"} /></span>
                            {LOCAL_MODEL_PRESETS.map((preset: any) => {
                              const active = customDraft.baseUrl === preset.url;
                              return (
                                <button
                                  key={preset.id}
                                  type="button"
                                  className={`local-preset-chip ${active ? "on" : ""}`}
                                  aria-pressed={active}
                                  title={active
                                    ? `${preset.name}：已选中，再点一次取消选择`
                                    : `${preset.name}（默认端口 ${preset.port}）—— 点一下填好地址，本机服务一般无需 API Key，并发按 1 更稳`}
                                  onClick={() => setCustomDraft((current: any) => {
                                    if (current.baseUrl === preset.url) {
                                      // 取消选择：见上方注释（只回退预设写的值）
                                      return {
                                        ...current,
                                        provider: new RegExp(`^${preset.id}(-\\d+)?$`).test(current.provider)
                                          ? `custom${Date.now() % 1000}` : current.provider,
                                        name: current.name.trim() === preset.name ? "" : current.name,
                                        baseUrl: "",
                                        maxConcurrency: String(DEFAULT_MAX_CONCURRENCY),
                                      };
                                    }
                                    let provider = current.provider;
                                    if (!provider || /^custom\d*$/.test(provider)) {
                                      provider = preset.id;
                                      let n = 2;
                                      while (providersList.some((item: any) => item.provider === provider)) provider = `${preset.id}-${n++}`;
                                    }
                                    return {
                                      ...current,
                                      provider,
                                      name: current.name.trim() ? current.name : preset.name,
                                      baseUrl: preset.url,
                                      // 见常量注释：本地单卡并发应串行，避免 KV 成倍占用
                                      maxConcurrency: "1",
                                      upstreamProtocol: "auto",
                                    };
                                  })}
                                >
                                  {preset.name}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()}
                      {/* 供应商名称（09-17 用户要求从顶部挪到这里）：多个供应商重名时无法区分，
                          所以新增时必填（保存按钮会校验）。 */}
                      <label className="provider-field"><span>供应商名称 <i className="provider-required">必填</i></span><input value={customDraft.name} onChange={(event) => setCustomDraft({ ...customDraft, name: event.target.value })} placeholder="例如：OpenAI 官方 / 公司网关（用于区分多个供应商）" /></label>
                      <p className="provider-id-line">供应商 ID：{customDraft.provider}</p>
                      <label className="provider-field"><span>Base URL</span><input value={customDraft.baseUrl} onChange={(event) => setCustomDraft({ ...customDraft, baseUrl: event.target.value })} placeholder="https://example.com/v1" /></label>
                      {/* ⛔ 不提供「API 格式」下拉（09-16）：引擎只会发 Responses，写 wire_api = "chat"
                          会让整份 config.toml 拒载、所有请求失败（真实引擎实证：`wire_api = "chat"` is no
                          longer supported）。协议改由**本地协议桥**自动适配（electron/responses-bridge.ts）：
                          引擎照常按 Responses 调用，桥按上游实际能力透传或转成 Chat Completions。
                          09-19 起补齐「Claude 原生」一档，并在下方给出「上游协议」手动开关 + ? 说明
                          （原来这里常驻一大段解释，已按用户要求收进 ? 号）。 */}
                      <label className="provider-field"><span>API Key</span>
                        <span className="key-input">
                          <input type={showApiKey ? "text" : "password"} value={customDraft.apiKey} onChange={(event) => setCustomDraft({ ...customDraft, apiKey: event.target.value })} placeholder={customModel?.hasKey ? "已安全保存，留空则不修改" : "可留空用于本地服务"} />
                          <button type="button" className="key-toggle" title={showApiKey ? "隐藏" : "显示"} onClick={() => setShowApiKey((v: any) => !v)}>{showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                        </span>
                      </label>
                      {/* 最大并发（09-19 用户要求：供应商配置界面可自定义，默认 3）。
                          限流是**同一个 Key 的共享配额**：同时跑的会话越多，越容易撞 429。
                          这里给用户一个直接可调的旋钮 —— 调小 = 更省配额、更稳；调大 = 更能并行。 */}
                      <label className="provider-field">
                        <span>最大并发<FieldHelp text={"同一个 API Key 的配额是共享的：同时跑的会话越多，越容易触发上游 429 限流。\n\n· 调小 = 更省配额、更稳（本地单卡模型建议 1，多路并发会让 KV cache 成倍占用、明显变慢甚至 OOM）\n· 调大 = 更能并行，但更容易撞限流\n\n出现频繁限流时，调到 2~3 通常就能明显缓解。"} /></span>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          step={1}
                          value={customDraft.maxConcurrency ?? String(DEFAULT_MAX_CONCURRENCY)}
                          onChange={(event) => setCustomDraft({ ...customDraft, maxConcurrency: event.target.value })}
                          placeholder={String(DEFAULT_MAX_CONCURRENCY)}
                        />
                      </label>
                      {/* 并发告警原本常驻在这里（>3 就显示一段警告）——09-19 按用户要求收进上面的 ? 号，
                          界面不再为「你已经知道的事」常驻占位。 */}
                      {/* 上游协议（09-19 用户要求：Claude 类通道常不认 responses，且自动判定不灵）。
                          ⛔ 与上面的「模型」不同：这是**上游网关说的协议**，本地协议桥按它决定转发方式。
                          默认「自动」够用；对话报错说"不支持/找不到"时，试试「Chat（兼容）」。
                          对应 electron/responses-bridge.ts 的 BridgeMode。 */}
                      <label className="provider-field">
                        <span>上游协议<FieldHelp text={"引擎固定按 Responses（/responses）请求；这里告诉本机协议桥「你的上游实际提供哪种接口」，由它决定转发方式。\n\n· 自动（推荐）：先按 Responses 试，网关明确表示「没这个接口」时自动改用 Chat 格式\n· Chat 兼容：直接按 Chat Completions 转换（绝大多数网关、中转站）\n· Responses（原生透传）：确认上游支持 Responses 时选它，省一次探测\n· Anthropic（Claude 原生）：走 /v1/messages，适用于 Anthropic 官方或只提供 Claude 原生协议的通道\n\n选了「自动」但对话报「不支持 / 找不到接口」却一直不切换时，手动改成对应协议即可。"} /></span>
                        <select
                          value={customDraft.upstreamProtocol ?? "auto"}
                          onChange={(event) => setCustomDraft({ ...customDraft, upstreamProtocol: event.target.value as UpstreamProtocol })}
                        >
                          <option value="auto">自动（推荐）</option>
                          <option value="chat">Chat 兼容（/v1/chat/completions）</option>
                          <option value="responses">Responses（原生透传）</option>
                          <option value="anthropic">Anthropic（Claude 原生 /v1/messages）</option>
                        </select>
                      </label>
                      {/* 「自动」的详细说明原本常驻在这里 —— 09-19 按用户要求收进上面的 ? 号。 */}
                      <div className="model-list-block">
                        <div className="model-list-head">
                          <span>模型列表</span>
                          <div className="model-list-head-actions">
                            <span className="model-list-hint">可多选生效</span>
                            <button className="icon-button" title="全选模型" disabled={!!savingSettings || !(customDraft.models ?? []).length} onClick={() => setCustomDraft((current: any) => ({ ...current, models: (current.models ?? []).map((model: any) => ({ ...model, enabled: true })) }))}><ListChecks size={13} /></button>
                            <button className="icon-button" title="取消全部生效" disabled={!!savingSettings || !(customDraft.models ?? []).length} onClick={() => setCustomDraft((current: any) => ({ ...current, models: (current.models ?? []).map((model: any) => ({ ...model, enabled: false })) }))}><X size={13} /></button>
                            <button className="icon-button" title="批量移除所有未勾选的模型（保存后生效）" disabled={!!savingSettings || !(customDraft.models ?? []).some((model: any) => model.enabled === false)} onClick={() => setCustomDraft((current: any) => ({ ...current, models: (current.models ?? []).filter((model: any) => model.enabled !== false), model: (current.models ?? []).some((model: any) => model.id === current.model && model.enabled !== false) ? current.model : ((current.models ?? []).find((model: any) => model.enabled !== false)?.id ?? "") }))}><Trash2 size={13} /></button>
                            <button className="icon-button" title="测试连接并拉取可用模型列表" disabled={!!probingProvider || !customDraft.baseUrl} onClick={() => void probeProvider("list")}>{probingProvider === "list" ? <Spinner /> : <RefreshCw size={13} />}</button>
                          </div>
                        </div>
                        {(customDraft.models ?? []).length > 0 && <div className="model-list">
                          {(() => {
                            const seen = new Set<string>();
                            const unique = (customDraft.models ?? []).filter((m: any) => {
                              if (seen.has(m.id)) return false;
                              seen.add(m.id);
                              return true;
                            });
                            return unique.map((m: any) => {
                            const live = customModel?.provider === customDraft.provider && customModel.model === m.id;
                            const enabled = m.enabled !== false;
                            return (
                              <div key={m.id} className={`model-row ${live ? "live" : ""} ${enabled ? "enabled" : "disabled"}`} title={enabled ? "已勾选，保存后生效" : "未勾选，保存后不参与模型列表"}>
                                <label className="model-check" title={enabled ? "取消生效" : "勾选后生效"} onClick={(event) => event.stopPropagation()}>
                                  <input type="checkbox" checked={enabled} disabled={!!savingSettings} onChange={(event) => setCustomDraft((current: any) => ({ ...current, models: (current.models ?? []).map((model: any) => model.id === m.id ? { ...model, enabled: event.target.checked } : model) }))} />
                                  <span className="model-check-ui" />
                                </label>
                                <em className="model-row-id">{m.id}</em>
                                {(m.inputTypes ?? []).some((t: any) => t === "image" || t === "video") && <b className="model-vision-badge" title="支持图片/视频输入（视觉模型）"><Eye size={10} />视觉</b>}
                                {m.contextWindow ? <b className="model-ctx-badge">{m.contextWindow >= 1000000 ? `${m.contextWindow / 1000000}M` : `${Math.round(m.contextWindow / 1000)}K`}</b> : null}
                                {live && <b className="model-live-badge">当前使用</b>}
                                <span className="model-row-actions">
                                  {enabled !== (customModel?.models ?? []).find((x: any) => x.id === m.id)?.enabled && (
                                    <button className="icon-button" title="保存勾选状态（立即生效）" disabled={!!savingSettings} onClick={(event) => { event.stopPropagation(); const merged = { ...customDraft, models: (customDraft.models ?? []).map((x: any) => x.id === m.id ? { ...x, enabled } : x) }; setCustomDraft(merged); void saveCustomDraft(merged); }}><Check size={13} /></button>
                                  )}
                                  <button className="icon-button" title="测试该模型连通" disabled={switchingModel === m.id || !customDraft.baseUrl} onClick={(event) => { event.stopPropagation(); void probeOneModel(customDraft.provider, m.id); }}>{switchingModel === m.id ? <Spinner /> : <Zap size={13} />}</button>
                                  <button className="icon-button" title="编辑模型" onClick={(event) => { event.stopPropagation(); openModelEditor(m); }}><PenLine size={13} /></button>
                                  <button className="icon-button" title="从列表移除（保存后生效）" onClick={(event) => { event.stopPropagation(); setCustomDraft((current: any) => { const models = (current.models ?? []).filter((model: any) => model.id !== m.id); const model = current.model === m.id ? (models.find((x: any) => x.enabled !== false)?.id ?? models[0]?.id ?? "") : current.model; return { ...current, models, model }; }); }}><Trash2 size={13} /></button>
                                </span>
                              </div>
                            );
                            });
                          })()}
                        </div>}
                        <button className="add-model-btn" onClick={() => openModelEditor()}><Plus size={13} />添加模型</button>
                        {providerStatus && <p className={`model-probe-status ${providerStatus.startsWith("连接失败") || providerStatus.includes("连接失败") ? "bad" : "ok"}`}>{providerStatus}</p>}
                      </div>
                      <div className="settings-actions"><span>{!customDraft.name.trim() ? <b className="provider-required-hint">请先填写「供应商名称」——多个供应商重名时无法区分</b> : "配置后可在聊天时选择使用。带 ⚡ 可测试模型连通。"}</span>
                        <button className="primary-setting" disabled={savingSettings || !customDraft.baseUrl || !customDraft.name.trim()} onClick={() => void (async () => {
                          // 供应商名称必填（09-17 用户要求）：空名字会让多个供应商无法区分。
                          // 按钮虽已禁用，这里再兜一层（键盘回车等路径不会绕过 disabled，但语义上要明确）。
                          if (!customDraft.name.trim()) { showToast("请填写供应商名称", "建议用服务商名或用途命名，例如「OpenAI 官方」「公司网关」"); return; }
                          // 用户要求：保存模型配置后重启整个应用（引擎 Key 全新注入，状态彻底归位）
                          if (!(await openAppConfirm("保存供应商", "保存后应用将自动重启使配置完全生效。\n是否继续？", "保存并重启应用"))) return;
                          try {
                            const saved = await saveCustomModel();
                            // ⛔ saveCustomDraft 内部吞错（只写内联 notice），失败绝不能弹「已保存」+重启——
                            // 否则校验失败（最常见：还没添加并勾选模型）也重启，用户重启后找不到新供应商（09-16 实测）。
                            if (!saved) { showToast("保存失败，应用未重启", "最常见原因：「模型列表」为空。请先添加模型并勾选至少一个生效模型，再点保存"); return; }
                            showToast("已保存", "应用即将重启以完全生效……");
                            setTimeout(() => { void window.codex.relaunchApp(); }, 800);
                          } catch (error: any) {
                            setNotice(`保存失败：${error.message}`);
                            showToast("保存失败，应用未重启", error.message);
                          }
                        })()}>{savingSettings ? <Spinner /> : <Check size={15} />}保存</button>
                      </div>
                    </div>
                    {modelEditor && <div className="modal-backdrop model-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModelEditor(null); }}>
                      <div className="model-editor-modal">
                        <header><strong>{modelEditor.mode === "edit" ? "编辑模型配置" : "添加模型"}{editingProvider || targetProviderHint ? ` · ${customDraft.name || editingProvider || targetProviderHint}` : ""}</strong><button className="icon-button" onClick={() => setModelEditor(null)}><X size={15} /></button></header>
                        <label className="provider-field"><span>模型 ID</span><ModelIdInput
                          autoFocus
                          value={modelEditor.draft.id}
                          onChange={applyModelIdInput}
                          extraIds={modelSuggestions}
                          placeholder="deepseek-v4-flash"
                        /></label>
                        <label className="provider-field"><span>上下文窗口</span><input type="number" min="1024" step="1024" value={modelEditor.draft.contextWindow} onChange={(event) => setModelEditor({ ...modelEditor, paramsDirty: true, draft: { ...modelEditor.draft, contextWindow: event.target.value } })} placeholder="1000000" /></label>
                        <label className="provider-field"><span>最大输出 Token</span><input type="number" min="1" value={modelEditor.draft.maxOutputTokens} onChange={(event) => setModelEditor({ ...modelEditor, paramsDirty: true, draft: { ...modelEditor.draft, maxOutputTokens: event.target.value } })} placeholder="384000" /></label>
                        {(() => {
                          // 极端值预警（反馈 #14：上下文调到 1M 后一直不出回答）：
                          // 这两个值会原样传给供应商——超出供应商真实限额时请求会被拒或长挂。
                          // 有内置规格表的模型按官方规格精准判断（很多模型本来就支持 1M，超 256K 不该误报）；
                          // 规格表没收录的模型才退回 256K/128K 通用提醒。
                          const ctx = Number(modelEditor.draft.contextWindow);
                          const out = Number(modelEditor.draft.maxOutputTokens);
                          const spec = matchModelSpec(String(modelEditor.draft.id ?? ""));
                          const fmtCtx = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}K`);
                          const hints: string[] = [];
                          if (Number.isFinite(ctx) && ctx > 0) {
                            const known = spec?.contextWindow;
                            if (known && ctx > known) hints.push(`该模型官方上下文上限约 ${fmtCtx(known)}：当前填写 ${fmtCtx(ctx)} 超过规格，虚标会导致长任务请求被拒或无限重试`);
                            else if (!known && ctx > 262_144) hints.push("上下文窗口超过 256K：该模型不在内置规格表中，请确认供应商真实支持该上限，虚标会导致长任务请求被拒或无限重试");
                          }
                          if (Number.isFinite(out) && out > 0) {
                            const known = spec?.maxOutputTokens;
                            if (known && out > known) hints.push(`该模型官方最大输出约 ${fmtCtx(known)}：当前填写 ${fmtCtx(out)} 超过规格，按官方文档填写`);
                            else if (!known && out > 131_072) hints.push("最大输出超过 128K：多数供应商拒绝超过自身上限的 max_output_tokens，建议按官方文档填写");
                          }
                          // ⛔ 两个数字打架时说清**谁说了算**（09-19 用户实测：`custom-model.json` 该模型写 1M、
                          //   `custom-models.json` 同一供应商顶层写 128000 —— 顶层那个只是"新建模型时的默认值"，
                          //   用户多半没动过；真正生效的是**这里**这个）。保存后顶层会自动同步成本值。
                          const providerDefault = Number(customDraft.contextWindow) || 0;
                          if (providerDefault && Number.isFinite(ctx) && ctx > 0 && ctx !== providerDefault) {
                            hints.push(`本模型的上下文 ${ctx.toLocaleString()} 才是**生效上限**；供应商表单里的 ${providerDefault.toLocaleString()} 只是新建模型时的默认值，保存后会自动同步成这里填的值`);
                          }
                          if (!hints.length) return null;
                          return <div className="provider-field-hints">{hints.map((hint) => <p key={hint}>⚠️ {hint}</p>)}</div>;
                        })()}
                        <div className="type-chip-group"><span>输入类型</span>
                          <div className="type-chips">{(["text", "image", "video"] as const).map((t) => (
                            <label key={t} className={`type-chip ${modelEditor.draft.inputTypes.includes(t) ? "on" : ""}`}>
                              <input type="checkbox" checked={modelEditor.draft.inputTypes.includes(t)} onChange={(event) => setModelEditor({ ...modelEditor, paramsDirty: true, draft: { ...modelEditor.draft, inputTypes: event.target.checked ? [...modelEditor.draft.inputTypes, t] : modelEditor.draft.inputTypes.filter((x: any) => x !== t) } })} />
                              <span>{t === "text" ? "文本" : t === "image" ? "图片" : "视频"}</span>
                            </label>
                          ))}</div>
                        </div>
                        <div className="type-chip-group"><span>输出类型</span>
                          <div className="type-chips">{(["text", "image"] as const).map((t) => (
                            <label key={t} className={`type-chip ${modelEditor.draft.outputTypes.includes(t) ? "on" : ""}`}>
                              <input type="checkbox" checked={modelEditor.draft.outputTypes.includes(t)} onChange={(event) => setModelEditor({ ...modelEditor, paramsDirty: true, draft: { ...modelEditor.draft, outputTypes: event.target.checked ? [...modelEditor.draft.outputTypes, t] : modelEditor.draft.outputTypes.filter((x: any) => x !== t) } })} />
                              <span>{t === "text" ? "文本" : "图片"}</span>
                            </label>
                          ))}</div>
                        </div>
                        {/* ⛔ 思考档位勾选区已删除（09-18 用户：「把模型配置里面思考选择删了，
                            每个独立会话选择那个就生效那个」）。档位不再由**模型条目声明**决定：
                            菜单一律全集，选了哪个就落到**当前会话**（thread-runtime 的 effort 字段，
                            切会话各自回填，互不干扰）。入口只剩输入框底栏那个思考强度滑块。 */}
                        <footer><button className="secondary-setting" onClick={() => setModelEditor(null)}>取消</button><button className="primary-setting" disabled={!modelEditor.draft.id.trim()} onClick={() => void saveModelEditor()}><Check size={14} />保存</button></footer>
                      </div>
                    </div>}
                  </section>
    </>
  );
}
