/** 技能 / 插件 / 市场（从 src/App.tsx 原样搬来，内容未改）。域公开面见 ./index.ts */
import { useState } from "react";
import { X, ArrowUpRight, Check, Plus, CircleCheck, AlertTriangle, Quote, Trash2 } from "lucide-react";
import { resolveSkillVisual } from "../../lib/skill-icon";
import type { SkillVisual } from "../../lib/skill-icon";
import { Spinner } from "../../components/CardShell";
import { MarketPreviewState } from "../../lib/market-preview-state";
import { SkillInstallState } from "../../lib/skill-install-state";
import { SkillRemoveState } from "../../lib/skill-remove-state";
import { PluginInstallState } from "../../lib/plugin-install-state";

function toCdnLogo(url: string): string {
  if (!/^https?:\/\/raw\.githubusercontent\.com\//i.test(url)) return url;
  const rest = url.replace(/^https?:\/\/raw\.githubusercontent\.com\//i, "");
  // rest = owner/repo/ref/path...
  const parts = rest.split("/");
  if (parts.length < 4) return url;
  const [owner, repo, ref, ...path] = parts;
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${path.join("/")}`;
}

export function MarketLogo({ url, label, size = 30 }: { url?: string; label: string; size?: number }) {
  const initial = (label || "?").charAt(0).toUpperCase();
  const [src, setSrc] = useState(url ?? "");
  const [failed, setFailed] = useState(false);
  const handleError = () => {
    if (url && src === url && toCdnLogo(url) !== url) { setSrc(toCdnLogo(url)); return; }
    setFailed(true);
  };
  return <span className="plugin-market-logo-box" style={{ width: size, height: size }}>
    <span className="plugin-market-logo plugin-market-logo-letter" style={{ width: size, height: size, lineHeight: `${size}px`, fontSize: Math.round(size * 0.46) }}>{initial}</span>
    {url && !failed ? <img className="plugin-market-logo plugin-market-logo-img" style={{ width: size, height: size }} src={src} alt="" loading="lazy" onError={handleError} /> : null}
  </span>;
}

export function MarketPreviewModal({ state, onClose }: { state: MarketPreviewState; onClose: () => void }) {
  return <div className="modal-backdrop market-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="market-preview" role="dialog" aria-modal="true" aria-label={state.title}>
    <div className="market-preview-head">
      <MarketLogo url={state.icon} label={state.iconChar ?? state.title} size={44} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 className="market-preview-title">{state.title}</h3>
        {state.subtitle && <p className="market-preview-sub">{state.subtitle}</p>}
      </div>
      <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>
    </div>
    <p className="market-preview-desc">{state.description}</p>
    {state.meta.length > 0 && <div className="market-preview-meta">{state.meta.map((item) => <code key={item}>{item}</code>)}</div>}
    {state.note && <p className="market-preview-desc" style={{ color: "var(--amber2, var(--muted))" }}>{state.note}</p>}
    <footer className="market-preview-foot">
      {state.note2 && <span className="market-preview-note">{state.note2}</span>}
      {state.externalUrl && <button className="secondary-setting" onClick={() => void window.codex.openExternal(state.externalUrl!)}><ArrowUpRight size={14} />{state.externalLabel ?? "查看来源"}</button>}
      {state.onInstall && <button className="primary-setting" onClick={() => { state.onInstall!(); onClose(); }}>{state.installed ? <Check size={14} /> : <Plus size={14} />}{state.installLabel}</button>}
    </footer>
  </section></div>;
}

export function SkillAvatar({ skill, size = 15 }: { skill: { name: string; description?: string; category?: string; icon?: string }; size?: number }) {
  // 市场数据带真实图标 URL（SkillHub iconUrl / 插件 logo）时优先显示图片，其余走 emoji/图标映射
  if (skill.icon?.startsWith("http")) {
    // 原地址直连（cloudcache/SkillHub CDN 直连可达），失败切 jsDelivr 镜像兜底，再失败隐藏露 emoji
    return <SkillAvatarImg name={skill.name} url={skill.icon} />;
  }
  const visual: SkillVisual = resolveSkillVisual(skill);
  return <span className={`skill-avatar ${visual.iconClass}`}>{visual.emoji || (visual.Icon ? <visual.Icon size={size} /> : null)}</span>;
}

export function SkillAvatarImg({ name, url }: { name: string; url: string }) {
  const [src, setSrc] = useState(url);
  const [failed, setFailed] = useState(false);
  const handleError = () => {
    if (src === url && toCdnLogo(url) !== url) { setSrc(toCdnLogo(url)); return; }
    setFailed(true);
  };
  if (failed) {
    const visual: SkillVisual = resolveSkillVisual({ name });
    return <span className={`skill-avatar ${visual.iconClass}`}>{visual.emoji || (visual.Icon ? <visual.Icon size={15} /> : null)}</span>;
  }
  return <span className="skill-avatar skill-avatar-img" title={name}><img src={src} alt="" loading="lazy" onError={handleError} /></span>;
}

export function SkillInstallModal({ state, onClose, onUse }: { state: SkillInstallState; onClose: () => void; onUse: () => void }) {
  const steps = ["下载技能包", "检查文件结构", "安全检查", "写入技能目录", "登记市场来源", "重启 Codex 引擎", "确认引擎发现"];
  const done = state.current >= steps.length;
  return <div className="modal-backdrop skill-install-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && (done || state.failed)) onClose(); }}><section className="skill-install-modal" role="dialog" aria-modal="true" aria-label="安装技能">
    <header><div><SkillAvatar skill={state.skill} size={17} /><div><strong>正在安装 {state.skill.name}</strong><p>{state.failed ? "安装没有完成，文件不会作为可用技能显示。" : done ? "安装流程已结束。请查看引擎发现状态。" : "请保持此窗口打开，安装会自动继续。"}</p></div></div>{(done || state.failed) && <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>}</header>
    <ol className="skill-install-steps">{steps.map((label, index) => { const step = index + 1; const status = state.failed && step === state.current ? "failed" : step < state.current || (done && step <= state.current) ? "done" : step === state.current && !done ? "doing" : "todo"; return <li className={status} key={label}><span>{status === "done" ? <Check size={13} /> : status === "doing" ? <Spinner /> : status === "failed" ? <X size={13} /> : step}</span><div><b>{label}</b><small>{status === "done" ? "已完成" : status === "doing" ? "处理中…" : status === "failed" ? state.failed : "等待中"}</small></div></li>; })}</ol>
    {done && <div className={`skill-engine-result ${state.engineRegistered ? "ok" : "pending"}`}><CircleCheck size={17} /><div><strong>{state.engineRegistered ? "Codex 已发现此技能" : "技能已安装，等待引擎下一轮扫描"}</strong><p>{state.engineCheckMessage ?? "已写入技能目录。"}</p></div></div>}
    {state.failed && <div className="skill-engine-result failed"><AlertTriangle size={17} /><div><strong>安装失败</strong><p>{state.failed}</p></div></div>}
    {(done || state.failed) && <footer><button className="secondary-setting" onClick={onClose}>关闭</button>{done && <button className="primary-setting" onClick={onUse}><Quote size={14} />在对话中使用</button>}</footer>}
  </section></div>;
}

export function SkillRemoveModal({ state, onClose }: { state: SkillRemoveState; onClose: () => void }) {
  const steps = ["校验技能目录", "删除技能文件", "清理来源登记", "重启 Codex 引擎", "确认引擎已移除"];
  // 进度口径：事件把 current 推到 steps.length 时最后一步仍是「处理中」，收到 complete/pending
  // （推一位）才判定整体完成——与安装弹窗「verify 后还有 complete」的节奏一致。
  const done = state.current > steps.length;
  return <div className="modal-backdrop skill-install-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && (done || state.failed)) onClose(); }}><section className="skill-install-modal" role="dialog" aria-modal="true" aria-label="卸载技能">
    <header><div><span className="skill-remove-badge"><Trash2 size={16} /></span><div><strong>正在卸载 {state.name}</strong><p>{state.failed ? "卸载没有完成，技能目录可能仍存在。" : done ? "卸载流程已结束。请查看引擎移除状态。" : "请保持此窗口打开，卸载会自动继续。"}</p></div></div>{(done || state.failed) && <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>}</header>
    <ol className="skill-install-steps">{steps.map((label, index) => { const step = index + 1; const status = state.failed && step === state.current ? "failed" : step < state.current || (done && step <= state.current) ? "done" : step === state.current && !done ? "doing" : "todo"; return <li className={status} key={label}><span>{status === "done" ? <Check size={13} /> : status === "doing" ? <Spinner /> : status === "failed" ? <X size={13} /> : step}</span><div><b>{label}</b><small>{status === "done" ? "已完成" : status === "doing" ? "处理中…" : status === "failed" ? state.failed : "等待中"}</small></div></li>; })}</ol>
    {done && <div className={`skill-engine-result ${state.engineRemoved ? "ok" : "pending"}`}>{state.engineRemoved ? <CircleCheck size={17} /> : <AlertTriangle size={17} />}<div><strong>{state.engineRemoved ? "已卸载：Codex 不再发现此技能" : "已删除文件，等待引擎下一轮扫描确认"}</strong><p>{state.engineCheckMessage ?? "技能目录已删除。"}</p></div></div>}
    {state.failed && <div className="skill-engine-result failed"><AlertTriangle size={17} /><div><strong>卸载失败</strong><p>{state.failed}</p></div></div>}
    {(done || state.failed) && <footer><button className="primary-setting" onClick={onClose}>完成</button></footer>}
  </section></div>;
}

export function PluginInstallModal({ state, onClose }: { state: PluginInstallState; onClose: () => void }) {
  const steps = ["解析插件仓库", "下载插件文件", "写入插件目录", "登记市场来源", "重启 Codex 引擎", "确认引擎发现"];
  const done = state.current >= steps.length;
  return <div className="modal-backdrop skill-install-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && (done || state.failed)) onClose(); }}><section className="skill-install-modal" role="dialog" aria-modal="true" aria-label="安装插件">
    <header><div><span className="plugin-market-logo plugin-market-logo-letter modal">{state.plugin.displayName.charAt(0).toUpperCase()}</span><div><strong>正在安装 {state.plugin.displayName}</strong><p>{state.failed ? "安装没有完成，插件不会生效。" : done ? "安装流程已结束。请查看引擎发现状态。" : "请保持此窗口打开，安装会自动继续。"}</p></div></div>{(done || state.failed) && <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>}</header>
    <ol className="skill-install-steps">{steps.map((label, index) => { const step = index + 1; const status = state.failed && step === state.current ? "failed" : step < state.current || (done && step <= state.current) ? "done" : step === state.current && !done ? "doing" : "todo"; return <li className={status} key={label}><span>{status === "done" ? <Check size={13} /> : status === "doing" ? <Spinner /> : status === "failed" ? <X size={13} /> : step}</span><div><b>{label}</b><small>{status === "done" ? "已完成" : status === "doing" ? "处理中…" : status === "failed" ? state.failed : "等待中"}</small></div></li>; })}</ol>
    {done && <div className={`skill-engine-result ${state.engineRegistered ? "ok" : "pending"}`}><CircleCheck size={17} /><div><strong>{state.engineRegistered ? "Codex 已发现此插件" : "插件已安装，等待引擎下一轮扫描"}</strong><p>{state.engineCheckMessage ?? "已写入本地插件目录。"}</p></div></div>}
    {state.failed && <div className="skill-engine-result failed"><AlertTriangle size={17} /><div><strong>安装失败</strong><p>{state.failed}</p></div></div>}
    {(done || state.failed) && <footer><button className="secondary-setting" onClick={onClose}>关闭</button></footer>}
  </section></div>;
}
