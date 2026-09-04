// 验证 ponytail 模式读写
const m = require("D:/Codex Harness Desktop/electron/ponytail-mode.js");
(async () => {
  console.log("current mode:", await m.getPonytailMode());
  await m.setPonytailMode("off");
  console.log("after set off:", await m.getPonytailMode());
  await m.setPonytailMode("full");
  console.log("after set full:", await m.getPonytailMode());
  process.exit(0);
})();
