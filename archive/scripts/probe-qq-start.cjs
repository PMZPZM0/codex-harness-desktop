// 直接调用编译产物 qqQrStart（绕开 UI），带 8s 超时看它到底卡在哪
const { qqQrStart, qqQrSnapshot } = require("../dist-electron/qq-qr-connect.js");
const timer = setTimeout(() => {
  console.log("TIMEOUT after 8s — snapshot at that moment:", JSON.stringify(qqQrSnapshot()));
  process.exit(2);
}, 8000);
const started = Date.now();
qqQrStart(async () => ({ name: "test-bot" }), async (text) => "<svg>test</svg>").then((snap) => {
  clearTimeout(timer);
  console.log("qqQrStart returned in", Date.now() - started, "ms:", JSON.stringify(snap).slice(0, 200));
  process.exit(0);
}).catch((e) => { clearTimeout(timer); console.log("REJECTED:", e.message); process.exit(1); });
