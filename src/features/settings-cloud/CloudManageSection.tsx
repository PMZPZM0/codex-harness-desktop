/**
 * 应用内「云管理」（11-03 用户令：「把 codex云管理 / ppcode云管理、会话同步功能给 codexharness 和 ppcode 加上」）。
 *
 * 与网页云管理共用服务端 `/sync/*` 接口（账号 token 鉴权），在设置 → 云账号里直接：
 *   · 看云端存储用量（已用 / 配额 / 会话数 / 设备数）
 *   · 看已上传会话列表（标题 / 项目 / 机器 / 时间 / 大小），按需下载回本机或删除云端
 *   · 立即同步（与后台每 5 分钟一次的自动同步共用同一个上传实现）
 *   · 打开网页云管理（账户 / 积分 / 模型勾选 / 知识库 / 记忆）
 *
 * ⛔ 自包含板块（不吃 props、不进 bag），样板同 CloudAccountSection。
 * ⛔ 只删云端：删除不碰本机 sessions 文件；下载落回本机会话目录后需刷新会话列表才可见。
 * ⛔ 错误一律翻人话：管理员关总闸（session-sync-disabled）/ 未登录 / 配额不足都不能显示成网络错误。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Cloud, Download, ExternalLink, RefreshCw, Search, Trash2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { cloudUserCenterUrl } from "../../lib/cloud-links.mjs";

type CloudSession = {
  id: string;
  title: string;
  project: string;
  machineName: string;
  machineId: string;
  lines: number;
  sizeBytes: number;
  uploadedAt: number;
  updatedAt: number;
};

type Usage = { usedBytes: number; limitBytes: number; sessions: number; devices: number; deviceLimit: number };

type Api = {
  cloudAuthStatus?: () => Promise<{ loggedIn: boolean; baseUrl?: string; defaultBaseUrl?: string }>;
  cloudSyncUsage?: () => Promise<{ ok: boolean; code?: string; error?: string; usedBytes?: number; limitBytes?: number; sessions?: number; devices?: number; deviceLimit?: number }>;
  cloudSyncIndex?: () => Promise<{ ok: boolean; code?: string; error?: string; sessions?: CloudSession[]; usedBytes?: number; limitBytes?: number }>;
  cloudSyncPush?: (input?: { paths?: string[] }) => Promise<{ ok: boolean; code?: string; error?: string; pushedSessions?: number; pushedLines?: number }>;
  cloudSyncPull?: (input?: { keys?: string[] }) => Promise<{ ok: boolean; code?: string; error?: string; pulled?: number }>;
  cloudSyncDelete?: (input?: { ids?: string[] }) => Promise<{ ok: boolean; code?: string; error?: string; deleted?: number }>;
};

const api = (): Api => window.codex as unknown as Api;

function fmtBytes(n: number | undefined): string {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtTime(ms: number | undefined): string {
  const v = Number(ms) || 0;
  if (!v) return "—";
  const d = new Date(v);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 服务端错误码 → 人话（⛔ 管理员关总闸不能显示成"网络坏了"）。 */
function humanError(code: string | undefined, fallback: string | undefined): string {
  if (code === "not-logged-in") return "未登录云账号，请先在上方登录";
  if (code === "session-sync-disabled") return "管理员已关闭云端会话同步";
  if (code === "storage-disabled") return "管理员没有给这个账号开通云存储";
  if (code === "quota-exceeded") return "云端存储配额不足，请先清理云端会话";
  if (code === "bad-args") return fallback || "没有选择要操作的会话";
  if (code === "exception") return fallback || "本机请求异常，详见应用日志";
  return fallback || "请求失败，请稍后重试";
}

export function CloudManageSection() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [webUrl, setWebUrl] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [rows, setRows] = useState<CloudSession[]>([]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"" | "load" | "push" | "pull" | "delete">("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);

  const refresh = useCallback(async () => {
    const cloud = api();
    if (!cloud.cloudAuthStatus) { setLoggedIn(false); return; }
    const status = await cloud.cloudAuthStatus().catch(() => null);
    const on = Boolean(status?.loggedIn);
    setLoggedIn(on);
    setWebUrl(cloudUserCenterUrl(status?.baseUrl || status?.defaultBaseUrl || ""));
    if (!on) { setUsage(null); setRows([]); return; }
    const [u, idx] = await Promise.all([
      Promise.resolve(cloud.cloudSyncUsage?.()).catch(() => null),
      Promise.resolve(cloud.cloudSyncIndex?.()).catch(() => null),
    ]);
    /* ⛔ cloudAuthStatus 的 loggedIn 可能领先于真实凭据（令牌过期 / 只有账号记录）：
       同步接口回 not-logged-in 时按未登录处理，别把一屏按钮摆出来再全部报错。 */
    if (u?.code === "not-logged-in" || idx?.code === "not-logged-in") {
      setLoggedIn(false);
      setUsage(null);
      setRows([]);
      return;
    }
    if (u && !u.ok) { setMsg({ kind: "err", text: humanError(u.code, u.error) }); }
    else if (u) setUsage({ usedBytes: Number(u.usedBytes) || 0, limitBytes: Number(u.limitBytes) || 0, sessions: Number(u.sessions) || 0, devices: Number(u.devices) || 0, deviceLimit: Number(u.deviceLimit) || 0 });
    if (idx && !idx.ok) { setMsg({ kind: "err", text: humanError(idx.code, idx.error) }); }
    else if (idx) {
      setRows(idx.sessions ?? []);
      setUsage((prev) => prev ?? { usedBytes: Number(idx.usedBytes) || 0, limitBytes: Number(idx.limitBytes) || 0, sessions: (idx.sessions ?? []).length, devices: 0, deviceLimit: 0 });
    }
  }, []);

  useEffect(() => { setBusy("load"); void refresh().finally(() => setBusy("")); }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => `${row.title} ${row.project} ${row.machineName} ${row.id}`.toLowerCase().includes(q));
  }, [rows, query]);

  const allPicked = filtered.length > 0 && filtered.every((row) => picked.has(row.id));
  const toggleAll = () => {
    const next = new Set(picked);
    if (allPicked) for (const row of filtered) next.delete(row.id);
    else for (const row of filtered) next.add(row.id);
    setPicked(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };

  const push = async () => {
    if (busy) return;
    setBusy("push"); setMsg(null);
    try {
      const r = await api().cloudSyncPush?.({});
      if (!r) { setMsg({ kind: "err", text: "当前版本不支持会话同步" }); return; }
      setMsg(r.ok ? { kind: "ok", text: `已同步：上传 ${r.pushedSessions ?? 0} 个会话 / ${r.pushedLines ?? 0} 行` } : { kind: "err", text: humanError(r.code, r.error) });
      if (r.ok) await refresh();
    } finally { setBusy(""); }
  };

  const pull = async (ids: string[]) => {
    if (busy || !ids.length) return;
    setBusy("pull"); setMsg(null);
    try {
      const r = await api().cloudSyncPull?.({ keys: ids });
      if (!r) { setMsg({ kind: "err", text: "当前版本不支持从云端下载" }); return; }
      setMsg(r.ok
        ? { kind: "ok", text: `已下载 ${r.pulled ?? 0} 个会话到本机（已有会话会跳过）——到左侧会话列表查看` }
        : { kind: "err", text: humanError(r.code, r.error) });
      if (r.ok) setPicked(new Set());
    } finally { setBusy(""); }
  };

  const remove = async (ids: string[]) => {
    if (busy || !ids.length) return;
    setBusy("delete"); setMsg(null);
    try {
      const r = await api().cloudSyncDelete?.({ ids });
      if (!r) { setMsg({ kind: "err", text: "当前版本不支持删除云端会话" }); return; }
      setMsg(r.ok ? { kind: "ok", text: `已删除云端 ${r.deleted ?? 0} 条会话（本机文件未动）` } : { kind: "err", text: humanError(r.code, r.error) });
      if (r.ok) { setPicked(new Set()); await refresh(); }
    } finally { setBusy(""); setConfirmDelete(null); }
  };

  if (loggedIn === null) return null;
  if (!loggedIn) {
    return (
      <section className="settings-section stack cloud-sync-manage-section">
        <div className="settings-subhead"><Cloud size={13} />云管理<span className="settings-subhead-hint">登录云账号后可用</span></div>
        <p className="settings-card-hint">登录上面的云账号后，这里会显示云端存储用量、已上传会话，并可同步 / 下载 / 删除。</p>
      </section>
    );
  }

  const percent = usage && usage.limitBytes > 0 ? Math.min(100, Math.round((usage.usedBytes / usage.limitBytes) * 100)) : 0;

  return (
    <section className="settings-section stack cloud-sync-manage-section" data-testid="cloud-sync-manage-section">
      <div className="settings-subhead">
        <Cloud size={13} />云管理
        <span className="settings-subhead-hint">云端会话 · 每 5 分钟自动同步</span>
        <span className="cloud-sync-manage-head-actions">
          <button type="button" className="secondary-setting" disabled={busy === "load"} onClick={() => { setBusy("load"); void refresh().finally(() => setBusy("")); }}>
            <RefreshCw size={13} />刷新
          </button>
          {webUrl ? (
            <button type="button" className="secondary-setting" onClick={() => void window.codex.openExternal(webUrl)}>
              <ExternalLink size={13} />网页云管理
            </button>
          ) : null}
        </span>
      </div>

      <div className="cloud-sync-manage-usage">
        <div className="cloud-sync-manage-usage-row">
          <span>云端存储</span>
          <b>{usage ? `${fmtBytes(usage.usedBytes)} / ${usage.limitBytes ? fmtBytes(usage.limitBytes) : "未开通"}` : (busy === "load" ? "读取中…" : "—")}</b>
        </div>
        <span className="runtime-progress-bar" role="progressbar" aria-label="云端存储用量" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${percent}%` }} />
        </span>
        <small>
          会话 {usage?.sessions ?? 0} 条
          {usage && usage.devices > 0 ? ` · 设备 ${usage.devices}/${usage.deviceLimit || "—"}` : ""}
          {usage && usage.limitBytes === 0 ? " · 管理员未开通云存储，上传会被拒绝" : ""}
        </small>
      </div>

      <div className="cloud-sync-manage-toolbar">
        <button type="button" className="primary-setting" disabled={Boolean(busy)} onClick={() => void push()}>
          {busy === "push" ? <Spinner /> : <RefreshCw size={13} />}{busy === "push" ? "同步中…" : "立即同步"}
        </button>
        <span className="cloud-sync-manage-search">
          <Search size={13} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索会话 / 项目 / 机器" />
        </span>
        <span className="cloud-sync-manage-toolbar-spacer" />
        <button type="button" className="secondary-setting" disabled={Boolean(busy) || picked.size === 0} onClick={() => void pull([...picked])}>
          <Download size={13} />下载选中{picked.size ? ` (${picked.size})` : ""}
        </button>
        <button type="button" className="secondary-setting cloud-sync-manage-danger" disabled={Boolean(busy) || picked.size === 0} onClick={() => setConfirmDelete([...picked])}>
          <Trash2 size={13} />删除选中{picked.size ? ` (${picked.size})` : ""}
        </button>
      </div>

      {msg ? <div className={`cloud-acct-msg ${msg.kind}`}>{msg.text}</div> : null}

      {confirmDelete ? (
        <div className="cloud-sync-manage-confirm">
          <span>删除云端 {confirmDelete.length} 条会话？本机文件不会动。</span>
          <button type="button" className="secondary-setting" onClick={() => setConfirmDelete(null)}>取消</button>
          <button type="button" className="primary-setting danger" disabled={busy === "delete"} onClick={() => void remove(confirmDelete)}>
            {busy === "delete" ? <Spinner /> : null}确认删除
          </button>
        </div>
      ) : null}

      <div className="cloud-sync-manage-list">
        {busy === "load" && !rows.length ? <p className="settings-card-hint">正在读取云端会话…</p> : null}
        {!busy && !rows.length ? <p className="settings-card-hint">云端还没有会话。点「立即同步」把本机会话传上去（之后每 5 分钟自动同步一次）。</p> : null}
        {rows.length ? (
          <div className="cloud-sync-manage-row cloud-sync-manage-row-head">
            <input type="checkbox" aria-label="全选云端会话" checked={allPicked} onChange={toggleAll} />
            <span>会话 / 项目</span>
            <span>机器</span>
            <span>时间</span>
            <span>大小</span>
            <span>操作</span>
          </div>
        ) : null}
        {filtered.map((row) => (
          <div className="cloud-sync-manage-row" key={row.id} data-cloud-session={row.id}>
            <input type="checkbox" aria-label={`选择会话 ${row.title || row.id}`} checked={picked.has(row.id)} onChange={() => toggleOne(row.id)} />
            <span className="cloud-sync-manage-title" title={row.id}>
              <strong>{row.title || "(未命名会话)"}</strong>
              <small>{row.project || "—"} · {row.lines} 行</small>
            </span>
            <span className="cloud-sync-manage-machine">{row.machineName || "—"}</span>
            <span className="cloud-sync-manage-time">{fmtTime(row.updatedAt || row.uploadedAt)}</span>
            <span className="cloud-sync-manage-size">{fmtBytes(row.sizeBytes)}</span>
            <span className="cloud-sync-manage-row-actions">
              <button type="button" className="secondary-setting" disabled={Boolean(busy)} onClick={() => void pull([row.id])}>下载</button>
              <button type="button" className="secondary-setting cloud-sync-manage-danger" disabled={Boolean(busy)} onClick={() => setConfirmDelete([row.id])}>删除</button>
            </span>
          </div>
        ))}
        {rows.length && !filtered.length ? <p className="settings-card-hint">没有匹配「{query}」的云端会话。</p> : null}
      </div>
    </section>
  );
}
