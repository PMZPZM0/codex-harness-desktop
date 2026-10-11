/**
 * 免费模型网关 · 推荐卡 + 管理弹窗（free-gateway 域，10-12）。
 *
 * ⛔⛔ 免责声明是**契约**（用户定稿「一切与开发者无关」）：推荐卡、管理弹窗、新手引导三处
 *   都必须带「与本项目开发者无关」字样（守卫 12c 钉；改文案不许删这半句）。
 * 供应商注册**复用既有** `window.codex.saveCustomModel`（模型配置单一真相源）：
 *   本域只负责把网关跑起来、拿到 forwardKey 与模型清单，注册动作是它的一个调用方。
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, Download, ExternalLink, Play, RefreshCw, ShieldAlert, Square, Store } from "lucide-react";
import { SettingsDialog } from "../../components/SettingsDialog";
import { Spinner } from "../../components/CardShell";

/** ⛔ 免责声明（单一文案源；卡片摘要与弹窗全文都从这里拼）。 */
export const DISCLAIMER_SHORT = "第三方开源项目，与本项目开发者无关";
const DISCLAIMER_FULL = "「免费模型网关」是第三方开源项目 dsh-our-free-model（MIT），与本项目开发者无关：渠道合规性、可用性、账号与数据安全均由使用者自行承担，渠道可能随上游风控随时失效。";

type GatewayStatus = {
  downloaded: boolean; version: string; running: boolean; port: number;
  forwardKey: string; hasForwardKey: boolean; adminUrl: string;
  stage: string | null; stageError: string | null;
};

/** 供应商列表里的常驻推荐卡（与 PPtoken 推荐卡同一族的观感）。 */
export function FreeGatewayRecommendCard() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="provider-item sponsor free-gateway-entry"
        title="免费模型网关：下载并启动本地 OpenAI 兼容网关，免 Key 用多家前沿模型（第三方开源，与本项目开发者无关）"
        onClick={() => setOpen(true)}
      >
        <span className="provider-item-icon" style={{ background: "linear-gradient(135deg, #2f6bdd, #7048e8)" }}><Store size={13} /></span>
        <div className="provider-item-main">
          <span className="provider-name-row">
            <strong>免费模型网关</strong>
            <b className="provider-sponsor-badge">推荐插件</b>
          </span>
          <small>免 Key 用 DeepSeek V4.1 Flash、Kimi K3 等 · {DISCLAIMER_SHORT}</small>
        </div>
      </button>
      {open && <FreeGatewayDialog onClose={() => setOpen(false)} />}
    </>
  );
}

export function FreeGatewayDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    void window.codex.freeGatewayStatus().then((s) => setStatus(s as GatewayStatus)).catch((e) => setError(String(e?.message ?? e)));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const run = async (label: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(label); setMsg(""); setError("");
    try { await fn(); after?.(); refresh(); }
    catch (e: any) { setError(String(e?.message ?? e)); }
    finally { setBusy(""); }
  };

  const register = async () => {
    if (!status?.port) return;
    setBusy("register"); setMsg(""); setError("");
    try {
      const res = await window.codex.freeGatewayModels();
      const ids: string[] = Array.isArray((res as any)?.models) ? (res as any).models : [];
      if (!ids.length) throw new Error("网关没有返回任何模型（先在它的管理台登录至少一个渠道账号）");
      await window.codex.saveCustomModel({
        provider: "free-gateway",
        name: "免费模型网关",
        model: ids[0],
        baseUrl: `http://127.0.0.1:${status.port}/v1`,
        contextWindow: 128000,
        apiKey: status.forwardKey || "",
        models: ids.map((id) => ({ id, contextWindow: 128000 })),
      });
      setMsg(`已注册「免费模型网关」供应商（${ids.length} 个模型）。左侧列表若未立即出现，切走再切回设置页即可；保持网关运行，模型才能用。`);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally { setBusy(""); }
  };

  const s = status;
  return createPortal(
    <SettingsDialog title="免费模型网关（推荐插件）" icon={<Store size={15} />} hint="第三方开源 · MIT · 与本项目开发者无关" onClose={onClose}>
      <div className="free-gateway-panel">
        <div className="free-gateway-disclaimer">
          <ShieldAlert size={14} />
          <p>{DISCLAIMER_FULL}</p>
        </div>

        <div className="free-gateway-status">
          <span className={`free-gateway-pill ${s?.downloaded ? "on" : ""}`}>{s?.downloaded ? `本体 ${s.version || "已下载"}` : "本体未下载"}</span>
          <span className={`free-gateway-pill ${s?.running ? "on" : ""}`}>{s?.running ? `运行中 · 127.0.0.1:${s.port}` : "服务未运行"}</span>
          <span className={`free-gateway-pill ${s?.hasForwardKey ? "on" : ""}`}>{s?.hasForwardKey ? "Key 已就绪" : "Key 未生成（首次启动自动生成）"}</span>
        </div>

        <div className="free-gateway-actions">
          {!s?.downloaded && (
            <button className="primary-setting" disabled={busy !== ""} onClick={() => void run("download", () => window.codex.freeGatewayDownload())}>
              {busy === "download" ? <Spinner /> : <Download size={14} />}下载本体（约 12 MB）
            </button>
          )}
          {s?.downloaded && !s.running && (
            <button className="primary-setting" disabled={busy !== ""} onClick={() => void run("start", () => window.codex.freeGatewayStart())}>
              {busy === "start" ? <Spinner /> : <Play size={14} />}启动网关
            </button>
          )}
          {s?.running && (
            <button className="secondary-setting" disabled={busy !== ""} onClick={() => void run("stop", () => window.codex.freeGatewayStop())}>
              {busy === "stop" ? <Spinner /> : <Square size={13} />}停止
            </button>
          )}
          {s?.running && (
            <button className="secondary-setting" disabled={busy !== ""} onClick={() => void run("admin", async () => { const r: any = await window.codex.freeGatewayOpenAdmin(); await window.codex.openExternal(r.url); }, refresh)}>
              <ExternalLink size={13} />打开管理台（登录渠道账号）
            </button>
          )}
          {s?.running && s.hasForwardKey && (
            <button className="primary-setting" disabled={busy !== ""} onClick={() => void register()}>
              {busy === "register" ? <Spinner /> : <CircleCheck size={14} />}一键注册为供应商
            </button>
          )}
          <button className="icon-button" title="刷新状态" onClick={refresh}><RefreshCw size={14} /></button>
        </div>

        {s?.stage && <p className="free-gateway-note">正在{ s.stage === "downloading" ? "下载" : "解压" }上游仓库…</p>}
        <p className="free-gateway-note">使用顺序：下载本体 → 启动网关 → 打开管理台登录你想用的渠道账号 → 回这里「一键注册为供应商」→ 到左侧供应商列表选模型。保持网关运行，模型才可用。</p>
        {msg && <p className="free-gateway-msg">{msg}</p>}
        {(error || s?.stageError) && <p className="free-gateway-error">{error || s?.stageError}</p>}
      </div>
    </SettingsDialog>,
    document.body,
  );
}
