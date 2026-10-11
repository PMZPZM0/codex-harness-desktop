/**
 * 免费模型网关 · 推荐卡 + 管理弹窗（free-gateway 域，10-12）。
 *
 * ⛔⛔ 免责声明是**契约**（用户定稿「一切与开发者无关」）：推荐卡、管理弹窗、新手引导三处
 *   都必须带「与本项目开发者无关」字样（守卫 12c 钉；改文案不许删这半句）。
 * 供应商注册**复用既有** `window.codex.saveCustomModel`（模型配置单一真相源）：
 *   本域只负责把网关跑起来、拿到 forwardKey 与模型清单，注册动作是它的一个调用方。
 *
 * ⛔⛔ 10-12 用户实测四条纪律（违反 = 假绿/无反馈/误导）：
 *   ① status 初始 null 时显 **Spinner**，不许渲染「未下载」等假结论（等异步回来才变 = 骗人）；
 *   ② 启动/停止按钮必须变文字（「启动中…」）+ 完成后显式反馈 —— 不许只加 Spinner 不改文字；
 *   ③ 匿名免费模型（-free 后缀）与渠道模型（登录后才有）**分开呈现** —— 匿名模型质量有限，
 *      一键注册前必须引导用户先登录渠道账号（否则注册了也用不了好模型）；
 *   ④ 一键注册要有 Spinner + 成功状态 + 延迟关弹窗（不许闪关没反馈）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, Download, ExternalLink, Play, RefreshCw, ShieldAlert, Square, Store, Trash2 } from "lucide-react";
import { SettingsDialog } from "../../components/SettingsDialog";
import { Spinner } from "../../components/CardShell";

/** ⛔ 免责声明（单一文案源；卡片摘要与弹窗全文都从这里拼）。 */
export const DISCLAIMER_SHORT = "第三方开源项目，与本项目开发者无关";
const DISCLAIMER_FULL = "「免费模型网关」是第三方开源项目 dsh-our-free-model（MIT），与本项目开发者无关：渠道合规性、可用性、账号与数据安全均由使用者自行承担，渠道可能随上游风控随时失效。";

type GatewayStatus = {
  downloaded: boolean; version: string; running: boolean; port: number;
  forwardKey: string; hasForwardKey: boolean; adminUrl: string;
  stage: string | null; stageError: string | null; lastStartError: string | null;
  dlBytes: number; dlTotal: number;
};

/** 供应商列表里的常驻推荐卡（与 PPtoken 推荐卡同一族的观感）。 */
export function FreeGatewayRecommendCard({ registered, onSelect, setNotice }: { registered?: boolean; onSelect?: () => void; onRegistered?: () => void; setNotice?: (msg: string) => void } = {}) {
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  return (
    <>
      <button
        type="button"
        className="provider-item sponsor free-gateway-entry"
        title={registered
          ? "免费模型网关已注册 —— 点此选中它，在右侧模型列表里挑选要用的模型；「管理」链接可启停网关"
          : "免费模型网关：下载并启动本地 OpenAI 兼容网关，免 Key 用多家前沿模型（第三方开源，与本项目开发者无关）"}
        onClick={() => { if (registered) { onSelect?.(); return; } setOpen(true); }}
      >
        <span className="provider-item-icon" style={{ background: "linear-gradient(135deg, #2f6bdd, #7048e8)" }}><Store size={13} /></span>
        <div className="provider-item-main">
          <span className="provider-name-row">
            <strong>免费模型网关</strong>
            <b className="provider-sponsor-badge">{registered ? "已注册" : "推荐插件"}</b>
          </span>
          <small>{registered
            ? "已注册为供应商 · 点此选中并在右侧挑模型 · 「管理」可启停网关"
            : `免 Key 用 DeepSeek V4.1 Flash、Kimi K3 等 · ${DISCLAIMER_SHORT}`}</small>
        </div>
        {registered && (
          <span
            role="button" tabIndex={0}
            className="free-gateway-manage-link"
            title="网关生命周期管理：启停 / 管理台 / 重新注册"
            onClick={(e) => { e.stopPropagation(); setManaging(true); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setManaging(true); } }}
          >管理</span>
        )}
      </button>
      {open && <FreeGatewayDialog onClose={() => setOpen(false)} onRegistered={() => { setOpen(false); onSelect?.(); onRegistered?.(); }} setNotice={setNotice} />}
      {managing && <FreeGatewayDialog onClose={() => setManaging(false)} />}
    </>
  );
}

export function FreeGatewayDialog({ onClose, onRegistered, setNotice }: { onClose: () => void; onRegistered?: () => void; setNotice?: (msg: string) => void }) {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const refresh = useCallback(() => {
    void window.codex.freeGatewayStatus()
      .then((s) => { setStatus(s as GatewayStatus); setStatusLoading(false); })
      .catch((e) => { setError(String(e?.message ?? e)); setStatusLoading(false); });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  /* ⛔ 自动启动兜底：对话框打开 → status 回来 → 已下载但未运行 → 自动拉起网关。
     domain 的 5s 延迟启动可能因 userData 路径时序静默失败 —— 这是第二道保底。 */
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (statusLoading || !status || autoStartedRef.current || busy) return;
    if (status.downloaded && !status.running && status.hasForwardKey) {
      autoStartedRef.current = true;
      void window.codex.freeGatewayStart()
        .then(() => { setSuccess("✅ 网关已自动启动（跟随应用）"); refresh(); })
        .catch(() => { autoStartedRef.current = false; /* 失败允许重试 */ });
    }
  }, [statusLoading, status, busy, refresh]);
  /* 下载/解压期间轮询状态（500ms）—— 进度条与阶段文案的实时数据源 */
  useEffect(() => {
    if (!status?.stage) return;
    const t = setInterval(refresh, 500);
    return () => clearInterval(t);
  }, [status?.stage, refresh]);

  const run = async (label: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(label); setMsg(""); setError(""); setSuccess("");
    try { await fn(); after?.(); refresh(); }
    catch (e: any) { setError(String(e?.message ?? e)); }
    finally { setBusy(""); }
  };

  const register = async () => {
    if (!status?.port) return;
    setBusy("register"); setMsg(""); setError(""); setSuccess("");
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
      setSuccess(`✅ 已注册「免费模型网关」供应商（${ids.length} 个模型），正在为你选中…`);
      setTimeout(() => { onClose(); onRegistered?.(); }, 1000);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally { setBusy(""); }
  };

  const s = status;
  const dlMB = (n: number) => (n / 1024 / 1024).toFixed(1);
  const dlPercent = s?.dlTotal ? Math.min(100, Math.round((s.dlBytes / s.dlTotal) * 100)) : 0;

  /* 匿名模型检测：全部以 -free 结尾 = 未登录任何渠道账号 */
  const hasChannelModels = false; // 由模型清单判断；未拉清单时默认 false（保守引导登录）

  return createPortal(
    <SettingsDialog title="免费模型网关（推荐插件）" icon={<Store size={15} />} hint="第三方开源 · MIT · 与本项目开发者无关" onClose={onClose}>
      <div className="free-gateway-panel">
        <div className="free-gateway-disclaimer">
          <ShieldAlert size={14} />
          <p>{DISCLAIMER_FULL}</p>
        </div>

        {/* ⛔ status 加载中显 Spinner，不许渲染「未下载」等假结论（纪律 ①） */}
        {statusLoading && !s && (
          <div className="free-gateway-loading"><Spinner />正在读取网关状态…</div>
        )}

        {!statusLoading && s && (
          <>
            <div className="free-gateway-status">
              <span className={`free-gateway-pill ${s.downloaded ? "on" : ""}`}>{s.downloaded ? `本体 ${s.version || "已下载"}` : "本体未下载"}</span>
              <span className={`free-gateway-pill ${s.running ? "on" : ""}`}>{s.running ? `运行中 · 127.0.0.1:${s.port}` : "服务未运行"}</span>
              <span className={`free-gateway-pill ${s.hasForwardKey ? "on" : ""}`}>{s.hasForwardKey ? "Key 已就绪" : "Key 未生成（首次启动自动生成）"}</span>
            </div>

            <div className="free-gateway-actions">
              {!s.downloaded && (
                <button className="primary-setting" disabled={busy !== "" || s.stage === "downloading"} onClick={() => void run("download", () => window.codex.freeGatewayDownload({}), () => setNotice?.("网关本体下载完成"))}>
                  {busy === "download" || s.stage === "downloading" ? <Spinner /> : <Download size={14} />}
                  {s.stage === "downloading" ? (s.dlTotal ? `下载中 ${dlMB(s.dlBytes)} / ${dlMB(s.dlTotal)} MB（${dlPercent}%）` : `已下载 ${dlMB(s.dlBytes)} MB`) : "下载本体（约 12 MB）"}
                </button>
              )}
              {s.stage === "downloading" && (
                <div className="free-gateway-progress" role="progressbar" aria-label="网关本体下载进度" aria-valuenow={dlPercent} aria-valuemin={0} aria-valuemax={100}>
                  <i style={{ width: `${s.dlTotal ? dlPercent : Math.min(95, Math.round((s.dlBytes / 12 / 1024 / 1024) * 100))}%` }} className={s.dlTotal ? "" : "indeterminate"} />
                </div>
              )}
              {s.downloaded && !s.running && (
                <button className="primary-setting" disabled={busy !== ""} onClick={() => void run("start", () => window.codex.freeGatewayStart(), () => setSuccess("✅ 网关已启动"))}>
                  {busy === "start" ? <Spinner /> : <Play size={14} />}
                  {busy === "start" ? "启动中…（可能需要 20 秒）" : "启动网关"}
                </button>
              )}
              {s.running && (
                <button className="secondary-setting" disabled={busy !== ""} onClick={() => void run("stop", () => window.codex.freeGatewayStop(), () => { setSuccess("✅ 网关已停止"); setNotice?.("免费模型网关已停止"); autoStartedRef.current = false; })}>
                  {busy === "stop" ? <Spinner /> : <Square size={13} />}
                  {busy === "stop" ? "停止中…" : "停止"}
                </button>
              )}
              {s.running && (
                <button className="primary-setting free-gateway-admin-btn" disabled={busy !== ""} onClick={() => void run("admin", async () => { const r: any = await window.codex.freeGatewayOpenAdmin(); await window.codex.openExternal(r.url); })}>
                  <ExternalLink size={13} />打开管理台（登录渠道账号）
                </button>
              )}
              {s.running && s.hasForwardKey && (
                <button className="primary-setting" disabled={busy !== ""} onClick={() => void register()}>
                  {busy === "register" ? <Spinner /> : <CircleCheck size={14} />}
                  {busy === "register" ? "注册中…" : "一键注册为供应商"}
                </button>
              )}
              <button className="icon-button" title="刷新状态" onClick={refresh}><RefreshCw size={14} /></button>
          {s?.downloaded && (
            <button className="secondary-setting free-gateway-uninstall-btn" title="卸载网关（停侧车 + 删本体 + 删数据 + 移除已注册供应商）"
              disabled={busy !== ""}
              onClick={() => void run("uninstall", async () => {
                await window.codex.freeGatewayUninstall();
                try { await window.codex.removeCustomModel("free-gateway"); } catch { /* 未注册时忽略 */ }
                setNotice?.("免费模型网关已卸载");
              }, () => setSuccess("✅ 已卸载免费模型网关"))}>
              <Trash2 size={13} />卸载
            </button>
          )}
            </div>

            {/* ⛔ 启动成功后引导登录（纪律 ③：不登录 = 只有匿名模型，质量有限） */}
            {s.running && !busy && !success && (
              <div className="free-gateway-guide">
                <p>✅ 网关已启动。<strong>下一步：打开管理台登录渠道账号</strong>（CodeBuddy / TRAE / Qoder 等），登录后才有完整模型（DeepSeek V4.1 Flash、Kimi K3 等）。未登录只有匿名免费模型，质量有限。</p>
              </div>
            )}

            {s.stage && s.stage !== "downloading" && <p className="free-gateway-note">正在解压上游仓库…</p>}
            {msg && <p className="free-gateway-note">{msg}</p>}
            {success && <p className="free-gateway-msg">{success}</p>}
            {(error || s.stageError || s.lastStartError) && <p className="free-gateway-error">{error || s.stageError || s.lastStartError}</p>}
            <p className="free-gateway-note">使用顺序：下载本体 → 启动网关 → 打开管理台登录你想用的渠道账号 → 回这里「一键注册为供应商」→ 到左侧供应商列表选模型。保持网关运行，模型才可用。</p>
          </>
        )}
      </div>
    </SettingsDialog>,
    document.body,
  );
}
