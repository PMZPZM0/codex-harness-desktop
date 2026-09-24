/**
 * useRelayCenterPageState —— RelayCenterPage 的**状态与逻辑**（09-22 从 RelayCenterPage.tsx 提出，纯搬迁、零改写）。
 *
 * ⛔ 这些语句原本就是组件的体顶层语句 ⇒ 提成自定义 hook 后 hook 调用**顺序逐位不变**
 *    （同一渲染周期、同一顺序）。组件侧用**同名解构**接回来，所以 JSX 一字不改。
 */
import { resolveRelayTarget, writeRelayActive, readRelayActive, RelayActive } from "../../../lib/relay";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shortGroupName } from "../RelayCenterPage/01-balance-badge";

export function useRelayCenterPageState({ busy, activeProvider, onActivate, onNotice, onOpenModelSettings, openAppConfirm }: { busy: boolean; activeProvider?: string; onActivate: (mode: "balance" | "plan", group?: { group_id: number; group_name: string }, explicitKey?: { id: any; name: any; key: string; group_id: number | null }) => Promise<void> | void; onNotice: (m: string) => void; onOpenModelSettings: () => void; openAppConfirm: (title: string, text: string, confirmLabel?: string) => Promise<boolean> }) {
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

  return { busy, activeProvider, onActivate, onNotice, onOpenModelSettings, openAppConfirm, account, setAccount, draft, setDraft, overview, setOverview, err, setErr, working, setWorking, active, isActiveProvider, refreshing, setRefreshing, load, accounts, setAccounts, manageOpen, setManageOpen, loginModalOpen, setLoginModalOpen, reloadAccounts, isLiveRow, autoConfigure, login, switchAccount, removeAccount, toggleAccount, openManage, switchTarget, subs, progress, showKeyForm, setShowKeyForm, newKey, setNewKey, creatingKey, setCreatingKey, keyGroups, setKeyGroups, collapsedGroups, setCollapsedGroups, keysCollapsed, setKeysCollapsed, loadKeyGroups, AFF_CODE, authTab, setAuthTab, regDraft, setRegDraft, plansOpen, setPlansOpen, plans, setPlans, plansLoading, setPlansLoading, plansErr, setPlansErr, watching, setWatching, watchRef, subChangeKey, stopWatch, verifyPayment, startWatch, openPurchase, openPlans, register, groupNameOf, createKey, useKeyFromGroup, keyVisible, setKeyVisible, currentKey, maskKey };
}
