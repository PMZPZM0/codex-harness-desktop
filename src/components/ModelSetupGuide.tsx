import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { Bot, CircleGauge, ExternalLink, KeyRound, Rocket, Settings2, Sparkles, X } from "lucide-react";

/** 模型配置引导（09-17 起，09-19 升级为「小白快速上手」）。
 *
 *  ⛔ 09-19 用户反馈：「登录界面和模型供应商配置联动性还是差了一些，新手总是不会」。
 *  当时的实际卡点（逐个走过一遍）：
 *    · 登录页有一条**快路**（选线路 → 粘 Key → 探测 → 自动导入模型 → 生效），
 *      但新手最常见的动作是点「暂时不登录，直接进入」—— 于是这条快路**再也用不到了**；
 *    · 进了主界面只剩「设置 → 模型 → 供应商」的**完整表单**：供应商 ID、Base URL、
 *      API Key、模型列表、勾选生效……每一样都要先懂概念才能填对；
 *    · 引导弹窗只给了两个"跳转"按钮，跳过去还是那张完整表单 —— 等于把新手送到半路。
 *
 *  现在：**把快路搬进引导弹窗**。粘一个 Key → 一键探测 + 导入模型 + 生效 + 开头一句提示，
 *  全程不需要理解"供应商 / Base URL / 模型 ID / 勾选生效"。
 *  把完整表单留成次要入口（「我自己配」），服务懂行的用户。
 *
 *  ⛔ 触发条件不变（App 侧负责）：只在**没有生效模型**时弹一次；配好即永不再弹。
 */
export type QuickLine = { id: string; name: string; label: string; url: string };

export function ModelSetupGuide({
  lines,
  busy,
  error,
  onQuickSetup,
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
  onGoSubscription: () => void;
  /** 高级：走完整的供应商表单 */
  onGoManual: () => void;
  onRegister: () => void;
  onClose: () => void;
}) {
  const [lineIndex, setLineIndex] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

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

  return createPortal(
    <div className="modal-backdrop model-guide-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="model-guide" role="dialog" aria-modal="true" aria-label="配置模型">
        <header>
          <div className="model-guide-title"><span><Sparkles size={17} /></span><strong>还差一步就能开始对话</strong></div>
          <button className="icon-button" title="关闭（Esc）" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="model-guide-body">
          <p className="model-guide-lead">
            Codex 需要一个「大脑」才能干活。**最省事的方式**：粘一个 API Key，下面的按钮会自动识别模型并配好。
          </p>

          {/* ① 主路径：粘 Key 一键配好（新手只需要做这一件事） */}
          <div className="model-guide-quick">
            <div className="model-guide-quick-head">
              <KeyRound size={15} />
              <strong>粘贴 API Key，自动配好</strong>
              <span className="model-guide-step">推荐</span>
            </div>

            {lines.length > 1 && (
              <div className="model-guide-lines" role="radiogroup" aria-label="接入线路">
                {lines.map((option, index) => (
                  <button
                    type="button"
                    key={option.id}
                    role="radio"
                    aria-checked={index === lineIndex}
                    className={`model-guide-line ${index === lineIndex ? "active" : ""}`}
                    onClick={() => setLineIndex(index)}
                    disabled={busy}
                  >
                    <b>{option.label}</b>
                    <small>{option.url}</small>
                  </button>
                ))}
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
                  disabled={busy}
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

          {/* ② 次路径：其它情况（订阅 / 自己填完整表单） */}
          <div className="model-guide-paths">
            <button type="button" className="model-guide-path compact" onClick={onGoSubscription} disabled={busy}>
              <span className="model-guide-icon sub"><CircleGauge size={17} /></span>
              <span className="model-guide-text">
                <strong>我有 ChatGPT 订阅</strong>
                <em>用 ChatGPT 账号登录，不用 Key、不用另外付费</em>
              </span>
              <span className="model-guide-go">去登录</span>
            </button>
            <button type="button" className="model-guide-path compact" onClick={onGoManual} disabled={busy}>
              <span className="model-guide-icon key"><Settings2 size={17} /></span>
              <span className="model-guide-text">
                <strong>我自己配（已有 Base URL）</strong>
                <em>完整表单：填地址、Key、勾选模型 —— 熟手用</em>
              </span>
              <span className="model-guide-go">去配置</span>
            </button>
          </div>

          <div className="model-guide-tips">
            <p><Bot size={13} />Key 在本机加密保存，不会上传。</p>
            <p>配错了也不怕：供应商随时可编辑或删除，不会影响已有的聊天记录。</p>
          </div>
        </div>
        <footer>
          <button className="secondary-setting" onClick={onClose}>稍后再说</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
