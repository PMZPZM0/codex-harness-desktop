/** ESC 分层栈（10-31 用户令：「esc 只关闭最上面的」）。
 *
 * 问题：全仓库每个弹窗/浮层各自 `window.addEventListener("keydown", ...)`，一次 Esc 会被**所有**
 * 打开的层收到 ⇒ 设置里开二级弹窗后，Esc 把二级和设置一起关掉。
 * 方案：所有层统一注册到本栈（按挂载顺序入栈，后挂的在上）；只让**最上层**消费一次 Esc。
 *
 * ⛔ 用 bubble 阶段、而不是 capture：输入框/下拉框在元素上的 Esc（stopPropagation）仍然先执行，
 *    不会因为「弹窗层」抢走而失效。
 * ⛔ 只有栈非空时才拦截；栈空 ⇒ 不 preventDefault / 不 stop，让未迁移的老浮层照旧工作。
 * ⛔ handler 返回 false = 本层不消费（例如"正在提交中不许关"），继续交给下一层。
 * 纯模块（零 React 依赖），便于守卫/测试直接跑。
 */

const layers = [];
let installed = false;

function onKeyDown(event) {
  if (String(event?.key ?? "") !== "Escape") return;
  if (layers.length === 0) return;
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const entry = layers[i];
    let consumed = true;
    try {
      consumed = entry.handler(event) !== false;
    } catch { consumed = true; }
    if (!consumed) continue;
    try { event.preventDefault?.(); } catch { /* 合成事件可能没有 */ }
    try { event.stopImmediatePropagation?.(); } catch { /* 同上 */ }
    return;
  }
}

function install() {
  if (installed) return;
  installed = true;
  try { window.addEventListener("keydown", onKeyDown); } catch { /* 非浏览器环境（测试）由调用方自己喂事件 */ }
}

/** 注册一层；返回移除函数（组件卸载时调用）。 */
export function pushEscapeLayer(handler) {
  install();
  const entry = { handler };
  layers.push(entry);
  return () => {
    const index = layers.indexOf(entry);
    if (index >= 0) layers.splice(index, 1);
  };
}

/** 诊断/测试：当前层数与顺序（只读快照）。 */
export function escapeLayerSnapshot() {
  return layers.map((entry, index) => ({ index }));
}

/** 测试用：直接投喂一个 Esc 事件（不依赖 DOM 监听）。 */
export function dispatchEscapeForTest(event) {
  onKeyDown(event);
}
