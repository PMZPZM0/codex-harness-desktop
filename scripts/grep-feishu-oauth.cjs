// 深挖：飞书 OAuth 授权流程（accounts.feishu.cn /oauth/v1/app/registration + buildAuthorizeUrl）
const t = require("fs").readFileSync("tmp-zcode-asar/host-index.js", "utf8");
function around(keyword, span = 700, count = 2) {
  const re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  const m = [...t.matchAll(re)];
  console.log(`\n===== ${keyword} (${m.length}) =====`);
  for (const hit of m.slice(0, count)) {
    const s = Math.max(0, hit.index - 200);
    console.log(t.slice(s, hit.index + span).replace(/\s+/g, " "));
    console.log("---");
  }
}
around("buildAuthorizeUrl", 900, 2);
around("oauth/v1/app/registration", 600, 2);
around("device", 300, 3);
