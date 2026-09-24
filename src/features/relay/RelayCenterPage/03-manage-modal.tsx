/**
 * RelayCenterPageManageModal —— RelayCenterPage 的 JSX 第 3 段（09-22 从 RelayCenterPage.tsx 分出，纯搬迁）。
 * ⛔ props 类型由 TypeChecker 从**原作用域**推断（不是 any）⇒ 静态检查强度不降。
 */
import { AlertTriangle, ArrowUpRight, Bot, Check, ChevronDown, Clock3, Copy, Eye, EyeOff, FolderTree, Plus, Play, RefreshCw, Settings2, Sparkles, Trash2, X, Zap, CircleCheck, ChevronRight, Wallet, LogIn } from "lucide-react";
import { Spinner } from "../../../components/CardShell";
import { copyTextToClipboard } from "../../../lib/clipboard";
import { shortGroupName } from "../RelayCenterPage/01-balance-badge";

type Props = {
  account: { id?: string | undefined; baseUrl: string; email: string; } | null;
  accounts: any[];
  active: import("../../../lib/relay.ts").RelayActive | null;
  busy: boolean;
  createKey: () => Promise<void>;
  creatingKey: boolean;
  currentKey: any;
  groupNameOf: (gid: any) => string;
  isActiveProvider: boolean;
  isLiveRow: (id?: string | undefined) => boolean;
  keyGroups: any[];
  keyVisible: boolean;
  keysCollapsed: boolean;
  load: (silent?: boolean, accountId?: string | undefined) => Promise<void>;
  manageOpen: boolean;
  maskKey: (key: string) => string;
  newKey: { name: string; groupId: string; };
  onNotice: (m: string) => void;
  onOpenModelSettings: () => void;
  overview: any;
  progress: (used: number, limit: number) => number;
  refreshing: boolean;
  removeAccount: (target: { id: string; email?: string | undefined; active?: boolean | undefined; }) => Promise<void>;
  setKeyVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setKeysCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setManageOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setNewKey: React.Dispatch<React.SetStateAction<{ name: string; groupId: string; }>>;
  setShowKeyForm: React.Dispatch<React.SetStateAction<boolean>>;
  showKeyForm: boolean;
  subs: any[];
  switchTarget: (mode: "balance" | "plan", group?: { group_id: number; group_name: string; } | undefined, explicitKey?: { id: any; name: any; key: string; group_id: number | null; } | undefined) => Promise<void>;
  useKeyFromGroup: (group: any, k: any) => Promise<void>;
  working: string;
};

export function RelayCenterPageManageModal({ account, accounts, active, busy, createKey, creatingKey, currentKey, groupNameOf, isActiveProvider, isLiveRow, keyGroups, keyVisible, keysCollapsed, load, manageOpen, maskKey, newKey, onNotice, onOpenModelSettings, overview, progress, refreshing, removeAccount, setKeyVisible, setKeysCollapsed, setManageOpen, setNewKey, setShowKeyForm, showKeyForm, subs, switchTarget, useKeyFromGroup, working }: Props) {
  return (
    manageOpen && account && (
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
          )
  );
}
