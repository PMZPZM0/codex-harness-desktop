/**
 * 设置页 · 云账号（10-16）—— 中转站式云账号登录 + 云端模型同步 + 云端知识库/记忆。
 *
 * 设计约束（用户令「各板块之间保持独立，避免结构臃肿」）：
 *   · **自包含**：只经主进程的 `cloud-*` 通道取数，⛔ 不接收 app props、不往 bag 加字段；
 *   · 通道清单 / 落盘位置 / 排查手册见 `docs/CLOUD-ACCOUNT.md`。
 *
 * ⛔ 三条必须在 UI 上如实呈现、不许含糊的事实：
 *   ① 登录后**模型会自动出现在下拉框**（勾选 = 下拉框可见），要明确告诉用户去哪儿看；
 *   ② 云端知识库与**本地**知识库是两份东西（云端跨设备、本地随项目走）；
 *   ③ 记忆中枢当前**没有 MCP 端点**，所以记忆只能是 `rest-only` —— 不画一个假装能用的开关。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Cloud, Coins, Database, ExternalLink, LogIn, LogOut, RefreshCw, RotateCcw, TriangleAlert } from "lucide-react";
import { PageInfo } from "../../components/SettingsHead";
import { Spinner } from "../../components/CardShell";
import { cloudUserCenterUrl } from "../../lib/cloud-links.mjs";

import { SessionSyncDialog } from "./SessionSyncDialog";
import { ResultDialog } from "./ResultDialog";
type AccountView = { id: string; username: string; role: string; baseUrl: string; active: boolean; savedAt: number };
type AuthStatus = { loggedIn: boolean; baseUrl: string; active: AccountView | null; accounts: AccountView[]; defaultBaseUrl: string };
type ModelStatus = { loggedIn: boolean; registered: boolean; enabled: boolean; active: boolean; models: number; hasToken: boolean; lastSyncAt: number };
type KbStatus = { exists: boolean; enabled: boolean; url: string; hasToken: boolean };
type MemoryStatus = { mode: string; hasCredentials: boolean; note: string; upstream?: "memory" | "model"; connectorId?: string };
type PointTxn = { id?: string; at?: number; delta?: number; kind?: string; note?: string; after?: number };
type Points = { ok: boolean; balance: number; signupGrant: number; txns: PointTxn[]; error?: string };

/** 积分变动的类型标签（与服务端 `kind` 同源；⛔ 不认识的 kind 原样显示，别吞掉）。 */
const KIND_LABEL: Record<string, string> = {
  signup: "注册赠送",
  grant: "发放",
  consume: "调用消耗",
  entitlement: "开通权益",
  refund: "退还",
  admin: "管理员调整",
};

/** 主进程通道面。全部可选 —— 老构建没有这些通道时页面要能优雅降级（⛔ 不是白屏）。 */
type CloudApi = {
  cloudAuthLogin?: (input: { baseUrl?: string; username: string; password: string }) => Promise<{ ok: boolean; error?: string }>;
  /* 10-18 会话同步（手动）：与模型同步独立。⛔ 服务端可被管理员关闭，届时 code=session-sync-disabled */
  cloudSyncPush?: (input?: { paths?: string[] }) => Promise<{ ok: boolean; reserved?: boolean; code?: string; error?: string }>;
  cloudSyncPull?: (input?: { keys?: string[] }) => Promise<{ ok: boolean; reserved?: boolean; code?: string; error?: string }>;
  cloudAuthLogout?: (id?: string) => Promise<{ ok: boolean }>;
  cloudAuthSwitch?: (id: string) => Promise<{ ok: boolean }>;
  cloudAuthStatus?: () => Promise<AuthStatus>;
  cloudAuthPoints?: () => Promise<Points>;
  cloudModelsSync?: (input?: { force?: boolean }) => Promise<{ ok: boolean; models: number; changed: boolean; promoted: boolean; error?: string }>;
  cloudModelsActivate?: () => Promise<{ ok: boolean; model: string; error?: string }>;
  cloudModelsStatus?: () => Promise<ModelStatus>;
  cloudKbSync?: () => Promise<{ ok: boolean; action: string; url?: string; kbName?: string; error?: string }>;
  cloudKbStatus?: () => Promise<KbStatus>;
  cloudMemorySync?: () => Promise<{ ok: boolean; mode: string; error?: string; upstream?: "memory" | "model"; upstreamChanged?: boolean }>;
  cloudMemoryStatus?: () => Promise<MemoryStatus>;
};

const cloudApi = (): CloudApi => window.codex as unknown as CloudApi;

/** 同步完必须刷新渲染层的供应商状态：下拉框的开启条件是 `customModel` 非空，
 *  而它只在页面加载时读一次 —— 不刷新就会出现"同步成功了但下拉框还是空的"。 */
function refreshProviders() {
  try {
    (window as unknown as { __refreshProviders?: () => void }).__refreshProviders?.();
  } catch { /* 未接线时忽略 */ }
}

function agoText(at: number): string {
  if (!at) return "从未";
  const sec = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (sec < 60) return "刚刚";
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  return `${Math.floor(sec / 3600)} 小时前`;
}

export function CloudAccountSection() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [models, setModels] = useState<ModelStatus | null>(null);
  const [points, setPoints] = useState<Points | null>(null);
  const [kb, setKb] = useState<KbStatus | null>(null);
  const [memory, setMemory] = useState<MemoryStatus | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  /* 10-18：会话同步用**独立弹窗**（非内嵌）；null = 关闭 */
  const [sessionDialog, setSessionDialog] = useState<"upload" | "pull" | null>(null);
  /* 10-18：连通测试 / 刷新的**弹窗**反馈（内嵌 hint 会被滚动错过） */
  const [resultDialog, setResultDialog] = useState<{ title: string; tone: "ok" | "err" | "info"; message: string; details?: Array<{ label: string; value: string }> } | null>(null);
  const confirmTimer = useRef<number | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const refresh = useCallback(async () => {
    const api = cloudApi();
    if (!api.cloudAuthStatus) { setUnsupported(true); return; }
    const s = await api.cloudAuthStatus();
    setStatus(s);
    if (!s.loggedIn) { setModels(null); setKb(null); setMemory(null); setPoints(null); return; }
    const [m, k, mem, pts] = await Promise.all([
      api.cloudModelsStatus?.() ?? Promise.resolve(null),
      api.cloudKbStatus?.() ?? Promise.resolve(null),
      api.cloudMemoryStatus?.() ?? Promise.resolve(null),
      api.cloudAuthPoints?.() ?? Promise.resolve(null),
    ]);
    setModels(m); setKb(k); setMemory(mem); setPoints(pts);
  }, []);

  useEffect(() => {
    void refresh();
    return () => { if (confirmTimer.current != null) window.clearTimeout(confirmTimer.current); };
  }, [refresh]);

  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } finally { setBusy(""); }
  }, []);

  const doLogin = () => run("login", async () => {
    const api = cloudApi();
    if (!api.cloudAuthLogin) return;
    setMsg(null);
    const r = await api.cloudAuthLogin({ baseUrl: baseUrl.trim() || undefined, username: username.trim(), password });
    if (!r.ok) { setMsg({ kind: "err", text: r.error || "登录失败" }); return; }
    setPassword("");
    const sync = await api.cloudModelsSync?.({ force: false });
    refreshProviders();
    setMsg({
      kind: "ok",
      text: sync?.ok
        ? `登录成功，已同步 ${sync.models} 个云端模型 —— 到「设置 → 模型」的供应商「云端模型」里就能选到它们。`
        : "登录成功。模型同步未完成（可稍后点「立即同步模型」重试）。",
    });
    await refresh();
  });

  const doSync = (force: boolean) => run(force ? "resync" : "sync", async () => {
    const api = cloudApi();
    if (!api.cloudModelsSync) return;
    setMsg(null);
    const r = await api.cloudModelsSync({ force });
    refreshProviders();
    setMsg(r.ok
      ? {
        kind: "ok",
        text: r.models > 0
          ? `已同步 ${r.models} 个云端模型${r.changed ? "（本机档案已更新）" : "（无变化）"}${r.promoted ? "，并把「云端模型」设为当前生效供应商" : ""}。`
          : "云端当前没有勾选任何模型 —— 去云用户中心或面板里勾选后再同步。",
      }
      : { kind: "err", text: r.error === "not-logged-in" ? "登录已过期，请重新登录" : `同步失败：${r.error || "未知原因"}` });
    await refresh();
  });

  /* 10-18 手动会话同步（推 / 拉）。
     ⛔ 失败文案必须能分辨「管理员已关闭」——服务端会回 code=session-sync-disabled，
        这时**不是**网络故障，不能让用户反复重试。 */
  const doSyncPush = () => run("sync-push", async () => {
    const api = cloudApi();
    if (!api.cloudSyncPush) return;
    setMsg(null);
    const r = await api.cloudSyncPush({});
    setMsg(r.ok
      ? { kind: "ok", text: "会话已上传到云端" }
      : { kind: "err", text: r.code === "session-sync-disabled" ? "管理员已关闭云端会话同步" : (r.error || "上传失败") });
  });
  const doSyncPull = () => run("sync-pull", async () => {
    const api = cloudApi();
    if (!api.cloudSyncPull) return;
    setMsg(null);
    const r = await api.cloudSyncPull({});
    setMsg(r.ok
      ? { kind: "ok", text: "已从云端下载" }
      : { kind: "err", text: r.code === "session-sync-disabled" ? "管理员已关闭云端会话同步" : (r.error || "下载失败") });
  });

  /** 打开**云端用户中心**（账户 / 积分 / 模型勾选 / 知识库 / 记忆 的自助页）。
   *  ⛔ 它是纯静态页 + 账号服务接口，**不需要桌面端在线**（页内只有配对中心那块会提示本机助手未启动）。
   *  地址由账号服务基址派生（`src/lib/cloud-links.mjs`），⛔ 不写死域名。 */
  const openUserCenter = () => {
    const url = cloudUserCenterUrl(status?.baseUrl);
    if (!url) { setMsg({ kind: "err", text: "还不知道账号服务地址 —— 先登录一次即可" }); return; }
    void window.codex.openExternal(url).catch((error: any) => setMsg({ kind: "err", text: `打开失败：${error?.message ?? error}` }));
  };

  const doActivate = () => run("activate", async () => {
    const api = cloudApi();
    if (!api.cloudModelsActivate) return;
    setMsg(null);
    const r = await api.cloudModelsActivate();
    refreshProviders();
    setMsg(r.ok
      ? { kind: "ok", text: `已把「云端模型」设为当前生效供应商（默认模型 ${r.model}）—— 引擎正在重启以应用新密钥。` }
      : { kind: "err", text: r.error === "no-models" ? "云端没有可用模型，先在云端勾选后再同步" : "切换失败，请先「立即同步模型」再试" });
    await refresh();
  });

  const doKb = () => run("kb", async () => {
    const api = cloudApi();
    if (!api.cloudKbSync) return;
    setMsg(null);
    const r = await api.cloudKbSync();
    setMsg(r.ok
      ? { kind: "ok", text: `云端知识库已接通为 MCP 连接器${r.kbName ? `（${r.kbName}）` : ""} —— 重启会话后 Codex 可直接检索它。` }
      : { kind: "err", text: r.error === "not-activated" ? "云端知识库未开通权益（服务端不建库、不发钥匙）—— 先在云用户中心开通。" : `接通失败：${r.error || "未知原因"}` });
    await refresh();
  });

  const doMemory = () => run("memory", async () => {
    const api = cloudApi();
    if (!api.cloudMemorySync) return;
    setMsg(null);
    const r = await api.cloudMemorySync();
    setMsg(r.mode === "rest-only"
      ? (r.upstream === "memory"
          ? { kind: "ok", text: "云端记忆已接通：对话上游已切到记忆端点，记忆在请求层自动注入与写入（无需工具调用）。" }
          : { kind: "ok", text: "记忆凭据已取回并加密缓存；再刷新一次或重启应用即可切到记忆上游。" })
      : r.ok ? { kind: "ok", text: "云端记忆已接通。" } : { kind: "err", text: r.error === "not-activated" ? "云端记忆未开通权益 —— 先在云用户中心开通。" : `失败：${r.error || "未知原因"}` });
    await refresh();
  });

  /* 10-18 连通测试：只**探测**（复用 cloudKbStatus / cloudMemoryStatus，不建连接、不改配置），
     结果用弹窗展示 —— 用户要求「连通测试弹窗反馈」。 */
  const doTest = (kind: "kb" | "memory") => run(`test-${kind}`, async () => {
    const api = cloudApi();
    try {
      if (kind === "kb") {
        const st = await api.cloudKbStatus?.();
        if (!st) { setResultDialog({ title: "连通测试 · 知识库", tone: "err", message: "当前版本不支持知识库探测（缺少 cloudKbStatus）" }); return; }
        const ok = Boolean(st.url && st.hasToken);
        setResultDialog({
          title: "连通测试 · 云端知识库",
          tone: ok ? "ok" : "err",
          message: ok
            ? "连接信息完整：端点已下发、凭据已保存。引擎可把它当 MCP 连接器检索。"
            : "连接信息不完整 —— 还需要先「接通 / 刷新云端知识库」。",
          details: [
            { label: "端点", value: st.url ? st.url : "无" },
            { label: "凭据", value: st.hasToken ? "已保存" : "无" },
            { label: "名称", value: (st as { kbName?: string }).kbName || "—" },
          ],
        });
      } else {
        const st = await api.cloudMemoryStatus?.();
        if (!st) { setResultDialog({ title: "连通测试 · 记忆", tone: "err", message: "当前版本不支持记忆探测（缺少 cloudMemoryStatus）" }); return; }
        const ok = st.mode === "mcp" || st.mode === "rest-only";
        setResultDialog({
          title: "连通测试 · 云端记忆",
          tone: ok ? "ok" : "err",
          message: ok
            ? (st.upstream === "memory" ? "记忆已接通：对话上游已切到记忆端点，请求层自动注入与写入。" : "凭据已就绪（未生效）：再刷新一次或重启应用即会切到记忆上游。")
            : "尚未开通或未取到凭据 —— 先「获取 / 刷新记忆凭据」。",
          details: [
            { label: "模式", value: st.mode || "—" },
            { label: "上游", value: (st as { upstream?: string }).upstream || "—" },
            { label: "凭据", value: st.hasCredentials ? "已缓存" : "无" },
          ],
        });
      }
    } catch (e) {
      setResultDialog({ title: `连通测试 · ${kind === "kb" ? "知识库" : "记忆"}`, tone: "err", message: `探测异常：${(e as Error).message.slice(0, 160)}` });
    }
  });

  const doLogout = (id?: string) => {
    if (!confirmLogout) {
      setConfirmLogout(true);
      confirmTimer.current = window.setTimeout(() => setConfirmLogout(false), 4000);
      return;
    }
    setConfirmLogout(false);
    void run("logout", async () => {
      const api = cloudApi();
      if (!api.cloudAuthLogout) return;
      const r = await api.cloudAuthLogout(id);
      refreshProviders();
      setMsg(r.ok ? { kind: "ok", text: "已退出云账号（云端模型已从下拉框收起，配置保留，重新登录即恢复）。" } : { kind: "err", text: "退出失败" });
      await refresh();
    });
  };

  const doSwitch = (id: string) => run("switch", async () => {
    const api = cloudApi();
    if (!api.cloudAuthSwitch) return;
    const r = await api.cloudAuthSwitch(id);
    if (!r.ok) { setMsg({ kind: "err", text: "切换失败" }); return; }
    await api.cloudModelsSync?.({ force: false });
    refreshProviders();
    setMsg({ kind: "ok", text: "已切换云账号并同步其云端模型。" });
    await refresh();
  });

  const busyIcon = (key: string) => (busy === key ? <Spinner /> : null);

  return (
    <section className="settings-section stack">
      {/* 10-18 会话同步弹窗（**独立弹窗，非内嵌**）。成功关闭后回调刷新外部界面：
          让"最近同步 / 已上传数量"这类展示跟着变（用户要求：状态变化后正确渲染刷新）。 */}
      {resultDialog && (
        <ResultDialog
          title={resultDialog.title}
          tone={resultDialog.tone}
          message={resultDialog.message}
          details={resultDialog.details}
          onClose={() => setResultDialog(null)}
        />
      )}
      {sessionDialog && (
        <SessionSyncDialog
          mode={sessionDialog}
          onClose={(result) => { setSessionDialog(null); if (result) { setMsg(result); void refresh(); } }}
        />
      )}
      <div className="settings-copy channel-heading">
        <div>
          <h2>
            云账号
            <PageInfo
              text={<>登录云端账号后，<b>云端勾选的模型会自动同步</b>到本机模型下拉框，并每 10 分钟保持更新；<b>云端知识库</b>会接成 MCP 连接器供 Codex 直接检索。<br />⛔ 这与「中转站」是两条独立的登录线，互不影响。</>}
            />
          </h2>
          <p className="muted">
            云端的记忆与知识库跨设备共享；本机「知识库」页那一份是<b>项目级</b>的（随项目走），两者并存、不冲突。
          </p>
        </div>
      </div>

      {msg && <div className={`cloud-acct-msg ${msg.kind}`}>{msg.text}</div>}

      {unsupported ? (
        <div className="cloud-acct-msg err">
          当前构建未包含云账号接口（主进程缺少 cloud-* 通道），请更新后再试。
        </div>
      ) : !status ? (
        <div className="cloud-acct-card"><Spinner /></div>
      ) : !status.loggedIn ? (
        <>
          <div className="cloud-acct-card">
            <div className="cloud-acct-head">
              <Cloud size={16} />
              <strong>登录云账号</strong>
              <span className="cloud-acct-sub">用云账号的账号密码登录（与网页端同一套账号）</span>
            </div>
            <div className="cloud-acct-row">
              <label htmlFor="cloud-acct-user">账号</label>
              <input
                id="cloud-acct-user"
                className="field"
                value={username}
                autoComplete="username"
                placeholder="用户名"
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && username && password) doLogin(); }}
              />
            </div>
            <div className="cloud-acct-row">
              <label htmlFor="cloud-acct-pwd">密码</label>
              <input
                id="cloud-acct-pwd"
                className="field"
                type="password"
                value={password}
                autoComplete="current-password"
                placeholder="密码"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && username && password) doLogin(); }}
              />
            </div>
            <details className="cloud-acct-adv">
              <summary>服务地址（默认 {status.defaultBaseUrl}）</summary>
              <input
                className="field"
                value={baseUrl}
                placeholder={status.defaultBaseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </details>
            <div className="cloud-acct-actions">
              <button className="primary-setting" disabled={!username || !password || busy === "login"} onClick={doLogin}>
                <LogIn size={14} />{busy === "login" ? "登录中…" : "登录"}
              </button>
            </div>
          </div>
          <div className="cloud-acct-card">
            <div className="cloud-acct-head">
              <ExternalLink size={16} />
              <strong>还没有云账号？</strong>
              <span className="cloud-acct-sub">在云端用户中心注册后再回来登录</span>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              用户中心是<b>浏览器里的网页</b>（改密码 / 看积分 / 勾选模型 / 开通知识库与记忆 / 管理设备），
              ⛔ 不需要桌面端在线，也不需要先打开云助手。
            </p>
            <div className="cloud-acct-actions">
              <button className="secondary-setting" onClick={openUserCenter}>
                <ExternalLink size={14} />打开云端用户中心（注册 / 查看账户）
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="cloud-acct-card">
            <div className="cloud-acct-head">
              <Cloud size={16} />
              <strong>{status.active?.username}</strong>
              <span className="cloud-acct-tag on">{status.active?.role}</span>
              <span className="cloud-acct-sub">已登录</span>
            </div>
            <div className="cloud-acct-kv"><span>服务地址</span><code>{status.active?.baseUrl}</code></div>
            <div className="cloud-acct-actions">
              <button className="secondary-setting" disabled={!!busy} onClick={() => doSync(false)}>
                <RefreshCw size={14} />{busy === "sync" ? "同步中…" : "立即同步模型"}
              </button>
              <button className="secondary-setting" disabled={!!busy} onClick={() => doSync(true)}>
                <RotateCcw size={14} />{busy === "resync" ? "重签中…" : "重签密钥并同步"}
              </button>
              <button className="secondary-setting" onClick={openUserCenter}>
                <ExternalLink size={14} />云端用户中心
              </button>
              <button className="secondary-setting danger" disabled={!!busy} onClick={() => doLogout(status.active?.id)}>
                <LogOut size={14} />{confirmLogout ? "再点一次确认退出" : "退出登录"}
              </button>
              {busyIcon("sync")}{busyIcon("resync")}
            </div>
            {/* 10-18 用户要求：会话同步单独一行、靠左（原来挤在模型按钮末尾会换行错位） */}
            <div className="cloud-acct-actions">
              <button className="secondary-setting" disabled={!!busy} onClick={() => setSessionDialog("upload")}>
                {busy === "sync-push" ? "上传中…" : "上传会话"}
              </button>
              <button className="secondary-setting" disabled={!!busy} onClick={() => setSessionDialog("pull")}>
                {busy === "sync-pull" ? "下载中…" : "从云端下载"}
              </button>
            </div>
          </div>

          {status.accounts.length > 1 && (
            <div className="cloud-acct-card">
              <div className="cloud-acct-head"><strong>其他已保存的云账号</strong></div>
              {status.accounts.filter((a) => !a.active).map((a) => (
                <div className="cloud-acct-row" key={a.id}>
                  <label>{a.username}</label>
                  <span className="cloud-acct-sub" style={{ flex: 1 }}>{a.baseUrl}</span>
                  <button className="secondary-setting" disabled={!!busy} onClick={() => doSwitch(a.id)}>切为此账号</button>
                  <button className="secondary-setting danger" disabled={!!busy} onClick={() => doLogout(a.id)}>移除</button>
                </div>
              ))}
            </div>
          )}

          {/* 积分（账户级）：余额 + 最近变动。⛔ 不加红绿涨跌色 —— 这是积分不是行情，
              用 +/- 表达增减，避免与「涨红跌绿」那套语义撞车。 */}
          <div className="cloud-acct-card">
            <div className="cloud-acct-head">
              <Coins size={16} />
              <strong>我的积分</strong>
              <span className={`cloud-acct-tag ${points?.ok ? "on" : "off"}`}>
                {points ? (points.ok ? `${Number(points.balance).toLocaleString()} 积分` : "读取失败") : "读取中…"}
              </span>
              {points && !points.ok && <span className="cloud-acct-sub">{points.error}</span>}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              用途：在「云端模型」里调用模型时按<b>模型倍率</b>扣减；余额为 0 会暂停调用。
            </p>
            {points?.txns?.length ? (
              <div className="cloud-acct-txns">
                {points.txns.map((t, i) => (
                  <div className="cloud-acct-txn" key={t.id || `${t.at}-${i}`}>
                    <span className="cloud-acct-txn-when">
                      {t.at ? new Date(t.at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}
                    </span>
                    <span className="cloud-acct-txn-kind">{t.kind ? (KIND_LABEL[t.kind] || t.kind) : "变动"}</span>
                    <span className="cloud-acct-txn-note" title={t.note || ""}>{t.note || ""}</span>
                    <span className="cloud-acct-txn-delta">{(t.delta ?? 0) >= 0 ? "+" : ""}{t.delta ?? 0}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>
                {points?.ok ? `暂无变动记录（注册赠送 ${Number(points.signupGrant || 0).toLocaleString()} 积分）` : "登录后读取"}
              </div>
            )}
          </div>

          <div className="cloud-acct-card">
            <div className="cloud-acct-head">
              <Database size={16} />
              <strong>云端模型</strong>
              <span className={`cloud-acct-tag ${models?.registered && models.enabled ? "on" : "off"}`}>
                {models?.registered ? (models.enabled ? "已注册" : "已停用") : "未注册"}
              </span>
              {models?.registered && (
                <span className={`cloud-acct-tag ${models.active ? "on" : "off"}`}>{models.active ? "当前生效" : "未生效"}</span>
              )}
            </div>
            <div className="cloud-acct-metrics">
              <span>下拉框可见模型 <b>{models?.models ?? 0}</b> 个</span>
              <span>代理密钥 <b>{models?.hasToken ? "已就位" : "缺失"}</b></span>
              <span>上次同步 <b>{agoText(models?.lastSyncAt ?? 0)}</b></span>
              <span>自动保持更新 <b>每 10 分钟</b></span>
            </div>
            {models?.registered && !models.active && (
              <div className="cloud-acct-actions">
                <button className="primary-setting" disabled={!!busy || !models.models} onClick={doActivate}>
                  <Cloud size={14} />{busy === "activate" ? "切换中…" : "设为当前供应商"}
                </button>
                {busyIcon("activate")}
                <span className="cloud-acct-sub">你现在用的是别的供应商 —— 点这里切到云端模型（会重启引擎）</span>
              </div>
            )}
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              勾选哪些模型由云端决定（云端勾选 = 本机下拉框可见）。改了勾选后在云端保存，本机最多 10 分钟自动跟上，也可点上面的「立即同步模型」。
            </p>
          </div>

          <div className="cloud-acct-card">
            <div className="cloud-acct-head">
              <BookOpen size={16} />
              <strong>云端知识库</strong>
              <span className={`cloud-acct-tag ${kb?.enabled ? "on" : "off"}`}>{kb?.enabled ? "已接通" : kb?.exists ? "已停用" : "未接通"}</span>
            </div>
            <div className="cloud-acct-metrics">
              <span>连接器 <b>cloud-kb</b></span>
              <span>端点 <b>{kb?.url ? "已下发" : "无"}</b></span>
              <span>凭据 <b>{kb?.hasToken ? "已保存" : "无"}</b></span>
            </div>
            <div className="cloud-acct-actions">
              <button className="secondary-setting" disabled={!!busy} onClick={doKb}>
                <BookOpen size={14} />{busy === "kb" ? "接通中…" : "接通 / 刷新云端知识库"}
              </button>
              <button className="secondary-setting" disabled={!!busy} onClick={() => doTest("kb")}>
                {busy === "test-kb" ? "测试中…" : "连通测试"}
              </button>
              {busyIcon("kb")}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              接通后以 MCP 连接器形式提供给引擎（令牌经环境变量注入，⛔ 不写进 config.toml）。它与本机「知识库」页那份项目级知识库是<b>两份</b>，各管各的。
            </p>
          </div>

          <div className="cloud-acct-card">
            <div className="cloud-acct-head">
              <TriangleAlert size={16} />
              <strong>云端记忆</strong>
              <span className={`cloud-acct-tag ${memory?.mode === "mcp" || memory?.upstream === "memory" ? "" : "off"}`}>
                {memory?.mode === "mcp"
                  ? "已接通（MCP）"
                  : memory?.mode === "rest-only"
                    ? (memory?.upstream === "memory" ? "已接通（请求层）" : "凭据就绪（未生效）")
                    : "未开通"}
              </span>
            </div>
            <div className="cloud-acct-metrics">
              <span>凭据 <b>{memory?.hasCredentials ? "已缓存" : "无"}</b></span>
            </div>
            <div className="cloud-acct-actions">
              <button className="secondary-setting" disabled={!!busy} onClick={doMemory}>
                <RefreshCw size={14} />{busy === "memory" ? "获取中…" : "获取 / 刷新记忆凭据"}
              </button>
              <button className="secondary-setting" disabled={!!busy} onClick={() => doTest("memory")}>
                {busy === "test-memory" ? "测试中…" : "连通测试"}
              </button>
              {busyIcon("memory")}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              {memory?.upstream === "memory" ? (
                <>
                  ✅ 记忆<b>已接通</b>：对话上游已切到记忆端点，记忆在<b>请求层</b>自动注入与写入
                  （每账号独立命名空间，<b>不需要工具调用</b>）。MCP 工具面仍待中枢提供端点 ——
                  2026-10-17 复测：/mcp、/v1/mcp、/sse、/v1/sse 均为前端兜底页（无 MCP 路由），
                  补上后会自动切换成连接器。
                </>
              ) : memory?.mode === "rest-only" ? (
                <>凭据已就绪但<b>尚未生效</b>：再点一次「获取 / 刷新记忆凭据」会把它切到对话上游
                  （重启应用也会自动生效）。</>
              ) : (
                <>记忆中枢的 MCP 端点尚未提供（2026-10-17 复测：/mcp、/v1/mcp、/sse、/v1/sse 均为前端
                  兜底页）；REST 通道正常，开通权益并刷新凭据后按<b>请求层注入</b>生效。</>
              )}
            </p>
          </div>
          <div className="cloud-acct-card">
            <div className="cloud-acct-head">
              <ExternalLink size={16} />
              <strong>云端用户中心</strong>
              <span className="cloud-acct-sub">改密码 / 看积分流水 / 勾选模型 / 开通知识库与记忆 / 管理设备</span>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              在浏览器里打开，<b>不需要桌面端在线</b>；用同一个云账号登录即可。
            </p>
            <div className="cloud-acct-actions">
              <button className="secondary-setting" onClick={openUserCenter}>
                <ExternalLink size={14} />打开云端用户中心
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
