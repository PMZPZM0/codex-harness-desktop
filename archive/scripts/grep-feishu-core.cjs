// 深挖飞书连接核心：_U 注册函数 + 飞书 bot 事件订阅（长连接 ws）+ appId 来源
const t = require("fs").readFileSync("tmp-zcode-asar/host-index.js", "utf8");
function around(keyword, span = 900, count = 2) {
  const re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  const m = [...t.matchAll(re)];
  console.log(`\n===== ${keyword} (${m.length}) =====`);
  for (const hit of m.slice(0, count)) {
    const s = Math.max(0, hit.index - 150);
    console.log(t.slice(s, hit.index + span).replace(/\s+/g, " ").slice(0, 1000));
    console.log("---");
  }
}
around("_U(", 500, 1);           // app registration 请求体
around("feishuAppId", 400, 3);   // appId 配置来源
around('import*as ca from"@larksuiteoapi/node-sdk"', 800, 1); // 飞书 SDK 用法（WS 长连接）
