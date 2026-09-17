import { createPortal } from "react-dom";
import { useEffect } from "react";
import { Bot, CircleGauge, KeyRound, Sparkles, X } from "lucide-react";

/** 模型配置引导（09-17 用户要求：首次启动给新手一个模型配置引导弹窗）。
 *
 *  触发条件按用户确认：「**只在未配置时**弹」——即没有生效模型（customModel 为空）时才出现，
 *  配好之后永不再弹。这样既保证新手一定看到，又不打扰已经配好的用户。
 *
 *  ⛔ 判据与时机（App 侧负责）：
 *  - 判据用"没有生效模型"，**不要**用"providersList 为空"（可能有供应商但没勾选模型，
 *    同样发不出消息，那也是没配好）。
 *  - 必须等首屏数据加载完成后再判断，否则启动过程中 customModel 还是初始空值会**误弹**。
 *
 *  内容面向完全不懂的用户：只讲两条路（订阅登录 / 自己的 Key），各自一句话说清代价与前提，
 *  并给出直达按钮 —— 引导弹窗的价值在于"把人送到正确页面"，不是复述文档。
 */
export function ModelSetupGuide({
  onGoModel,
  onGoSubscription,
  onClose,
}: {
  onGoModel: () => void;
  onGoSubscription: () => void;
  onClose: () => void;
}) {
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

  return createPortal(
    <div className="modal-backdrop model-guide-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="model-guide" role="dialog" aria-modal="true" aria-label="配置模型">
        <header>
          <div className="model-guide-title"><span><Sparkles size={17} /></span><strong>先配一个模型，就能开始对话了</strong></div>
          <button className="icon-button" title="关闭（Esc）" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="model-guide-body">
          <p className="model-guide-lead">Codex 本身不带模型，需要你告诉它用哪个「大脑」。两条路，按你的情况二选一：</p>

          <button type="button" className="model-guide-path" onClick={onGoSubscription}>
            <span className="model-guide-icon sub"><CircleGauge size={18} /></span>
            <span className="model-guide-text">
              <strong>我有 ChatGPT 订阅</strong>
              <em>登录官方账号直接用，不用申请 Key、不用付费配置。选这条最省事。</em>
            </span>
            <span className="model-guide-go">去登录</span>
          </button>

          <button type="button" className="model-guide-path" onClick={onGoModel}>
            <span className="model-guide-icon key"><KeyRound size={18} /></span>
            <span className="model-guide-text">
              <strong>我有自己的 API Key（或中转站账号）</strong>
              <em>在「模型」页添加供应商：填名称、接口地址、Key，再勾选模型保存即可。</em>
            </span>
            <span className="model-guide-go">去配置</span>
          </button>

          <div className="model-guide-tips">
            <p><Bot size={13} />配置完成后，在对话框底部可以随时切换模型与思考强度，不用回设置。</p>
            <p>配错了也不怕：供应商可以随时编辑或删除，Key 是加密保存的。</p>
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
