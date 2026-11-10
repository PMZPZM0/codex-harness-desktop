/* 把开源客户端的 main 面挂到独立画布里（宿主插槽的最小适配）。 */
(function () {
  const el = document.getElementById("root");
  const fatal = (message) => {
    el.innerHTML = '<pre id="md-fatal"></pre>';
    document.getElementById("md-fatal").textContent = message;
  };
  const mod = window.__mdModule;
  if (!mod || typeof mod.apply !== "function") return fatal("客户端模块没有导出 apply()");
  const ctx = {
    get() { return undefined; },
    effect(fn) { try { const d = fn(); return typeof d === "function" ? d : () => {}; } catch (e) { console.error("[media-desk] effect", e); return () => {}; } },
    slots: {
      inject(_name, cb) { try { const d = cb(); return typeof d === "function" ? d : () => {}; } catch (e) { console.error("[media-desk] inject", e); return () => {}; } },
      register(config, component) {
        if (config && config.name === "main") window.__mdMain = component;
        return () => {};
      },
    },
  };
  try { mod.apply(ctx); } catch (e) { return fatal("启动失败：" + (e && e.message || e)); }
  const React = window.MDReact.React;
  if (!window.__mdMain) return fatal("没有注册主界面");
  window.MDReact.createRoot(el).render(React.createElement(window.__mdMain));
})();
