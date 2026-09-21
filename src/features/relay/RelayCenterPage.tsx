/**
 * 中转站账号域（从 src/App.tsx 原样搬来，L4656–L5425 + shortGroupName）。
 *
 * ⛔ 本次是**纯搬迁**：DOM 结构、className、文案、props 一个都没改（重构不算修复）。
 * 唯一随迁的模块级辅助函数是 `shortGroupName`（App 内除本块外 0 处引用）。
 *
 * 公开面见同目录 index.ts。
 */

import { AlertTriangle, ArrowUpRight, Bot, Check, ChevronDown, Clock3, Copy, Eye, EyeOff, FolderTree, Plus, Play, RefreshCw, Settings2, Sparkles, Trash2, X, Zap, CircleCheck, ChevronRight, Wallet, LogIn } from "lucide-react";
import { PageInfo } from "../../components/SettingsHead";
import { Spinner } from "../../components/CardShell";
import { resolveRelayTarget, writeRelayActive, readRelayActive, RelayActive } from "../../lib/relay";
import { copyTextToClipboard } from "../../lib/clipboard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function shortGroupName(name: unknown, max: number) {
  const cleaned = String(name ?? "套餐").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, "").replace(/\s+/g, " ").trim() || "套餐";
  return cleaned.length > max ? cleaned.slice(0, max) + "…" : cleaned;
}


export function RelayBalanceBadge({ active }: { active: RelayActive | null }) {
  const [open, setOpen] = useState(false);
  const [overview, setOverview] = useState<any>(null);
  const [err, setErr] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  // 强信号指纹：provider / apiKey / mode / groupId / switchedAt 任一变化都代表切换了账户或计费方式。
  // 原实现只按 provider 名做 useMemo，同网关换账号时 provider 字符串不变 → 徽标永不刷新、余额/套餐卡死在旧账号。
  const fingerprint = `${active?.provider ?? ""}|${active?.apiKey ?? ""}|${active?.mode ?? ""}|${active?.groupId ?? ""}|${active?.switchedAt ?? 0}`;
  const refresh = useCallback(() => {
    if (!active) return;
    window.codex.relayOverview().then((data) => { setOverview(data); setErr(""); }).catch((e) => setErr(e.message ?? "加载失败"));
  }, [fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active) return;
    refresh();
    const timer = window.setInterval(refresh, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [refresh, active]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  if (!active) return null;
  const subs: any[] = overview?.subscriptions ?? [];
  const current = subs.find((s) => s.group_id === active.groupId);
  let label = "中转站";
  if (active.mode === "balance") {
    label = overview ? `余额 $${Number(overview.balance).toFixed(2)}` : "余额 …";
  } else if (current) {
    const limit = current.monthly_limit_usd ?? current.daily_limit_usd ?? 0;
    const used = current.monthly_used_usd ?? current.daily_used_usd ?? 0;
    label = overview ? `${shortGroupName(current.group_name, 12)} 剩 $${Math.max(0, limit - used).toFixed(2)}` : "套餐 …";
  } else if (overview) {
    // 该分组没有生效订阅：用量按量从账户余额扣（如站方把 key 分组清掉、或选了非订阅分组的老 key）
    label = overview ? `余额 $${Number(overview.balance).toFixed(2)}` : "余额 …";
  }
  return <div className="relay-badge" ref={wrapRef}>
    <button type="button" className="context-ring relay-badge-btn" title="中转站余额" aria-label="中转站余额" onClick={() => { setOpen((v) => !v); if (!overview) refresh(); }}>
      <Wallet size={13} /><small>{err ? "余额同步失败" : label}</small>
    </button>
    {open && <div className="ctx-pop relay-pop" role="dialog" aria-label="中转站余额明细" onMouseLeave={() => setOpen(false)}>
      <div className="ctx-pop-head"><strong>{active.label || "中转站"}</strong></div>
      <div className="ctx-pop-sub">{overview?.email || ""}{err ? ` · ${err}` : ""}{active.apiKey ? ` · 密钥 …${active.apiKey.slice(-6)}` : ""}</div>
      <div className="ctx-pop-grid">
        <div className="ctx-pop-cell"><span className="ctx-pop-cell-label">账户余额</span><b className="ctx-pop-cell-value">{overview ? `$${Number(overview.balance).toFixed(2)}` : "…"}</b></div>
        {subs.map((s) => {
          const values = [
            s.monthly_limit_usd != null ? `月剩 $${Math.max(0, s.monthly_limit_usd - (s.monthly_used_usd ?? 0)).toFixed(2)}` : "",
            s.weekly_limit_usd != null ? `周剩 $${Math.max(0, s.weekly_limit_usd - (s.weekly_used_usd ?? 0)).toFixed(2)}` : "",
          ].filter(Boolean).join(" · ");
          return (
            <div className="ctx-pop-cell" key={s.id}>
              <span className="ctx-pop-cell-label" title={`${s.group_name ?? ""}${s.expires_at ? `（至 ${String(s.expires_at).slice(0, 10)}）` : ""}`}>{shortGroupName(s.group_name, 18)}{s.expires_at ? ` · ${String(s.expires_at).slice(5, 10)}` : ""}</span>
              <b className="ctx-pop-cell-value">{values || "生效中"}</b>
            </div>
          );
        })}
      </div>
      <p className="ctx-pop-cache-note">设置 → 账户 → 中转站 可切换账号、套餐或密钥。</p>
    </div>}
  </div>;
}

/** 模型设置页里的中转站精简入口：显示当前绑定状态，点击进独立中转站页。 */
export function RelayAccountEntryBanner({ active, onOpen }: { active: { label: string } | null; onOpen: () => void }) {
  return (
    <button type="button" className="relay-entry-banner" onClick={onOpen}>
      <Wallet size={14} />
      <span>{active ? <>中转站账户 · 当前使用 <b>{active.label}</b></> : "中转站账户 · 登录后同步余额与订阅套餐，一键接入"}</span>
      <ChevronRight size={14} />
    </button>
  );
}

/** 中转站中心页（设置 → 中转站）：余额总览 + 套餐卡片 + 登录/退出 + 一键切换计费方式。 */
export function RelayCenterPage({ busy, activeProvider, onActivate, onNotice, onOpenModelSettings, openAppConfirm }: { busy: boolean; activeProvider?: string; onActivate: (mode: "balance" | "plan", group?: { group_id: number; group_name: string }, explicitKey?: { id: any; name: any; key: string; group_id: number | null }) => Promise<void> | void; onNotice: (m: string) => void; onOpenModelSettings: () => void; openAppConfirm: (title: string, text: string, confirmLabel?: string) => Promise<boolean> }) {
  const [account, setAccount] = useState<{ id?: string; baseUrl: string; email: string } | null>(null);
  const [draft, setDraft] = useState({ baseUrl: "https://api.pptoken.cc", email: "", password: "" });
  const [overview, setOverview] = useState<any>(null);
  const [err, setErr] = useState("");
  const [working, setWorking] = useState("");
  const active = readRelayActive();
  const isActiveProvider = Boolean(active && activeProvider === active.provider);
  const [refreshing, setRefreshing] = useState(false);
  /** 读余额/套餐/密钥：`accountId` 指定「面板正在看的那个账号」。
   *  ⛔ 09-21：管理面板从前一律读**当前生效账号**，于是「点卡片看某个账号」要么显示别人的数据、
   *     要么靠 openManage 偷偷切换生效账号来对齐 —— 两个都不对。现在按 id 读，切换只由用户显式触发。 */
  const load = useCallback(async (silent = true, accountId?: string) => {
    if (!silent) setRefreshing(true);
    try {
      if (accountId) {
        try {
          setOverview(await window.codex.relayOverview(accountId));
          setErr("");
        } catch (e: any) {
          setErr(e.message ?? "刷新失败");
        }
        return;
      }
      const acc = await window.codex.relayLoadAccount();
      if (acc?.loggedIn) {
        setAccount({ baseUrl: acc.baseUrl, email: acc.email });
        try {
          setOverview(await window.codex.relayOverview());
          setErr("");
          if (!silent) onNotice("已刷新余额与套餐");
        } catch (e: any) {
          // 保留旧数据不闪空，错误显示在页面
          setErr(e.message ?? "刷新失败");
        }
      } else if (acc) setDraft((d) => ({ ...d, baseUrl: acc.baseUrl, email: acc.email }));
    } catch { /* 未登录过 */ } finally { if (!silent) setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // 账户列表（多账号管理）
  const [accounts, setAccounts] = useState<any[]>([]);
  const [manageOpen, setManageOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const reloadAccounts = useCallback(async () => {
    try { setAccounts(await window.codex.relayAccounts()); } catch { setAccounts([]); }
  }, []);
  useEffect(() => { void reloadAccounts(); }, [reloadAccounts]);
  /** 面板里「当前展示的账号」是否就是生效账号（生效 = active 且未停用，与数据层同一判据）。
   *  套餐/密钥的「使用」是**激活动作**，只能对生效账号做 —— 非生效账号先点卡片上的「设为当前」。 */
  const isLiveRow = (id?: string) => {
    const row = accounts.find((x: any) => x.id === id);
    return Boolean(row && row.active && !row.disabled);
  };
  // 登录/切换账号后自动配置模型：已选中 key 优先 → 第一个套餐 → 余额（参数同步内置规格表在 onActivate 链路内）
  const autoConfigure = async () => {
    const ov = await window.codex.relayOverview().catch(() => null);
    setOverview(ov);
    // 简单规则：有生效订阅 → 用第一个订阅套餐；没有 → 走余额计费。
    // 匹配不到可复用的 key 时激活链路会自动新建（Harness-套餐名/Harness-余额），站点强制绑分组时自动改绑重试。
    const subs: any[] = ov?.subscriptions ?? [];
    try {
      if (subs.length) {
        await onActivate("plan", { group_id: Number(subs[0].group_id), group_name: String(subs[0].group_name ?? "套餐") });
      } else {
        await onActivate("balance");
      }
      setOverview(await window.codex.relayOverview().catch(() => ov));
    } catch (e: any) {
      setErr("模型自动配置失败：" + (e.message ?? e) + "。可在下方密钥列表手动选择一把 key 重试。");
    }
  };
  const login = async () => {
    setWorking("login"); setErr("");
    try {
      await window.codex.relayLogin({ baseUrl: draft.baseUrl, email: draft.email, password: draft.password });
      setDraft((d) => ({ ...d, password: "" }));
      const acc = await window.codex.relayLoadAccount();
      if (acc?.loggedIn) {
        setAccount({ baseUrl: acc.baseUrl, email: acc.email });
        onNotice("中转站登录成功，正在自动配置模型…");
        setLoginModalOpen(false);
        void reloadAccounts();
        await autoConfigure();
      }
    } catch (e: any) { setErr(e.message ?? "登录失败"); } finally { setWorking(""); }
  };
  const switchAccount = async (id: string) => {
    setWorking(`acc${id}`); setErr("");
    try {
      const r = await window.codex.relaySwitchAccount(id);
      const acc = await window.codex.relayLoadAccount();
      if (acc?.loggedIn) setAccount({ baseUrl: acc.baseUrl, email: acc.email });
      onNotice(`已切换账号：${r.email}`);
      await reloadAccounts();
      await autoConfigure();
    } catch (e: any) { setErr("切换账号失败：" + (e.message ?? e)); } finally { setWorking(""); }
  };
  // 删除账号：**必须二次确认**（09-21 用户要求「删除功能要看得见、且别一点就没了」）。
  // 确认文案把「会失去什么 / 不会影响什么」写清楚：本机凭据与密钥选择会清掉，站方数据不动。
  const removeAccount = async (target: { id: string; email?: string; active?: boolean }) => {
    const label = target.email || target.id;
    const ok = await openAppConfirm(
      "删除中转站账号",
      `确认从本机删除「${label}」？\n\n· 本机保存的登录凭据与密钥选择记录会被清除，需重新登录才能再用\n· 中转站站方的余额、订阅套餐、密钥不受影响\n${target.active ? "· 它是当前生效账号：对应模型供应商会被停用，引擎会重启一次\n" : ""}`,
      "删除"
    );
    if (!ok) return;
    setWorking(`acc${target.id}`); setErr("");
    try {
      const r = await window.codex.relayRemoveAccount(target.id);
      onNotice("账号已删除");
      if (account?.id === target.id) setManageOpen(false);
      await reloadAccounts();
      // ⛔ 只有「删的正好是生效账号」才碰模型配置：删一个无关账号却触发 autoConfigure，
      //    会重写模型配置 + 重启引擎 —— 与用户意图完全不相干（原先只要 activeId 非空就会走）。
      if (!r.deactivated) return;
      if (r.activeId) {
        const acc = await window.codex.relayLoadAccount();
        if (acc?.loggedIn) {
          setAccount({ baseUrl: acc.baseUrl, email: acc.email });
          await autoConfigure();
          return;
        }
      }
      setAccount(null); setOverview(null);
      writeRelayActive(null);
      await reloadAccounts();
    } catch (e: any) { setErr("删除账号失败：" + (e.message ?? e)); } finally { setWorking(""); }
  };
  // 账号启用/停用：停用 = 退出切换候选（数据保留）；停用使用中的账号会同步禁用其供应商并退出生效。
  // 重新启用时若当前没有任何生效账号（停用当前会清掉生效模型配置），自动恢复该账号为生效——
  // 否则用户「停用→启用」一圈回来还得重新走模型配置（09-09 反馈：隔夜模型配置没了又让我配置）
  const toggleAccount = async (id: string, enabled: boolean) => {
    setWorking(`tg${id}`); setErr("");
    try {
      const r = await window.codex.relayToggleAccount({ id, disabled: !enabled });
      await reloadAccounts();
      if ((r as any).deactivated) {
        writeRelayActive(null);
        setAccount(null); setOverview(null);
        onNotice("账号已停用，对应供应商已禁用并退出当前生效（重新打开开关后可重新设为当前）");
        return;
      }
      const list = enabled ? await window.codex.relayAccounts().catch(() => []) : [];
      if (enabled) {
        // 全局互斥：启用 A 时自动停用其他已启用的账号（开关即生效候选，一次只能开一个）
        for (const other of list) {
          if (other.id !== id && !other.disabled) {
            await window.codex.relayToggleAccount({ id: other.id, disabled: true }).catch(() => undefined);
          }
        }
        if (list.some((a: any) => a.active)) {
          // 已有生效账号（就是本账号）：直接完成
          onNotice("账号已启用，当前生效");
          return;
        }
        // 没有生效账号：自动把刚启用的账号设为当前（切换 + 自动重配模型 + 引擎重启）
        const target = list.find((a: any) => a.id === id);
        if (target?.loggedIn) {
          onNotice("账号已启用，正在自动设为当前生效…");
          await window.codex.relaySwitchAccount(id);
          const acc = await window.codex.relayLoadAccount();
          if (acc?.loggedIn) setAccount({ baseUrl: acc.baseUrl, email: acc.email });
          await reloadAccounts();
          await autoConfigure();
          onNotice("账号已启用并设为当前生效，模型已自动重配");
          return;
        }
      }
      onNotice(enabled ? "账号已启用，可设为当前生效" : "账号已停用，不再出现在切换候选中");
    } catch (e: any) {
      setErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+':\s*/i, ""));
      await reloadAccounts();
    } finally { setWorking(""); }
  };
  // 点账号卡片/「管理」：**只打开管理面板，不切账号**。
  // ⛔ 09-21 用户实测反馈「点击管理直接生效了」：原实现在这里 `if (!a.active) switchAccount(...)`，
  //    于是「想看一眼余额」会顺手把生效账号换掉、重写模型配置、重启引擎 —— 看信息不该有副作用。
  //    真正要切换有明显的入口：卡片上的「设为当前」/「启用订阅」。
  const openManage = async (a: any) => {
    setAccount({ id: a.id, baseUrl: a.baseUrl, email: a.email });
    setManageOpen(true);
    await load(false, a.id);
    void loadKeyGroups();
  };
  // ⛔ 原「退出登录」（relayLogout，按 activeId 删账号）已删：它删的是当前生效账号，而弹窗是给
  //    **某一个**账号开的 ⇒ 可能看着 A 的面板删掉 B，而且是「删除」的第二条隐藏入口。
  //    删除统一走 removeAccount(id)（无歧义 + 二次确认）；停用/启用走卡片开关。
  const switchTarget = async (mode: "balance" | "plan", group?: { group_id: number; group_name: string }, explicitKey?: { id: any; name: any; key: string; group_id: number | null }) => {
    setWorking(mode + (group?.group_id ?? "") + (explicitKey ? `key${explicitKey.id}` : "")); setErr("");
    try {
      await onActivate(mode, group, explicitKey);
    } catch (e: any) {
      setErr("切换失败：" + (e.message ?? e)); // 常驻显示在页面，不再只靠几秒的 toast
    } finally { setWorking(""); }
    setOverview(await window.codex.relayOverview().catch(() => null));
  };
  const subs: any[] = overview?.subscriptions ?? [];
  const progress = (used: number, limit: number) => Math.min(100, Math.max(2, limit > 0 ? (used / limit) * 100 : 4));
  // 密钥管理区状态
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [newKey, setNewKey] = useState({ name: "", groupId: "" });
  const [creatingKey, setCreatingKey] = useState(false);
  // 全部账号的密钥（按账户分组，支持折叠）
  const [keyGroups, setKeyGroups] = useState<any[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [keysCollapsed, setKeysCollapsed] = useState(false); // 弹窗内密钥区折叠
  const loadKeyGroups = useCallback(async () => {
    try {
      const groups = await window.codex.relayKeysAll();
      setKeyGroups(groups);
      setCollapsedGroups((prev) => {
        const next: Record<string, boolean> = {};
        for (const g of groups) next[g.id] = prev[g.id] ?? !g.active; // 默认只展开当前账号
        return next;
      });
    } catch { setKeyGroups([]); }
  }, []);
  useEffect(() => { void loadKeyGroups(); }, [loadKeyGroups]);
  // ── 付费订阅：应用内注册 → 套餐市场 → 站内付款 → 自动建 key 生效（正向联动）──
  // 反向联动不需要额外代码：置顶卡是派生态（relay-active + selectedGroupId + summary），
  // 手动切套餐/切 key/切账号都会在 60s 静默刷新或下一次 overview 拉取时自动跟上。
  const AFF_CODE = "X82JSNVC3W3S"; // 中转站邀请返利码（注册请求 aff_code 字段）
  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  const [regDraft, setRegDraft] = useState({ email: "", password: "", confirm: "" });
  const [plansOpen, setPlansOpen] = useState(false);
  const [plans, setPlans] = useState<any[] | null>(null);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansErr, setPlansErr] = useState("");
  const [watching, setWatching] = useState(false);
  const watchRef = useRef<{ timer: number | null; baseline: Set<string>; startedAt: number } | null>(null);
  const subChangeKey = (s: any) => `${Number(s.group_id)}|${String(s.expires_at ?? "")}`;
  const stopWatch = useCallback(() => {
    if (watchRef.current?.timer != null) window.clearInterval(watchRef.current.timer);
    watchRef.current = null;
    setWatching(false);
  }, []);
  useEffect(() => () => stopWatch(), [stopWatch]);
  // 页面打开期间 60s 静默刷新：别处手动切套餐/账号（反向联动）置顶卡自动跟上
  useEffect(() => {
    const timer = window.setInterval(() => { void load(); void loadKeyGroups(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load, loadKeyGroups]);
  // 支付核验：轮询 subscriptions/summary，出现「新 group 或到期时间变化」即视为付款完成
  const verifyPayment = async (silent = false) => {
    const cur = watchRef.current;
    if (!cur) return;
    if (Date.now() - cur.startedAt > 600_000) { stopWatch(); return; } // 10 分钟窗口后停自动轮询
    const ov = await window.codex.relayOverview().catch(() => null);
    if (!ov) return;
    setOverview(ov);
    const fresh: any[] = (ov.subscriptions ?? []).filter((s: any) => !cur.baseline.has(subChangeKey(s)));
    if (!fresh.length) {
      if (!silent) onNotice("暂未检测到新订阅：付款到账通常几秒内，稍候自动重查，也可稍后再点「我已完成支付」。");
      return;
    }
    if (cur.timer != null) window.clearInterval(cur.timer);
    watchRef.current = null;
    setWatching(false);
    const target = [...fresh].sort((a, b) => String(b.expires_at ?? "").localeCompare(String(a.expires_at ?? "")))[0];
    onNotice(`检测到新订阅「${shortGroupName(String(target.group_name ?? "套餐"), 16)}」，正在生成密钥并生效…`);
    try {
      await onActivate("plan", { group_id: Number(target.group_id), group_name: String(target.group_name ?? "套餐") });
      setOverview(await window.codex.relayOverview().catch(() => ov));
      onNotice("订阅已生效，模型已切换，可以直接发消息了");
    } catch (e: any) {
      setErr("订阅自动生效失败：" + (e.message ?? e) + "。可在管理面板套餐卡上点「使用此套餐」重试。");
    }
  };
  const startWatch = () => {
    const baseline = new Set(subs.map(subChangeKey));
    if (watchRef.current?.timer != null) window.clearInterval(watchRef.current.timer);
    watchRef.current = { timer: null, baseline, startedAt: Date.now() };
    setWatching(true);
    const timer = window.setInterval(() => void verifyPayment(true), 20_000);
    if (watchRef.current) watchRef.current.timer = timer;
  };
  const openPurchase = async () => {
    setErr("");
    try {
      await window.codex.relayOpenPurchase();
      setPlansOpen(false);
      startWatch();
      onNotice("已打开支付页（已自动登录站内），付款完成后这里会自动生效");
    } catch (e: any) {
      setErr("打开支付页失败：" + (e.message ?? e) + "。可到站点官网手动购买，完成后点「我已完成支付」。");
    }
  };
  const openPlans = async () => {
    setPlansOpen(true);
    setPlansErr("");
    setPlansLoading(true);
    try {
      setPlans(await window.codex.relayPaymentPlans());
    } catch (e: any) {
      setPlans(null);
      setPlansErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+':\s*/i, ""));
    } finally { setPlansLoading(false); }
  };
  const register = async () => {
    if (regDraft.password !== regDraft.confirm) { setErr("两次输入的密码不一致"); return; }
    setWorking("register"); setErr("");
    const baseUrl = draft.baseUrl || "https://api.pptoken.cc";
    try {
      await window.codex.relayRegister({ baseUrl, email: regDraft.email, password: regDraft.password, affCode: AFF_CODE });
      setRegDraft({ email: "", password: "", confirm: "" });
      onNotice("注册成功，已自动登录");
      void reloadAccounts();
      await load(false);
      setLoginModalOpen(false);
      await autoConfigure();
      void openPlans();
    } catch (e: any) {
      const msg = String(e?.message ?? e).replace(/^Error invoking remote method '[^']+':\s*/i, "");
      if (/captcha|turnstile|verify_code|验证码|邮箱验证/i.test(msg)) {
        // 站点开了验证码/邮箱验证（sub2api 可选配置）：降级为外部注册页，注册完回应用里登录
        setErr("该站点注册需要验证码/邮箱验证，已打开外部注册页；注册完成后回到这里登录即可。");
        void window.codex.openExternal(`${baseUrl}/register?aff=${AFF_CODE}`).catch(() => undefined);
      } else setErr(msg);
    } finally { setWorking(""); }
  };
  const groupNameOf = (gid: any) => {
    if (gid == null) return "无分组";
    const sub = (overview?.subscriptions ?? []).find((s: any) => Number(s.group_id) === Number(gid));
    if (sub) return String(sub.group_name ?? `分组 ${gid}`);
    const g = (overview?.groups ?? []).find((x: any) => Number(x.group_id ?? x.id) === Number(gid));
    return String(g?.group_name ?? g?.name ?? `分组 ${gid}`);
  };
  const createKey = async () => {
    setCreatingKey(true); setErr("");
    try {
      // accountId：密钥建在**面板正在看的账号**上（原先只能建在当前生效账号上）
      await window.codex.relayCreateKey({ name: newKey.name.trim(), groupId: newKey.groupId ? Number(newKey.groupId) : null, accountId: account?.id });
      setNewKey({ name: "", groupId: "" }); setShowKeyForm(false);
      setOverview(await window.codex.relayOverview(account?.id).catch(() => null));
      void loadKeyGroups();
      onNotice("密钥已创建");
    } catch (e: any) { setErr("创建密钥失败：" + (e.message ?? e)); } finally { setCreatingKey(false); }
  };
  const useKeyFromGroup = async (group: any, k: any) => {
    // 非当前账号的 key：先切到该账号再激活（激活链路会用该账号网关+这把 key）
    try {
      if (!group.active) await window.codex.relaySwitchAccount(group.id);
      await switchTarget(k.group_id != null ? "plan" : "balance", k.group_id != null ? { group_id: Number(k.group_id), group_name: shortGroupName(k.group_name ?? k.group_id, 16) } : undefined, { id: k.id, name: k.name, key: String(k.key ?? ""), group_id: k.group_id ?? null });
      void loadKeyGroups();
    } catch { /* switchTarget 已常驻报错 */ }
  };
  // 当前生效密钥：按已选 keyId / 计费方式与分组从密钥列表匹配（与 resolveRelayTarget 同规则）
  const [keyVisible, setKeyVisible] = useState(false);
  const currentKey = useMemo(() => {
    if (!overview) return null;
    const keys: any[] = overview.keys ?? [];
    if (overview.selectedKeyId != null) {
      const byId = keys.find((k) => k.id === overview.selectedKeyId);
      if (byId) return byId;
    }
    if (overview.selectedMode === "plan" && overview.selectedGroupId != null) return keys.find((k) => k.status === "active" && k.group_id === overview.selectedGroupId) ?? null;
    if (overview.selectedMode === "balance") return keys.find((k) => k.status === "active" && k.group_id == null) ?? null;
    return null;
  }, [overview]);
  const maskKey = (key: string) => key.length > 14 ? `${key.slice(0, 10)}••••••••${key.slice(-4)}` : key;
  return (
    <section className="settings-section stack relay-center">
      <div className="settings-copy channel-heading"><div><h2>中转站<PageInfo text={<>每个中转站账号一张卡片：点卡片进入该账号的管理面板（余额总览、订阅套餐、密钥管理），所有操作即时生效；聊天输入框旁会实时显示当前余量。</>} /></h2></div></div>
      {(() => {
        // 置顶付费订阅长条卡：展示当前生效订阅（正向：付款后自动更新；反向：手动切换自动跟上）
        const selected = account && overview?.selectedMode === "plan" && overview?.selectedGroupId != null
          ? subs.find((s: any) => Number(s.group_id) === Number(overview?.selectedGroupId)) ?? null
          : null;
        const current = selected ?? (subs.length ? [...subs].sort((a: any, b: any) => String(b.expires_at ?? "").localeCompare(String(a.expires_at ?? "")))[0] : null);
        const limit = current ? Number(current.monthly_limit_usd ?? current.weekly_limit_usd ?? current.daily_limit_usd ?? 0) : 0;
        const used = current ? Number(current.monthly_used_usd ?? current.weekly_used_usd ?? current.daily_used_usd ?? 0) : 0;
        const daysLeft = current?.expires_at ? Math.ceil((new Date(String(current.expires_at)).getTime() - Date.now()) / 86400_000) : null;
        const expired = daysLeft != null && daysLeft <= 0;
        const expiring = !expired && daysLeft != null && daysLeft <= 3;
        const state = !account ? "guest" : expired ? "expired" : expiring ? "expiring" : current ? "active" : "empty";
        const site = account ? String(account.baseUrl || "").replace(/^https?:\/\//, "") : "";
        return (
          <div className={`relay-sub-banner${watching ? " watching" : ""}`} data-state={state}>
            <div className="relay-sub-banner-icon">
              {state === "guest" ? <Wallet size={19} /> : expired ? <AlertTriangle size={19} /> : expiring ? <Clock3 size={19} /> : <Sparkles size={19} />}
            </div>
            <div className="relay-sub-banner-main">
              {watching ? (
                <>
                  <strong>等待支付结果…</strong>
                  <p>已打开中转站支付页（站内已自动登录）。付款到账后这里会自动创建套餐密钥并生效，无需任何手动操作。</p>
                </>
              ) : state === "guest" ? (
                <>
                  <strong>付费订阅 · 开通即用</strong>
                  <p>登录或注册中转站账号后，可在此选购订阅套餐：付款完成自动生成套餐密钥、自动切换模型供应商，对话直接可用。</p>
                </>
              ) : expired ? (
                <>
                  <strong>订阅已到期</strong>
                  <p>套餐「{shortGroupName(String(current?.group_name ?? ""), 20)}」已于 {current?.expires_at ? String(current.expires_at).slice(0, 10) : "—"} 到期，重新订阅后自动恢复生效。</p>
                </>
              ) : expiring ? (
                <>
                  <strong>订阅即将到期（剩 {daysLeft} 天）</strong>
                  <p>套餐「{shortGroupName(String(current?.group_name ?? ""), 20)}」将于 {current?.expires_at ? String(current.expires_at).slice(0, 10) : "—"} 到期，提前续费可保持额度与时长不中断。</p>
                </>
              ) : current ? (
                <>
                  <strong>
                    {selected ? <span className="relay-plan-live"><Check size={11} />当前生效</span> : null}
                    {shortGroupName(String(current.group_name ?? "订阅套餐"), 22)}
                    {site && <small className="relay-sub-banner-site">{site}</small>}
                  </strong>
                  <div className="relay-sub-banner-meta">
                    <div className="relay-sub-progress"><i style={{ width: `${progress(used, limit)}%` }} /></div>
                    <span>{limit ? `月额度已用 $${used.toFixed(2)} / $${limit.toFixed(2)}` : "额度按量计费"}</span>
                    <span className="relay-sub-banner-due">{daysLeft != null ? `${daysLeft} 天后到期` : "生效中"}</span>
                  </div>
                </>
              ) : (
                <>
                  <strong>暂无生效中的订阅套餐</strong>
                  <p>当前计费走账户余额（${Number(overview?.balance ?? 0).toFixed(2)}）。选购订阅套餐可享专属分组额度与倍率。</p>
                </>
              )}
            </div>
            <div className="relay-sub-banner-actions">
              {watching ? (
                <>
                  <button className="primary-setting" onClick={() => void verifyPayment(false)}><CircleCheck size={14} />我已完成支付</button>
                  <button className="secondary-setting" onClick={() => { stopWatch(); onNotice("已停止自动检测；付款到账后可在套餐卡上点「使用此套餐」。"); }}>停止等待</button>
                </>
              ) : state === "guest" ? (
                <>
                  <button className="primary-setting" onClick={() => { setAuthTab("login"); setLoginModalOpen(true); }}><LogIn size={14} />登录 / 注册</button>
                </>
              ) : state === "expired" ? (
                <>
                  <button className="primary-setting" onClick={() => void openPlans()}><Sparkles size={14} />重新订阅</button>
                  <button className="secondary-setting" onClick={() => void load(false)} disabled={refreshing}>{refreshing ? <Spinner /> : <RefreshCw size={13} />}刷新状态</button>
                </>
              ) : (
                <>
                  <button className="primary-setting" onClick={() => void openPlans()}><ArrowUpRight size={14} />{current ? (expired ? "重新订阅" : "升级 / 续费") : "选购套餐"}</button>
                  {current && !selected && (
                    <button className="secondary-setting" disabled={busy || working !== ""} onClick={() => void switchTarget("plan", { group_id: Number(current.group_id), group_name: String(current.group_name ?? "套餐") })}>{working === `plan${current.group_id}` ? <Spinner /> : <Zap size={13} />}一键生效</button>
                  )}
                  <button className="secondary-setting" onClick={() => void openManage(accounts.find((a: any) => a.active) ?? accounts[0])} disabled={!accounts.length}><Settings2 size={13} />管理</button>
                </>
              )}
            </div>
          </div>
        );
      })()}
      {err && <p className="relay-account-err"><AlertTriangle size={13} />{err}</p>}
      <div className="relay-plan-grid relay-home-grid">
        {accounts.map((a) => {
          const group = keyGroups.find((g) => g.id === a.id);
          const keyCount = group ? (group.keys ?? []).length : null;
          // ⛔ 「使用中 / 当前生效」必须**同时**满足「库里的 active」与「未停用」（09-21 真机事故：
          //    库内 activeId 残留指向一个 disabled 账号 ⇒ 卡片同屏显示「使用中 + 已停用 + 当前生效」）。
          //    数据层已自愈，这里再判一次 —— 界面与库两处同源，谁都不会单独说谎。
          const live = Boolean(a.active) && !a.disabled;
          return (
            <div className={`relay-plan-card relay-account-card ${live ? "selected" : ""}${a.disabled ? " acct-disabled" : ""}`} key={a.id} onClick={() => void openManage(a)} title="点卡片进入管理面板">
              <div className="relay-plan-card-head">
                <span className="relay-key-status" data-status={a.loggedIn && !group?.error ? "on" : "off"} />
                <strong title={a.email}>{a.email}</strong>
                {live && <span className="relay-plan-live"><Check size={11} />使用中</span>}
                {a.disabled && <span className="acct-disabled-badge">已停用</span>}
                <label className="bot-switch acct-switch" title={a.disabled ? (activeProvider && !a.active ? `已有供应商生效（一次只能启用一个），先停用再启用这个账号` : "已停用，点击启用") : "启用中，点击停用"} onClick={(event) => event.stopPropagation()}>
                  <input type="checkbox" checked={!a.disabled} disabled={working === `tg${a.id}` || (a.disabled && Boolean(activeProvider) && !a.active)} onChange={(event) => void toggleAccount(a.id, event.target.checked)} /><span />
                </label>
              </div>
              <p>{String(a.baseUrl || "").replace(/^https?:\/\//, "")}</p>
              <p>{keyCount == null ? "密钥未读取" : `${keyCount} 把密钥`}{a.selectedKeyName ? ` · 当前 ${a.selectedKeyName}` : ""}</p>
              <div className="relay-plan-card-foot">
                {live
                  ? <span className="relay-plan-live"><Check size={11} />当前生效</span>
                  : <button className="secondary-setting" disabled={working !== "" || a.disabled || (Boolean(activeProvider) && !isActiveProvider)} title={activeProvider && !isActiveProvider ? `已有供应商生效，请先停用再设为当前` : (a.disabled ? "已停用的账号不能设为当前，请先在卡片上启用" : undefined)} onClick={(event) => { event.stopPropagation(); void switchAccount(a.id); }}>{working === `acc${a.id}` ? <Spinner /> : <Play size={13} />}设为当前</button>}
                <button className="secondary-setting" onClick={(event) => { event.stopPropagation(); void openManage(a); }}><Settings2 size={13} />管理</button>
                <button className="secondary-setting relay-account-remove" title={`删除账号「${a.email}」（会二次确认）`} disabled={working !== ""} onClick={(event) => { event.stopPropagation(); void removeAccount(a); }}><Trash2 size={13} />删除</button>
              </div>
            </div>
          );
        })}
        <button className="relay-plan-card relay-add-card" onClick={() => setLoginModalOpen(true)}>
          <Plus size={18} />
          <strong>添加中转站账号</strong>
          <small>支持任意 sub2api 网关，登录后余额与套餐一键接入</small>
        </button>
      </div>
      <p className="relay-center-foot">{isActiveProvider ? <>当前生效供应商「{active!.label}」，输入框旁的余额徽标实时同步；点上方卡片进入各账号的管理面板。</> : <>尚无生效供应商：点账号卡片进入管理面板，选套餐或密钥即可自动生成并切换。</>}</p>
      {manageOpen && account && (
        <div className="relay-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setManageOpen(false); }}>
          <div className="relay-manage-modal">
            <div className="relay-keys-head">
              <strong className="relay-modal-title"><Wallet size={15} />{account.email}</strong>
              <small>{account.baseUrl}</small>
              <button className="icon-button relay-modal-close" title="关闭" onClick={() => setManageOpen(false)}><X size={15} /></button>
            </div>
            <div className="relay-hero">
              <div className="relay-hero-main">
                <small>账户余额（USD）</small>
                <strong>{overview ? `$${Number(overview.balance).toFixed(2)}` : "…"}</strong>
                <span>{overview?.email || account.email} · {account.baseUrl}</span>
                {currentKey && (
                  <span className="relay-hero-key">
                    <em>当前密钥{currentKey.name ? `（${currentKey.name}）` : ""}</em>
                    <code>{keyVisible ? currentKey.key : maskKey(currentKey.key)}</code>
                    <button type="button" className="icon-button" title={keyVisible ? "隐藏密钥" : "显示密钥"} onClick={() => setKeyVisible((v) => !v)}>{keyVisible ? <EyeOff size={12} /> : <Eye size={12} />}</button>
                    <button type="button" className="icon-button" title="复制密钥" onClick={async () => { try { await copyTextToClipboard(currentKey.key); onNotice("当前密钥已复制"); } catch { onNotice("复制失败，请手动选择复制"); } }}><Copy size={12} /></button>
                  </span>
                )}
              </div>
              <div className="relay-hero-actions">
                <button className="icon-button" title="刷新余额与套餐" disabled={refreshing} onClick={() => void load(false, account?.id)}>{refreshing ? <Spinner /> : <RefreshCw size={14} />}</button>
                <button className="secondary-setting" onClick={() => onOpenModelSettings()}><Bot size={13} />模型配置</button>
                {/* 删除作用于**本面板这个账号**（不再是按 activeId 删当前账号，见 openManage 上方说明）。
                    面板里的 account 只有 baseUrl/email（relayLoadAccount 的结构），id 从账号列表按 email 反查。 */}
                <button
                  className="secondary-setting relay-account-remove"
                  title={`删除账号「${account.email}」（会二次确认）`}
                  disabled={working !== "" || !accounts.some((x: any) => x.email === account.email)}
                  onClick={() => { const row = accounts.find((x: any) => x.email === account.email); if (row) void removeAccount(row); }}
                ><Trash2 size={13} />删除账号</button>
              </div>
            </div>
            {overview?.selectedMode && !isActiveProvider && <p className="relay-account-err"><AlertTriangle size={13} />上次切换没有完成（供应商未生成）：点下方套餐卡或密钥的「使用」重新激活即可。</p>}
            {account.id && !isLiveRow(account.id) && <p className="relay-account-err"><AlertTriangle size={13} />本面板看的是「{account.email}」，它不是当前生效账号 —— 余额与密钥都能看，但要选套餐/密钥请先回卡片点「设为当前」。</p>}
            <div className="relay-plan-grid">
              {subs.map((s) => {
                const limit = s.monthly_limit_usd ?? s.daily_limit_usd ?? 0;
                const used = s.monthly_used_usd ?? s.daily_used_usd ?? 0;
                const isSelected = isActiveProvider && overview?.selectedMode === "plan" && overview?.selectedGroupId === s.group_id;
                return (
                  <div className={`relay-plan-card ${isSelected ? "selected" : ""}`} key={s.id}>
                    <div className="relay-plan-card-head"><FolderTree size={15} /><strong title={s.group_name}>{shortGroupName(s.group_name, 16)}</strong>{isSelected && <span className="relay-plan-live"><Check size={11} />使用中</span>}</div>
                    <div className="relay-plan-progress"><i style={{ width: `${progress(Number(used), Number(limit))}%` }} /></div>
                    <p>已用 ${Number(used).toFixed(2)}{limit ? ` / 月上限 $${Number(limit).toFixed(2)}` : ""}{s.expires_at ? ` · 到期 ${String(s.expires_at).slice(0, 10)}` : ""}</p>
                    <div className="relay-plan-card-foot">
                      <small>{limit ? `剩余 $${Math.max(0, Number(limit) - Number(used)).toFixed(2)}` : "生效中"}</small>
                      <button className="secondary-setting" disabled={busy || working !== "" || !isLiveRow(account.id)} title={isLiveRow(account.id) ? undefined : "该账号不是当前生效账号：先回卡片点「设为当前」"} onClick={() => void switchTarget("plan", { group_id: Number(s.group_id), group_name: String(s.group_name ?? "套餐") })}>{working === `plan${s.group_id}` ? <Spinner /> : isSelected ? <Check size={13} /> : <Play size={13} />}使用此套餐</button>
                    </div>
                  </div>
                );
              })}
              {!subs.length && <div className="relay-plan-card"><div className="relay-plan-card-head"><FolderTree size={15} /><strong>暂无生效中的套餐</strong></div><p>可在中转站官网购买订阅套餐，购买后点「刷新」同步；或直接在下方「API 密钥」里选一把 key 使用（按量从余额扣）。</p></div>}
            </div>
            <div className="relay-keys-card">
              <div className="relay-keys-head">
                <button type="button" className="relay-keys-toggle" onClick={() => setKeysCollapsed((v) => !v)}>
                  {keysCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                  <strong>API 密钥</strong>
                  <small>本账号的密钥 · 选一把即生成供应商并切换</small>
                </button>
                <button className="secondary-setting" onClick={() => setShowKeyForm((v) => !v)}>{showKeyForm ? "收起" : <><Plus size={13} />新建密钥</>}</button>
              </div>
              {showKeyForm && (
                <div className="relay-key-form">
                  <input value={newKey.name} onChange={(event) => setNewKey({ ...newKey, name: event.target.value })} placeholder="密钥名称（如 Harness-主力）" />
                  <select value={newKey.groupId} onChange={(event) => setNewKey({ ...newKey, groupId: event.target.value })}>
                    <option value="">无分组（部分站点不支持）</option>
                    {(overview?.groups ?? []).map((g: any) => <option key={g.group_id ?? g.id} value={String(g.group_id ?? g.id)}>{g.group_name ?? g.name ?? `分组 ${g.group_id ?? g.id}`}</option>)}
                    {(overview?.subscriptions ?? []).filter((s: any) => !(overview?.groups ?? []).some((g: any) => Number(g.group_id ?? g.id) === Number(s.group_id))).map((s: any) => <option key={s.group_id} value={String(s.group_id)}>{s.group_name}（订阅分组）</option>)}
                  </select>
                  <button className="primary-setting" disabled={creatingKey || !newKey.name.trim()} onClick={() => void createKey()}>{creatingKey ? <Spinner /> : <Plus size={13} />}创建</button>
                </div>
              )}
              {!keysCollapsed && (
                <>
              {showKeyForm && (
                <div className="relay-key-form">
                  <input value={newKey.name} onChange={(event) => setNewKey({ ...newKey, name: event.target.value })} placeholder="密钥名称（如 Harness-主力）" />
                  <select value={newKey.groupId} onChange={(event) => setNewKey({ ...newKey, groupId: event.target.value })}>
                    <option value="">无分组（部分站点不支持）</option>
                    {(overview?.groups ?? []).map((g: any) => <option key={g.group_id ?? g.id} value={String(g.group_id ?? g.id)}>{g.group_name ?? g.name ?? `分组 ${g.group_id ?? g.id}`}</option>)}
                    {(overview?.subscriptions ?? []).filter((s: any) => !(overview?.groups ?? []).some((g: any) => Number(g.group_id ?? g.id) === Number(s.group_id))).map((s: any) => <option key={s.group_id} value={String(s.group_id)}>{s.group_name}（订阅分组）</option>)}
                  </select>
                  <button className="primary-setting" disabled={creatingKey || !newKey.name.trim()} onClick={() => void createKey()}>{creatingKey ? <Spinner /> : <Plus size={13} />}创建</button>
                </div>
              )}
              {(() => {
                // 按**面板正在看的账号**取密钥组（回落到生效账号组）—— 不再是恒取生效账号
                const group = keyGroups.find((g) => g.id === account.id) ?? keyGroups.find((g) => g.active) ?? keyGroups[0];
                if (!group) return <p className="relay-key-empty">暂无账号密钥。</p>;
                const rows = [...(group.keys ?? [])].reverse();
                return (
                  <div className="relay-key-list">
                    {group.error && <p className="relay-key-empty">读取失败：{group.error}</p>}
                    {rows.map((k: any) => {
                      const isCurrent = Boolean(active?.apiKey && k.key && String(k.key) === String(active.apiKey));
                      return (
                        <div className={`relay-key-row ${isCurrent ? "current" : ""}`} key={k.id}>
                          <span className="relay-key-status" data-status={k.status === "active" ? "on" : "off"} title={k.status} />
                          <span className="relay-key-name" title={k.name}>{k.name || `密钥 #${k.id}`}</span>
                          <code className="relay-key-tail">{String(k.key ?? "").slice(0, 6)}••••{String(k.key ?? "").slice(-4)}</code>
                          <small className="relay-key-group">{groupNameOf(k.group_id)}</small>
                          {isCurrent
                            ? <span className="relay-plan-live"><Check size={11} />使用中</span>
                            : <button className="secondary-setting" disabled={busy || working !== "" || !isLiveRow(account.id)} title={isLiveRow(account.id) ? undefined : "该账号不是当前生效账号：先回卡片点「设为当前」"} onClick={() => void useKeyFromGroup(group, k)}>{working === `key${k.id}` ? <Spinner /> : <Play size={13} />}使用</button>}
                        </div>
                      );
                    })}
                    {!rows.length && !group.error && <p className="relay-key-empty">该账号暂无密钥，点上方「新建密钥」创建。</p>}
                  </div>
                );
              })()}
                </>
              )}
            </div>
            <p className="relay-center-foot">{isActiveProvider ? <>当前供应商即中转站生成的「{active!.label}」，输入框旁的余额徽标实时同步。</> : <>点套餐卡的「使用此套餐」或密钥列表的「使用」，会自动生成供应商并切换，无需手动去模型设置新增。</>}</p>
          </div>
        </div>
      )}
      {loginModalOpen && (
        <div className="relay-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setLoginModalOpen(false); }}>
          <div className="relay-manage-modal relay-login-modal">
            <div className="relay-keys-head">
              <strong className="relay-modal-title"><Wallet size={15} />{authTab === "login" ? "登录中转站" : "注册中转站账号"}</strong>
              <small>{authTab === "login" ? "sub2api 站点账号密码，余额与套餐一键接入" : "注册后自动登录，直接进入套餐选购"}</small>
              <button className="icon-button relay-modal-close" title="关闭" onClick={() => setLoginModalOpen(false)}><X size={15} /></button>
            </div>
            <div className="relay-auth-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={authTab === "login"} className={authTab === "login" ? "on" : ""} onClick={() => { setAuthTab("login"); setErr(""); }}>已有账号，登录</button>
              <button type="button" role="tab" aria-selected={authTab === "register"} className={authTab === "register" ? "on" : ""} onClick={() => { setAuthTab("register"); setErr(""); }}>新用户，注册</button>
            </div>
            {authTab === "login" ? (
              <>
                <label className="se-field"><span>站点地址</span><input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.pptoken.cc" /></label>
                <label className="se-field"><span>邮箱</span><input value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="你在中转站的账号邮箱" /></label>
                <label className="se-field"><span>密码</span><input type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} placeholder="账号密码" onKeyDown={(event) => { if (event.key === "Enter" && draft.email && draft.password) void login(); }} /></label>
                <button className="primary-setting relay-login-btn" disabled={working === "login" || !draft.email || !draft.password} onClick={() => void login()}>{working === "login" ? <><Spinner />正在登录…</> : <><LogIn size={15} />登录并自动配置</>}</button>
              </>
            ) : (
              <>
                <label className="se-field"><span>站点地址</span><input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.pptoken.cc" /></label>
                <label className="se-field"><span>邮箱</span><input value={regDraft.email} onChange={(event) => setRegDraft({ ...regDraft, email: event.target.value })} placeholder="用于登录中转站的邮箱" autoComplete="email" /></label>
                <label className="se-field"><span>密码（至少 6 位）</span><input type="password" value={regDraft.password} onChange={(event) => setRegDraft({ ...regDraft, password: event.target.value })} placeholder="设置账号密码" autoComplete="new-password" /></label>
                <label className="se-field"><span>确认密码</span><input type="password" value={regDraft.confirm} onChange={(event) => setRegDraft({ ...regDraft, confirm: event.target.value })} placeholder="再输入一次" autoComplete="new-password" onKeyDown={(event) => { if (event.key === "Enter" && regDraft.email && regDraft.password) void register(); }} /></label>
                <button className="primary-setting relay-login-btn" disabled={working === "register" || !regDraft.email || !regDraft.password} onClick={() => void register()}>{working === "register" ? <><Spinner />正在注册…</> : <><Sparkles size={15} />注册并进入套餐选购</>}</button>
                <p className="relay-auth-note">注册成功后自动登录并打开套餐市场；邀请码 <code>{AFF_CODE}</code> 已自动携带。站点若要求验证码/邮箱验证，会自动打开站内注册页兜底。</p>
              </>
            )}
          </div>
        </div>
      )}
      {plansOpen && (
        <div className="relay-modal-backdrop relay-plans-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPlansOpen(false); }}>
          <div className="relay-plans-modal">
            <div className="relay-keys-head">
              <strong className="relay-modal-title"><Sparkles size={15} />订阅套餐</strong>
              <small>{account ? `${String(account.baseUrl || "").replace(/^https?:\/\//, "")} · 付款成功后自动生效` : "登录后可订阅"}</small>
              <button className="icon-button relay-modal-close" title="关闭" onClick={() => setPlansOpen(false)}><X size={15} /></button>
            </div>
            {plansLoading && <div className="relay-plans-loading"><Spinner />正在获取套餐目录…</div>}
            {!plansLoading && plansErr && <p className="relay-account-err"><AlertTriangle size={13} />{plansErr}</p>}
            {!plansLoading && !plansErr && (
              <div className="relay-plans-grid">
                {(plans ?? []).map((p: any) => {
                  const price = Number(p.price ?? 0);
                  const orig = p.original_price != null ? Number(p.original_price) : null;
                  const owned = subs.some((s: any) => Number(s.group_id) === Number(p.group_id));
                  const inUse = overview?.selectedMode === "plan" && Number(overview?.selectedGroupId) === Number(p.group_id);
                  const rate = Number(p.rate_multiplier ?? 1);
                  return (
                    <div className={`relay-plan-market-card${inUse ? " in-use" : ""}`} key={p.id}>
                      <div className="relay-plan-market-head">
                        <strong title={String(p.name ?? "套餐")}>{shortGroupName(String(p.name ?? "套餐"), 16)}</strong>
                        {inUse ? <span className="relay-plan-live"><Check size={11} />使用中</span> : owned ? <span className="relay-plan-owned">已拥有</span> : null}
                      </div>
                      <p className="relay-plan-market-group" title={String(p.group_name ?? "")}>{shortGroupName(String(p.group_name ?? ""), 26)}</p>
                      <div className="relay-plan-market-price">
                        <b>¥{price % 1 === 0 ? price.toFixed(0) : price.toFixed(2)}</b>
                        {orig != null && orig > price && <s>¥{orig % 1 === 0 ? orig.toFixed(0) : orig.toFixed(2)}</s>}
                      </div>
                      <p className="relay-plan-market-valid">
                        {p.validity_days != null ? `${p.validity_days} 天有效期` : "按站点规则"}
                        {rate !== 1 && <em className="relay-plan-rate">{rate.toFixed(2)}x 倍率</em>}
                      </p>
                      {p.description && <p className="relay-plan-market-desc" title={String(p.description)}>{shortGroupName(String(p.description), 30)}</p>}
                      {p.features && <details className="relay-plan-market-feats"><summary>套餐说明</summary><pre>{String(p.features)}</pre></details>}
                      <button className="primary-setting relay-plan-buy" disabled={plansLoading || working !== ""} onClick={() => void openPurchase()}>{owned ? "续费此套餐" : "立即订阅"}</button>
                    </div>
                  );
                })}
                {plans != null && !plans.length && <div className="relay-plans-loading">该站点暂无上架套餐。</div>}
              </div>
            )}
            <p className="relay-plans-foot">付款在中转站收银台完成（支付宝 / 微信等）。支付成功后本页自动检测并生效，无需重启应用；多次购买同套餐 = 时长累加。</p>
          </div>
        </div>
      )}
    </section>
  );
}
