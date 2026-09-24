/**
 * RelayCenterPageLoginModal —— RelayCenterPage 的 JSX 第 4 段（09-22 从 RelayCenterPage.tsx 分出，纯搬迁）。
 * ⛔ props 类型由 TypeChecker 从**原作用域**推断（不是 any）⇒ 静态检查强度不降。
 */
import { AlertTriangle, ArrowUpRight, Bot, Check, ChevronDown, Clock3, Copy, Eye, EyeOff, FolderTree, Plus, Play, RefreshCw, Settings2, Sparkles, Trash2, X, Zap, CircleCheck, ChevronRight, Wallet, LogIn } from "lucide-react";
import { Spinner } from "../../../components/CardShell";

type Props = {
  AFF_CODE: string;
  authTab: "login" | "register";
  draft: { baseUrl: string; email: string; password: string; };
  login: () => Promise<void>;
  loginModalOpen: boolean;
  regDraft: { email: string; password: string; confirm: string; };
  register: () => Promise<void>;
  setAuthTab: React.Dispatch<React.SetStateAction<"login" | "register">>;
  setDraft: React.Dispatch<React.SetStateAction<{ baseUrl: string; email: string; password: string; }>>;
  setErr: React.Dispatch<React.SetStateAction<string>>;
  setLoginModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setRegDraft: React.Dispatch<React.SetStateAction<{ email: string; password: string; confirm: string; }>>;
  working: string;
};

export function RelayCenterPageLoginModal({ AFF_CODE, authTab, draft, login, loginModalOpen, regDraft, register, setAuthTab, setDraft, setErr, setLoginModalOpen, setRegDraft, working }: Props) {
  return (
    loginModalOpen && (
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
          )
  );
}
