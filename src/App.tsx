import { useHarnessApp } from "./features/app-state/useHarnessApp";
import { AppView } from "./features/app-view/AppView";

export default function App() {
  const app = useHarnessApp();
  // ⛔ 未登录分支：原实现在 App 里**提前 return 登录页**（L12518 的 `if (showLogin)`）。抽成 hook 后不能提前
  //    return —— ① 会让 hook 的返回类型变成 `Element | {...}`；② 违反 hook 调用序稳定。改成条件字段在这里短路。
  //    等价依据（实测，不是推断）：那个提前 return 之后**没有任何 hook 调用**（最后一个 hook 在更早位置），
  //    因此「原本被跳过的那段纯声明」现在会执行，而它们没有副作用（只是构造 JSX 元素）。
  if (app.earlyView) return app.earlyView;
  return <AppView app={app} />;
}
