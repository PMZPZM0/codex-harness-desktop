/**
 * RelayCenterPageSubscriptionBanner —— RelayCenterPage 的 JSX 第 1 段（09-22 从 RelayCenterPage.tsx 分出，纯搬迁）。
 * ⛔ props 类型由 TypeChecker 从**原作用域**推断（不是 any）⇒ 静态检查强度不降。
 */
import { AlertTriangle, ArrowUpRight, Bot, Check, ChevronDown, Clock3, Copy, Eye, EyeOff, FolderTree, Plus, Play, RefreshCw, Settings2, Sparkles, Trash2, X, Zap, CircleCheck, ChevronRight, Wallet, LogIn } from "lucide-react";
import { Spinner } from "../../../components/CardShell";
import { shortGroupName } from "../RelayCenterPage/01-balance-badge";

type Props = {
  account: { id?: string | undefined; baseUrl: string; email: string; } | null;
  accounts: any[];
  busy: boolean;
  load: (silent?: boolean, accountId?: string | undefined) => Promise<void>;
  onNotice: (m: string) => void;
  openManage: (a: any) => Promise<void>;
  openPlans: () => Promise<void>;
  overview: any;
  progress: (used: number, limit: number) => number;
  refreshing: boolean;
  setAuthTab: React.Dispatch<React.SetStateAction<"login" | "register">>;
  setLoginModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  stopWatch: () => void;
  subs: any[];
  switchTarget: (mode: "balance" | "plan", group?: { group_id: number; group_name: string; } | undefined, explicitKey?: { id: any; name: any; key: string; group_id: number | null; } | undefined) => Promise<void>;
  verifyPayment: (silent?: boolean) => Promise<void>;
  watching: boolean;
  working: string;
};

export function RelayCenterPageSubscriptionBanner({ account, accounts, busy, load, onNotice, openManage, openPlans, overview, progress, refreshing, setAuthTab, setLoginModalOpen, stopWatch, subs, switchTarget, verifyPayment, watching, working }: Props) {
  return (
    (() => {
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
          })()
  );
}
