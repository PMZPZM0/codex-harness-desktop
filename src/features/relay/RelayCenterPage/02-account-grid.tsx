/**
 * RelayCenterPageAccountGrid —— RelayCenterPage 的 JSX 第 2 段（09-22 从 RelayCenterPage.tsx 分出，纯搬迁）。
 * ⛔ props 类型由 TypeChecker 从**原作用域**推断（不是 any）⇒ 静态检查强度不降。
 */
import { AlertTriangle, ArrowUpRight, Bot, Check, ChevronDown, Clock3, Copy, Eye, EyeOff, FolderTree, Plus, Play, RefreshCw, Settings2, Sparkles, Trash2, X, Zap, CircleCheck, ChevronRight, Wallet, LogIn } from "lucide-react";
import { Spinner } from "../../../components/CardShell";

type Props = {
  accounts: any[];
  activeProvider: string | undefined;
  isActiveProvider: boolean;
  keyGroups: any[];
  openManage: (a: any) => Promise<void>;
  removeAccount: (target: { id: string; email?: string | undefined; active?: boolean | undefined; }) => Promise<void>;
  setLoginModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  switchAccount: (id: string) => Promise<void>;
  toggleAccount: (id: string, enabled: boolean) => Promise<void>;
  working: string;
};

export function RelayCenterPageAccountGrid({ accounts, activeProvider, isActiveProvider, keyGroups, openManage, removeAccount, setLoginModalOpen, switchAccount, toggleAccount, working }: Props) {
  return (
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
  );
}
