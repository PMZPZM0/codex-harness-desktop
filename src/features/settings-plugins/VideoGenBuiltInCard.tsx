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

  const refresh = useCallback(async () => {
    const list = (await window.codex.videoProviders?.().catch(() => [])) ?? [];
    setProviders(list as Array<any>);
    const cfg = (await window.codex.videoConfigRead?.().catch(() => ({}))) ?? {};
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
      {/* ⛔ 09-28：这张卡原来借用市场卡的 `.skill-card-grid`（minmax(210px,1fr) 网格）——
          它是**唯一一张自带卡**，被塞进网格后只有 210px 宽，标题折行、「0/8 已配置」被挤成
          两行、描述被 line-clamp:2 截断（用户截图点名）。现在用独立的 .vg-card：整行宽、
          标题与徽标一行放下、描述不截断、低对比度的次要信息单独一行。 */}
      <article className="vg-card">
        <div className="vg-card-main">
          <span className="vg-card-icon"><Clapperboard size={20} /></span>
          <div className="vg-card-text">
            <div className="vg-card-title">
              <b>视频生成接口</b>
              <em className="vg-tag is-builtin">内置</em>
              <em className="vg-tag">{providers.length ? `${providers.filter((p) => p.region === "cn").length} 家国内 · ${providers.filter((p) => p.region === "global").length} 家国外` : "加载中…"}</em>
            </div>
            <p className="vg-card-desc">
              文生视频 / 图生视频走内置通道：可灵、通义万相、即梦 Seedance、智谱 CogVideoX、MiniMax 海螺、Runway、Luma、Google Veo。
              画布的「生成视频」按钮直接消费这套接口 —— 提交后每 5 秒轮询，产物自动落到工作区。
            </p>
            <div className="vg-card-ready">
              {configuredCount > 0
                ? <>已配置：{providers.filter((p) => p.configured).map((p) => p.name).join("、")}</>
                : <span className="is-empty">还没有配置任何厂商 —— 点右侧按钮填 API Key 后，画布的「生成视频」才可用</span>}
            </div>
          </div>
        </div>
        <div className="vg-card-foot">
          <span className="vg-count"><b>{configuredCount}</b> / {providers.length} 已配置</span>
          <button className="skill-card-btn" onClick={() => { void refresh(); setOpen(true); setEditing(null); }}><Video size={13} />配置厂商凭证</button>
        </div>
      </article>

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
