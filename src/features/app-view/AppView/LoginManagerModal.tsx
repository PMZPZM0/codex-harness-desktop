/**
 * 「登录管理」弹窗（10-21 用户要求）。
 *
 * 用户原话：「加一个登录管理，点击弹窗提醒 GPT订阅 中转站账户 云账号，明显自定义，跳转都是直达界面」。
 * 要解决的具体问题：三个账户入口原本散在「设置 → 账户与模型」下面（用户中心 / 模型 / 中转站 /
 * 云账号 / OpenAI 订阅），用户记不住哪个是登录、哪个是选模型 ⇒ 这里只列**三处真的需要登录/密钥**的，
 * 一处一句人话说明它管什么，点一下**直达**该设置页（⛔ 不是再进一层菜单）。
 *
 * ⛔ 三条都是**跳转**，不在这里做登录（登录表单各有各的校验与回调，复制一份必然漂移）。
 * ⛔ 目录与文案的真相源是 `helpers/catalogs.ts` 的「账户与模型」组 + 各页 own 组件；
 *    这里只做入口聚合，不复制它们的表单/状态。
 * ⛔ 本组件自包含：只收 props，不进 bag；关闭三路（✕ / 遮罩 / Esc）并归还焦点。
 */
import { useEffect, useRef, type ComponentType } from "react";
import { ChevronRight, CircleGauge, Cloud, LogIn, Wallet, X } from "lucide-react";

/** 直达的设置页 id（与 settings-registry / catalogs.ts 的「账户与模型」组一致）。 */
export type LoginManagerTarget = "openai" | "relay" | "cloud";

type AccountRow = {
  page: LoginManagerTarget;
  label: string;
  /** 一句人话：它到底管什么（⛔ 不写「点击进入」这种废话） */
  desc: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  /** 图标色相：与 settings 目录里同一条目同色（green / cyan / pink），扫一眼就能对上 */
  tone: string;
};

const ACCOUNTS: AccountRow[] = [
  {
    page: "openai",
    label: "GPT 订阅",
    desc: "官方 ChatGPT 订阅额度：登录后同步用量与可用模型",
    icon: CircleGauge,
    tone: "ic-green",
  },
  {
    page: "relay",
    label: "中转站账户",
    desc: "第三方中转 / 自建网关：填地址与密钥，一键生成供应商",
    icon: Wallet,
    tone: "ic-cyan",
  },
  {
    page: "cloud",
    label: "云账号",
    desc: "云端账号：同步云端模型、云端知识库与记忆开通状态",
    icon: Cloud,
    tone: "ic-pink",
  },
];

/**
 * @param targets 只列哪几处（默认三处全列）。
 *   ⛔ 云助手形态**没有**「云账号」设置页（它整站就是云端客户端，登录在启动门里）——
 *      那里传两处，而不是硬造一个跳过去是空页的入口。
 */
export function LoginManagerModal({ onNavigate, onClose, targets }: {
  onNavigate: (page: LoginManagerTarget) => void;
  onClose: () => void;
  targets?: LoginManagerTarget[];
}) {
  const rows = targets ? ACCOUNTS.filter((account) => targets.includes(account.page)) : ACCOUNTS;
  const firstRef = useRef<HTMLButtonElement>(null);

  /* Esc 关闭 + 焦点归还（与侧栏教程弹窗同一套口径：打开时把焦点送进来，
     关闭时还回触发它的那个按钮，键盘用户不会"焦点掉回 body"）。 */
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      /* Tab 焦点陷阱：`aria-modal` 承诺「焦点只在这个对话框里」——
         不拦 Tab 的话焦点会跑到背后的侧栏/消息区，键盘用户会「消失」在弹窗外。 */
      if (event.key !== "Tab") return;
      const focusables = [...document.querySelectorAll<HTMLElement>(".login-mgr button:not([disabled])")];
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="info-modal-mask sidebar-guide-mask"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        className="info-modal sidebar-guide ic-blue login-mgr"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-mgr-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sidebar-guide-head">
          <span className="sidebar-guide-icon" aria-hidden><LogIn size={19} /></span>
          <span className="sidebar-guide-heading">
            <strong id="login-mgr-title">登录管理</strong>
            <small>三处需要登录或密钥的账户，点一行直达对应页面</small>
          </span>
          <button className="sidebar-guide-close" title="关闭（Esc）" aria-label="关闭" onClick={onClose}><X size={16} /></button>
        </header>

        <div className="sidebar-guide-body">
          <div className="login-mgr-list">
            {rows.map((account, index) => {
              const Icon = account.icon;
              return (
                <button
                  key={account.page}
                  ref={index === 0 ? firstRef : undefined}
                  type="button"
                  className="login-mgr-row"
                  data-login-target={account.page}
                  onClick={() => onNavigate(account.page)}
                >
                  <span className={`login-mgr-icon ${account.tone}`} aria-hidden><Icon size={17} /></span>
                  <span className="login-mgr-text">
                    <strong>{account.label}</strong>
                    <small>{account.desc}</small>
                  </span>
                  <ChevronRight size={15} className="login-mgr-arrow" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
