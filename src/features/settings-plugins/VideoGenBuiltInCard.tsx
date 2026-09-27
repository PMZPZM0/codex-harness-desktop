/**
 * 内置「视频生成接口」卡 + 凭证配置弹层（09-27）。
 * 数据走 `video:*` 通道；厂商清单来自 src/lib/video-providers.mjs（纯适配层，与主进程同源）。
 * 放在插件市场页顶部：它是随应用自带的内置接口，不是市场里的可安装插件。
 */
import { useCallback, useEffect, useState } from "react";
import { Clapperboard, Video } from "lucide-react";
import { VIDEO_PROVIDERS } from "../../lib/video-providers.mjs";

export function VideoGenBuiltInCard() {
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<Array<any>>([]);
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const list = (await window.codex.videoProviders?.().catch(() => [])) ?? [];
    setProviders(list as Array<any>);
    const cfg = (await window.codex.videoConfigRead?.().catch(() => ({}))) ?? {};
    setDraft(cfg as Record<string, Record<string, string>>);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const configuredCount = providers.filter((p) => p.configured).length;

  const save = async (providerId: string) => {
    setSaving(true);
    try {
      await window.codex.videoConfigSave({ providerId, values: draft?.[providerId] ?? {} });
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="skill-card-grid">
      <article className="skill-card installed">
        <div className="skill-card-head">
          <span className="skill-card-logo"><Clapperboard size={20} /></span>
          <div className="skill-card-name"><b>视频生成接口</b><small>内置 · 国内外 8 家</small></div>
          <span className="skill-card-badge">{configuredCount}/{providers.length || VIDEO_PROVIDERS.length} 已配置</span>
        </div>
        <p className="skill-card-desc">
          文生视频 / 图生视频统一走内置通道：可灵、通义万相、即梦 Seedance、智谱 CogVideoX、MiniMax 海螺（国内）；
          Runway、Luma、Google Veo（国外）。短剧画布的「生成视频」按钮直接消费这套接口——提交后每 5 秒轮询，产物自动落到工作区。
        </p>
        <div className="skill-card-actions">
          <button className="skill-card-btn" onClick={() => { void refresh(); setOpen(true); }}><Video size={13} />配置厂商凭证</button>
        </div>
      </article>

      {open ? (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div className="shortcuts-modal" role="dialog" aria-modal="true" aria-label="视频生成接口凭证" style={{ maxHeight: "82vh", overflow: "auto" }}>
            <header>
              <div><Video size={17} /><strong>视频生成接口 · 厂商凭证</strong></div>
              <button className="icon-button relay-modal-close" title="关闭" onClick={() => setOpen(false)}>✕</button>
            </header>
            <div className="shortcuts-body" style={{ display: "grid", gap: 10 }}>
              {providers.map((provider) => (
                <div key={provider.id} className="phone-guide" style={{ borderStyle: "solid" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <b style={{ fontSize: 12.5 }}>{provider.name}</b>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {provider.region === "cn" ? "国内" : "国外"} · {provider.modes.join("/")}
                      {provider.imageInput !== "both" ? ` · 图片需${provider.imageInput === "url" ? "公网URL" : "base64"}` : ""}
                    </span>
                    {provider.configured && <span style={{ fontSize: 11, color: "var(--ok)" }}>已配置</span>}
                    <button className="secondary-setting" style={{ marginLeft: "auto", padding: "3px 10px" }} onClick={() => setEditing(editing === provider.id ? null : provider.id)}>
                      {editing === provider.id ? "收起" : "填写"}
                    </button>
                  </div>
                  {editing === provider.id ? (
                    <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                      {provider.fields.map((field: string) => (
                        <label key={field} style={{ display: "grid", gap: 2, fontSize: 11.5 }}>
                          {field}
                          <input
                            className="drama-canvas-modal-input"
                            value={draft?.[provider.id]?.[field] ?? ""}
                            onChange={(event) => setDraft((current) => ({ ...current, [provider.id]: { ...current?.[provider.id], [field]: event.target.value } }))}
                          />
                        </label>
                      ))}
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button className="secondary-setting" disabled={saving} onClick={() => void save(provider.id)}>{saving ? "保存中…" : "保存"}</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
