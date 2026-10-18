/**
 * file-trust-ask.mjs —— 「这个目录在工作区外，要不要授权」的**应用内**询问通道。
 *
 * ⛔ 为什么不用系统弹窗：`dialog.showMessageBox` 会跑到窗口外/独立窗口（用户实测「位置不对」），
 *    且原生模态关闭后会吞焦点。
 * ⛔ 为什么不内嵌到编辑器里：那是"错误态 UI"，用户不知道该点哪儿；授权是一次全局决定，
 *    应当以**居中模态**（带遮罩、焦点被困在卡片内）呈现。
 *
 * 形态：模块级 pub/sub + Promise —— 调用方 `await askFileTrust({dir})` 拿到 true/false，
 * 弹窗组件只负责渲染与回包。两边都不依赖 React 上下文，任何组件都能问。
 */
let asker = null;
let resolver = null;

/** 注册渲染器（由 `<FileTrustDialog />` 在挂载时调用），返回反注册。 */
export function onFileTrustAsk(handler) {
  asker = handler;
  return () => { if (asker === handler) asker = null; };
}

/** 发起一次询问；没有弹窗挂载时直接返回 false（宁可不放行，也不静默授权）。 */
export function askFileTrust(payload) {
  if (!asker) return Promise.resolve(false);
  return new Promise((resolve) => {
    resolver = resolve;
    asker(payload);
  });
}

/** 弹窗回包（true = 允许并预览）。只认第一次，避免重复点击。 */
export function respondFileTrust(allowed) {
  const resolve = resolver;
  resolver = null;
  if (resolve) resolve(Boolean(allowed));
}
