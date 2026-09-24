// 在 host-index.js 里搜飞书扫码/授权相关代码段
const t = require("fs").readFileSync("tmp-zcode-asar/host-index.js", "utf8");
const keys = ["qrconnect", "qr_connect", "scan", "qrcode", "QrCode", "authorize", "auth_url", "redirect_uri", "app_access_token", "tenant_access_token", "im:message", "ws://", "wss://", "open.feishu", "feishu.cn", "larksuite"];
for (const k of keys) {
  const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const m = [...t.matchAll(re)];
  if (m.length) {
    console.log(`\n===== ${k} (${m.length}) =====`);
    for (const hit of m.slice(0, 3)) {
      const s = Math.max(0, hit.index - 120);
      console.log(t.slice(s, hit.index + 200).replace(/\s+/g, " ").slice(0, 300));
      console.log("---");
    }
  }
}
