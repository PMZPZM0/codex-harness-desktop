import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { Bot, Check, CircleGauge, ExternalLink, KeyRound, Rocket, Settings2, Sparkles, Wallet, X } from "lucide-react";

/** 模型配置引导（09-17 起；09-19 按用户反馈重做排版 + 补中转站入口）。
 *
 *  ⛔ 09-19 用户反馈（原话）：「中转站登录呢，然后，排版太丑……弹窗提醒的优化一下展示」。
 *  上一版的毛病：
 *    · 把「线路选择 + Key 输入 + 一键配置」全塞在一张大卡里，四条线路横排各带一长串 URL，
 *      再叠上两条次要路径——信息全挤在一起，看不出主次，**又高又丑**；
 *    · 登录页有的「中转站账户」入口**这里没有** —— 从登录页点「暂时不登录」进来的新手，
 *      压根找不到中转站登录（用户第一句问的就是这个）；
 *    · 引导文案里写了 markdown 星号 `**…**`，这里是纯文本渲染 ⇒ 界面上原样显示星号。
 *
 *  现在的形态：**四个入口做成一行标签，一次只展开一个**（不再堆在一起）。
 *  默认停在最省事的「粘贴 Key」；中转站 / 订阅 / 完整表单各占一格，谁也不会被埋掉。
 *
 *  ⛔ 触发条件（App 侧负责）：只在**没有生效模型**时弹，且**配好过就不再弹**。
 */
export type QuickLine = { id: string; name: string; label: string; url: string };

type Tab = "key" | "relay" | "subscription" | "manual";

export function ModelSetupGuide({
  lines,
  busy,
  error,
  onQuickSetup,
  relayBusy,
  relayError,
  onRelayLogin,
  onGoSubscription,
  onGoManual,
  onRegister,
  onClose,
}: {
  /** 可选线路（由 App 传入，与登录页同一份数据，避免两处不一致） */
  lines: QuickLine[];
  busy: boolean;
  error: string;
  /** 一键配置：粘 Key 即可（探测 → 导入模型 → 生效） */
  onQuickSetup: (info: { provider: string; name: string; baseUrl: string; apiKey: string }) => void;
  /** 中转站账户登录（与登录页同一条链路，见 lib/relay.ts 的 performRelayLogin） */
  relayBusy: boolean;
  relayError: string;
  onRelayLogin: (info: { baseUrl: string; email: string; password: string }) => void;
  onGoSubscription: () => void;
  /** 高级：走完整的供应商表单 */
  onGoManual: () => void;
  onRegister: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("key");
  const [lineIndex, setLineIndex] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [relay, setRelay] = useState({ baseUrl: "https://api.pptoken.cc", email: "", password: "" });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const line = lines[Math.min(lineIndex, Math.max(0, lines.length - 1))];
  const canSubmit = Boolean(apiKey.trim()) && !busy && Boolean(line);
  const canRelay = Boolean(relay.baseUrl.trim() && relay.email.trim() && relay.password.trim()) && !relayBusy;
  const anyBusy = busy || relayBusy;

  const TABS: { id: Tab; label: string; icon: typeof KeyRound; hint: string }[] = [
    { id: "key", label: "粘贴 API Key", icon: KeyRound, hint: "最省事" },
    { id: "relay", label: "中转站账户", icon: Wallet, hint: "账号密码" },
    { id: "subscription", label: "ChatGPT 订阅", icon: CircleGauge, hint: "官方账号" },
    { id: "manual", label: "我自己配", icon: Settings2, hint: "熟手" },
  ];

  return createPortal(
    <div className="modal-backdrop model-guide-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="model-guide" role="dialog" aria-modal="true" aria-label="配置模型">
        <header>
          <div className="model-guide-title"><span><Sparkles size={17} /></span><strong>还差一步就能开始对话</strong></div>
          <button className="icon-button" title="关闭（Esc）" onClick={onClose}><X size={16} /></button>
        </header>

        <div className="model-guide-body">
          <p className="model-guide-lead">Codex 需要一个「大脑」才能干活。下面任选一种方式配好即可开始。</p>

          {/* 四个入口：一行标签，一次只展开一个（上一版全堆在一起，又高又没有主次） */}
          <div className="model-guide-tabs" role="tablist" aria-label="配置方式">
            {TABS.map((entry) => {
              const Icon = entry.icon;
              const active = tab === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`model-guide-tab ${active ? "active" : ""}`}
                  onClick={() => setTab(entry.id)}
                  disabled={anyBusy}
                >
                  <Icon size={15} />
                  <span><b>{entry.label}</b><em>{entry.hint}</em></span>
                </button>
              );
            })}
          </div>

          {/* ① 粘贴 Key（默认） */}
          {tab === "key" && (
            <div className="model-guide-pane">
              {lines.length > 0 && (
                <div className="model-guide-lines" role="radiogroup" aria-label="接入线路">
                  {lines.map((option, index) => (
                    <button
                      type="button"
                      key={option.id}
                      role="radio"
                      aria-checked={index === lineIndex}
                      className={`model-guide-line ${index === lineIndex ? "active" : ""}`}
                      onClick={() => setLineIndex(index)}
                      disabled={anyBusy}
                    >
                      {index === lineIndex ? <Check size={12} /> : <span className="dot" />}
                      <b>{option.label}</b>
                    </button>
                  ))}
                  {line && <small className="model-guide-line-url">{line.url}</small>}
                </div>
              )}

              <label className="se-field model-guide-key">
                <span>API 密钥</span>
                <div className="pw-wrap">
                  <input
                    autoFocus
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="sk-...（粘贴后点下面的按钮即可）"
                    disabled={anyBusy}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && canSubmit && line) {
                        onQuickSetup({ provider: line.id, name: line.name, baseUrl: line.url, apiKey: apiKey.trim() });
                      }
                    }}
                  />
                  <button type="button" className="pw-toggle" onClick={() => setShowKey((v) => !v)}>{showKey ? "隐藏" : "显示"}</button>
                </div>
              </label>

              {error && <p className="model-guide-error">{error}</p>}

              <button
                className="primary-setting login-btn model-guide-submit"
                disabled={!canSubmit}
                onClick={() => { if (line) onQuickSetup({ provider: line.id, name: line.name, baseUrl: line.url, apiKey: apiKey.trim() }); }}
              >
                {busy ? "正在探测模型…" : "一键配置并开始"}
              </button>

              <div className="model-guide-quick-foot">
                <button type="button" className="model-guide-link" onClick={onRegister}>
                  <Rocket size={12} />没有 Key？领取体验额度<ExternalLink size={11} />
                </button>
                <span>配好后可随时在对话框底部切换模型</span>
              </div>
            </div>
          )}

          {/* ② 中转站账户（09-19 用户：「中转站登录呢」——登录页有、这里之前没有） */}
          {tab === "relay" && (
            <div className="model-guide-pane">
              <label className="se-field">
                <span>中转站地址（sub2api 网关）</span>
                <input value={relay.baseUrl} onChange={(e) => setRelay({ ...relay, baseUrl: e.target.value })} placeholder="https://api.pptoken.cc" disabled={anyBusy} />
              </label>
              <label className="se-field">
                <span>账号邮箱</span>
                <input value={relay.email} onChange={(e) => setRelay({ ...relay, email: e.target.value })} placeholder="你在中转站的账号邮箱" disabled={anyBusy} />
              </label>
              <label className="se-field">
                <span>密码</span>
                <div className="pw-wrap">
                  <input
                    type={showKey ? "text" : "password"}
                    value={relay.password}
                    onChange={(e) => setRelay({ ...relay, password: e.target.value })}
                    placeholder="中转站账号密码"
                    disabled={anyBusy}
                    onKeyDown={(e) => { if (e.key === "Enter" && canRelay) onRelayLogin(relay); }}
                  />
                  <button type="button" className="pw-toggle" onClick={() => setShowKey((v) => !v)}>{showKey ? "隐藏" : "显示"}</button>
                </div>
              </label>

              {relayError && <p className="model-guide-error">{relayError}</p>}

              <button className="primary-setting login-btn model-guide-submit" disabled={!canRelay} onClick={() => onRelayLogin(relay)}>
                {relayBusy ? "正在登录中转站…" : "登录并自动配置"}
              </button>

              <p className="model-guide-note">登录后自动同步余额与订阅套餐（优先用套餐，无套餐走余额），并生成好供应商直接开聊。</p>
            </div>
          )}

          {/* ③ ChatGPT 订阅 */}
          {tab === "subscription" && (
            <div className="model-guide-pane">
              <div className="model-guide-pick">
                <span className="model-guide-icon sub"><CircleGauge size={18} /></span>
                <div><strong>用 ChatGPT 账号登录</strong><em>不用 API Key、不另外付费，走你自己的订阅额度</em></div>
              </div>
              <button className="primary-setting login-btn model-guide-submit" disabled={anyBusy} onClick={onGoSubscription}>去登录 ChatGPT</button>
            </div>
          )}

          {/* ④ 我自己配（完整表单） */}
          {tab === "manual" && (
            <div className="model-guide-pane">
              <div className="model-guide-pick">
                <span className="model-guide-icon key"><Settings2 size={18} /></span>
                <div><strong>打开完整供应商表单</strong><em>自己填 Base URL、Key、模型列表并勾选生效 —— 熟手用</em></div>
              </div>
              <button className="primary-setting login-btn model-guide-submit" disabled={anyBusy} onClick={onGoManual}>打开模型设置</button>
            </div>
          )}
        </div>

        <footer>
          <span className="model-guide-foot-note"><Bot size={12} />Key 在本机加密保存，不会上传</span>
          <button className="secondary-setting" onClick={onClose}>稍后再说</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
