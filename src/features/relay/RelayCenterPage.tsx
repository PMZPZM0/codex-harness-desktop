/**
 * RelayCenterPage —— **视图层**（09-22：状态与逻辑已提成 useRelayCenterPageState，本文件只剩 JSX）。
 * ⛔ 解构名与 hook 返回键同名 ⇒ JSX 与搬迁前逐字一致。
 */
import { AlertTriangle, ArrowUpRight, Bot, Check, ChevronDown, Clock3, Copy, Eye, EyeOff, FolderTree, Plus, Play, RefreshCw, Settings2, Sparkles, Trash2, X, Zap, CircleCheck, ChevronRight, Wallet, LogIn } from "lucide-react";
import { PageInfo } from "../../components/SettingsHead";
export { RelayBalanceBadge, RelayAccountEntryBanner } from "./RelayCenterPage/01-balance-badge";
import { useRelayCenterPageState } from "./RelayCenterPage/use-relay-center-page-state";
import { RelayCenterPageSubscriptionBanner } from "./RelayCenterPage/01-subscription-banner";
import { RelayCenterPageAccountGrid } from "./RelayCenterPage/02-account-grid";
import { RelayCenterPageManageModal } from "./RelayCenterPage/03-manage-modal";
import { RelayCenterPageLoginModal } from "./RelayCenterPage/04-login-modal";
import { RelayCenterPagePlansModal } from "./RelayCenterPage/05-plans-modal";

export function RelayCenterPage({ busy, activeProvider, onActivate, onNotice, onOpenModelSettings, openAppConfirm }: { busy: boolean; activeProvider?: string; onActivate: (mode: "balance" | "plan", group?: { group_id: number; group_name: string }, explicitKey?: { id: any; name: any; key: string; group_id: number | null }) => Promise<void> | void; onNotice: (m: string) => void; onOpenModelSettings: () => void; openAppConfirm: (title: string, text: string, confirmLabel?: string) => Promise<boolean> }) {
  const { account, setAccount, draft, setDraft, overview, setOverview, err, setErr, working, setWorking, active, isActiveProvider, refreshing, setRefreshing, load, accounts, setAccounts, manageOpen, setManageOpen, loginModalOpen, setLoginModalOpen, reloadAccounts, isLiveRow, autoConfigure, login, switchAccount, removeAccount, toggleAccount, openManage, switchTarget, subs, progress, showKeyForm, setShowKeyForm, newKey, setNewKey, creatingKey, setCreatingKey, keyGroups, setKeyGroups, collapsedGroups, setCollapsedGroups, keysCollapsed, setKeysCollapsed, loadKeyGroups, AFF_CODE, authTab, setAuthTab, regDraft, setRegDraft, plansOpen, setPlansOpen, plans, setPlans, plansLoading, setPlansLoading, plansErr, setPlansErr, watching, setWatching, watchRef, subChangeKey, stopWatch, verifyPayment, startWatch, openPurchase, openPlans, register, groupNameOf, createKey, useKeyFromGroup, keyVisible, setKeyVisible, currentKey, maskKey } = useRelayCenterPageState({ busy, activeProvider, onActivate, onNotice, onOpenModelSettings, openAppConfirm });
  return (
    <section className="settings-section stack relay-center">
      <div className="settings-copy channel-heading"><div><h2>中转站<PageInfo text={<>每个中转站账号一张卡片：点卡片进入该账号的管理面板（余额总览、订阅套餐、密钥管理），所有操作即时生效；聊天输入框旁会实时显示当前余量。</>} /></h2></div></div>
      <RelayCenterPageSubscriptionBanner account={account} accounts={accounts} busy={busy} load={load} onNotice={onNotice} openManage={openManage} openPlans={openPlans} overview={overview} progress={progress} refreshing={refreshing} setAuthTab={setAuthTab} setLoginModalOpen={setLoginModalOpen} stopWatch={stopWatch} subs={subs} switchTarget={switchTarget} verifyPayment={verifyPayment} watching={watching} working={working} />
      {err && <p className="relay-account-err"><AlertTriangle size={13} />{err}</p>}
      <RelayCenterPageAccountGrid accounts={accounts} activeProvider={activeProvider} isActiveProvider={isActiveProvider} keyGroups={keyGroups} openManage={openManage} removeAccount={removeAccount} setLoginModalOpen={setLoginModalOpen} switchAccount={switchAccount} toggleAccount={toggleAccount} working={working} />
      <p className="relay-center-foot">{isActiveProvider ? <>当前生效供应商「{active!.label}」，输入框旁的余额徽标实时同步；点上方卡片进入各账号的管理面板。</> : <>尚无生效供应商：点账号卡片进入管理面板，选套餐或密钥即可自动生成并切换。</>}</p>
      <RelayCenterPageManageModal account={account} accounts={accounts} active={active} busy={busy} createKey={createKey} creatingKey={creatingKey} currentKey={currentKey} groupNameOf={groupNameOf} isActiveProvider={isActiveProvider} isLiveRow={isLiveRow} keyGroups={keyGroups} keyVisible={keyVisible} keysCollapsed={keysCollapsed} load={load} manageOpen={manageOpen} maskKey={maskKey} newKey={newKey} onNotice={onNotice} onOpenModelSettings={onOpenModelSettings} overview={overview} progress={progress} refreshing={refreshing} removeAccount={removeAccount} setKeyVisible={setKeyVisible} setKeysCollapsed={setKeysCollapsed} setManageOpen={setManageOpen} setNewKey={setNewKey} setShowKeyForm={setShowKeyForm} showKeyForm={showKeyForm} subs={subs} switchTarget={switchTarget} useKeyFromGroup={useKeyFromGroup} working={working} />
      <RelayCenterPageLoginModal AFF_CODE={AFF_CODE} authTab={authTab} draft={draft} login={login} loginModalOpen={loginModalOpen} regDraft={regDraft} register={register} setAuthTab={setAuthTab} setDraft={setDraft} setErr={setErr} setLoginModalOpen={setLoginModalOpen} setRegDraft={setRegDraft} working={working} />
      <RelayCenterPagePlansModal account={account} openPurchase={openPurchase} overview={overview} plans={plans} plansErr={plansErr} plansLoading={plansLoading} plansOpen={plansOpen} setPlansOpen={setPlansOpen} subs={subs} working={working} />
    </section>
  );
}
