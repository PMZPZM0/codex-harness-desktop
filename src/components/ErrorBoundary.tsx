import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * 全局错误边界：任何渲染异常不再白屏，显示错误卡片（错误信息 + 重试/刷新）。
 * 覆盖 App 整棵渲染树；事件回调里的错误不在此范围（那些不会导致白屏）。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("[ErrorBoundary]", error, info);
    (window as any).__errStack = (error as Error)?.stack || "";
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
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
