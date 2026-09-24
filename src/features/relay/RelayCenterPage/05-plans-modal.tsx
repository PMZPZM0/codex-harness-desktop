/**
 * RelayCenterPagePlansModal —— RelayCenterPage 的 JSX 第 5 段（09-22 从 RelayCenterPage.tsx 分出，纯搬迁）。
 * ⛔ props 类型由 TypeChecker 从**原作用域**推断（不是 any）⇒ 静态检查强度不降。
 */
import { AlertTriangle, ArrowUpRight, Bot, Check, ChevronDown, Clock3, Copy, Eye, EyeOff, FolderTree, Plus, Play, RefreshCw, Settings2, Sparkles, Trash2, X, Zap, CircleCheck, ChevronRight, Wallet, LogIn } from "lucide-react";
import { Spinner } from "../../../components/CardShell";
import { shortGroupName } from "../RelayCenterPage/01-balance-badge";

type Props = {
  account: { id?: string | undefined; baseUrl: string; email: string; } | null;
  openPurchase: () => Promise<void>;
  overview: any;
  plans: any[] | null;
  plansErr: string;
  plansLoading: boolean;
  plansOpen: boolean;
  setPlansOpen: React.Dispatch<React.SetStateAction<boolean>>;
  subs: any[];
  working: string;
};

export function RelayCenterPagePlansModal({ account, openPurchase, overview, plans, plansErr, plansLoading, plansOpen, setPlansOpen, subs, working }: Props) {
  return (
    plansOpen && (
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
          )
  );
}
