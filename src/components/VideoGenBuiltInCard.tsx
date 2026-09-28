/**
 * 内置「视频生成接口」卡 + 凭证/自定义配置弹层（09-27 建，09-28 重做）。
 *
 * 数据走 `video:*` 通道；厂商清单来自 src/lib/video-providers.mjs（纯适配层，与主进程同源）。
 * 放在插件市场页顶部：它是随应用自带的内置接口，不是市场里的可安装插件。
 *
 * ⛔ 09-28 重做（用户原话「太丑太老，没有 API 地址/密钥/模型这些自定义填写功能」）：
 *   · 旧实现：大量内联 style + 复用不相关的 `phone-guide` 类拼版；字段名**直接显示英文 key**
 *     （`apiKey` / `accessKey` / `secretKey` 没有任何中文说明）；**地址与模型都不给填**
 *     （地址硬编码在各家适配层里，模型只有固定清单）。
 *   · 现在：字段有中文标签与占位说明；每组凭证独立卡片；**新增「API 地址」「模型」两个可选
 *     覆盖字段**（中转站/代理/自部署网关可用，留空走官方）；走 DESIGN.md 的字段与按钮体系，
 *     不再写内联样式。
 */
import { useCallback, useEffect, useState } from "react";
import { Clapperboard, RefreshCw, Save, Sparkles, Video } from "lucide-react";
/* ⛔⛔ 09-28：**不要** import "../../lib/video-providers.mjs" —— 那个模块顶部 import 了
   node:crypto（可灵 JWT 签名用），渲染层没有该内置模块：vite dev 下解构导入会直接抛
   「Module "node:crypto" has been externalized」，生产构建只是侥幸能跑。
   厂商清单**全部走 IPC**（window.codex.videoProviders() 已返回 name/region/fields/baseUrl/
   defaultModel 等全部字段），渲染层不碰主进程逻辑模块。 */
import { OPTIONAL_FIELDS } from "./video-optional-fields";
import { BuiltinPluginRow } from "./BuiltinPluginRow";

/** 凭证字段的中文标签与填写提示（⛔ 别再直接渲染英文 key —— 用户不知道 accessKey 是啥）。 */
const FIELD_META: Record<string, { label: string; hint: string; secret?: boolean }> = {
  apiKey: { label: "API Key", hint: "厂商控制台里的密钥，形如 sk-…", secret: true },
  accessKey: { label: "AccessKey", hint: "可灵控制台 → 密钥管理里的 AccessKey" },
  secretKey: { label: "SecretKey", hint: "与 AccessKey 成对下发，只显示一次", secret: true },
};

const OPTIONAL_META: Record<string, { label: string; hint: string }> = {
  baseUrl: { label: "API 地址（可选）", hint: "中转站 / 代理 / 自部署网关地址；留空走官方地址。只替换域名前缀，接口路径不变。" },
  model: { label: "模型（可选）", hint: "覆盖内置模型；留空用默认模型。" },
};

export function VideoGenBuiltInCard() {
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<Array<any>>([]);
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  /** 读取失败的原因（09-28：区分「还在加载」与「加载失败」—— 用户现场卡在「加载中…」
      半天，而真相是主进程那 6 个通道压根没注册；没有这一层就永远看不出区别）。 */
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await window.codex.videoProviders();
      setProviders(Array.isArray(list) ? list : []);
      setLoadError(null);
    } catch (error: any) {
      setProviders([]);
      setLoadError(String(error?.message ?? error ?? "读取厂商清单失败"));
      return;
    }
    const cfg = await window.codex.videoConfigRead?.().catch(() => ({})) ?? {};
    setDraft(cfg as Record<string, Record<string, string>>);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const configuredCount = providers.filter((p) => p.configured).length;
  const setField = (providerId: string, field: string, value: string) =>
    setDraft((current) => ({ ...current, [providerId]: { ...current?.[providerId], [field]: value } }));

  const save = async (providerId: string) => {
    setSaving(providerId);
    try {
      await window.codex.videoConfigSave({ providerId, values: draft?.[providerId] ?? {} });
      await refresh();
      setEditing(null);
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      {/* ⛔ 09-28 二次改版（用户：「三个内置插件跟下面插件市场区分开，布局做好看一点」）：
          这张卡从「插件市场页顶部的独立区块」搬进「内置插件」区块，与生图/视觉插件同构。
          · 结构对齐 .bi-plugin（头 = 图标+标题+说明+状态 / 体 = 摘要 / 底 = 计数+动作）
          · 它没有可内联的字段（8 家厂商凭证在弹层里），所以体部放「通道说明 + 已配置清单」
          · ⛔ 不再自带底部虚线分隔之外的分区标题 —— 区块标题由 BuiltinPluginsSection 统一给 */}
      {/* ⛔ 09-28 三次改版（用户：「为啥这三个卡片要占这么多，不会做出二级弹窗吗」）：
          卡面收成一行（图标 + 名称 + 一句话 + 状态 + 入口），8 家厂商凭证全在二级弹窗里。
          描述里的厂商名单保留（用户靠它判断"有没有我要的那家"），但只占一行、超出省略。 */}
      <BuiltinPluginRow
        icon={Clapperboard}
        title="视频生成接口"
        desc="文生 / 图生视频走内置通道：可灵、通义万相、即梦 Seedance、智谱 CogVideoX、MiniMax 海螺、Runway、Luma、Google Veo"
        state={loadError ? "加载失败" : providers.length === 0 ? "加载中…" : configuredCount > 0 ? `${configuredCount} / ${providers.length} 已配置` : "未配置"}
        tone={loadError ? "off" : configuredCount > 0 ? "ready" : "none"}
        actionLabel={loadError ? "重试" : configuredCount > 0 ? "配置" : "去配置"}
        onAction={() => { if (loadError) { void refresh(); return; } void refresh(); setOpen(true); setEditing(null); }}
      />

      {open ? (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="connector-setup-modal vg-modal" role="dialog" aria-modal="true" aria-label="视频生成接口配置">
            <header>
              <div className="connector-setup-title">
                <span><Video size={17} /></span>
                <div><strong>视频生成接口</strong><p>按厂商填写凭证；国内厂商需可访问对应云服务</p></div>
              </div>
              <button className="icon-button" title="关闭" onClick={() => setOpen(false)}>✕</button>
            </header>
            <div className="vg-list">
              {providers.length === 0 ? (
                <div className="vg-empty">
                  <b>{loadError ? "厂商清单读取失败" : "正在读取厂商清单…"}</b>
                  {loadError ? <small>{loadError}</small> : null}
                  {loadError ? <button className="secondary-setting" onClick={() => void refresh()}>重试</button> : null}
                </div>
              ) : null}
              {providers.map((provider) => {
                const cfg = draft?.[provider.id] ?? {};
                const isEditing = editing === provider.id;
                return (
                  <article key={provider.id} className={`vg-item ${provider.configured ? "is-ready" : ""} ${isEditing ? "is-open" : ""}`}>
                    <div className="vg-item-head">
                      <div className="vg-item-title">
                        <b>{provider.name}</b>
                        <small>
                          <em className={`vg-tag ${provider.region === "cn" ? "is-cn" : "is-global"}`}>{provider.region === "cn" ? "国内" : "国外"}</em>
                          <em className="vg-tag">{provider.modes.map((m: string) => (m === "t2v" ? "文生视频" : "图生视频")).join(" / ")}</em>
                          {provider.imageInput !== "both" && (
                            <em className="vg-tag is-warn" title={provider.imageInput === "url" ? "图生视频需要公网可访问的图片地址，本地首帧会被拒" : "图生视频需要图片字节（本地下发即可）"}>
                              图片需{provider.imageInput === "url" ? "公网 URL" : "base64"}
                            </em>
                          )}
                        </small>
                      </div>
                      {provider.configured ? <span className="vg-state is-ok">已配置</span> : <span className="vg-state">未配置</span>}
                      <button className="secondary-setting" onClick={() => setEditing(isEditing ? null : provider.id)}>{isEditing ? "收起" : provider.configured ? "修改" : "填写"}</button>
                    </div>

                    {isEditing ? (
                      <div className="vg-form">
                        {provider.fields.map((field: string) => {
                          const meta = FIELD_META[field] ?? { label: field, hint: "" };
                          return (
                            <label key={field} className="vg-field">
                              <span>{meta.label}</span>
                              <input
                                type={meta.secret ? "password" : "text"}
                                value={cfg[field] ?? ""}
                                placeholder={meta.hint}
                                onChange={(event) => setField(provider.id, field, event.target.value)}
                              />
                              {meta.hint && <small>{meta.hint}</small>}
                            </label>
                          );
                        })}
                        {/* 可选覆盖（09-28 新增）：地址与模型 —— 中转站/代理/自部署用户需要 */}
                        <details className="vg-advanced">
                          <summary><Sparkles size={12} />高级：自定义 API 地址与模型（可选）</summary>
                          {OPTIONAL_FIELDS.map((field: string) => {
                            const meta = OPTIONAL_META[field] ?? { label: field, hint: "" };
                            return (
                              <label key={field} className="vg-field">
                                <span>{meta.label}</span>
                                <input
                                  type="text"
                                  value={cfg[field] ?? ""}
                                  placeholder={field === "baseUrl" ? (provider.baseUrl || "https://…") : (provider.defaultModel || "默认模型")}
                                  onChange={(event) => setField(provider.id, field, event.target.value)}
                                />
                                <small>{meta.hint}</small>
                              </label>
                            );
                          })}
                        </details>
                        <div className="vg-form-foot">
                          <span className="vg-defaults">官方地址 <code>{provider.baseUrl}</code> · 默认模型 <code>{provider.defaultModel}</code></span>
                          <button className="primary-setting" disabled={saving === provider.id} onClick={() => void save(provider.id)}>
                            {saving === provider.id ? <RefreshCw size={14} className="spin" /> : <Save size={14} />}保存
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
