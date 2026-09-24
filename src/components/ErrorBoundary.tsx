import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

const ERR_KEY = "__ui_errors";

/**
 * 全局错误边界：任何渲染异常不再白屏，显示错误卡片（错误信息 + 重试/刷新）。
 * 覆盖 App 整棵渲染树；事件回调里的错误不在此范围（那些不会导致白屏）。
 *
 * 09-23 补：渲染层错误**落盘取证**（localStorage 留最近 20 条）。
 * 原先只进 console ⇒ 用户报「老是崩溃」时没有任何历史可查，只能靠截图。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("[ErrorBoundary]", error, info);
    (window as any).__errStack = (error as Error)?.stack || "";
    try {
      const list = JSON.parse(localStorage.getItem(ERR_KEY) || "[]");
      list.unshift({
        at: new Date().toISOString(),
        msg: String((error as Error)?.message ?? error),
        stack: String((error as Error)?.stack ?? "").slice(0, 2000),
        href: location.href,
      });
      localStorage.setItem(ERR_KEY, JSON.stringify(list.slice(0, 20)));
    } catch {
      /* 取证失败不能影响主流程 */
    }
  }

  /** 把最近 20 条渲染层错误复制到剪贴板（用户可直接粘给开发者） */
  copyDiag() {
    let text = "";
    try {
      text = localStorage.getItem(ERR_KEY) || "";
    } catch {
      text = "";
    }
    const fallback = String((this.state.error as Error)?.stack ?? "");
    try {
      void navigator.clipboard?.writeText(text || fallback);
    } catch {
      /* 剪贴板不可用时忽略 */
    }
  }

  render() {
    if (this.state.error) {
      const stack = (this.state.error as Error)?.stack || "";
      return (
        <div className="boot-error">
          <div className="boot-error-card">
            <h2>界面发生错误</h2>
            <p className="boot-error-desc">渲染层遇到异常（已拦截，不再白屏）。错误信息：</p>
            <pre className="boot-error-msg">{this.state.error.message || String(this.state.error)}</pre>
            <pre className="boot-error-msg" data-debug="stack" style={{ fontSize: 11, opacity: 0.7 }}>{stack}</pre>
            <div className="boot-error-actions">
              <button onClick={() => this.setState({ error: null })}>重试渲染</button>
              <button onClick={() => window.location.reload()}>重新加载应用</button>
              <button onClick={() => this.copyDiag()}>复制诊断信息</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}