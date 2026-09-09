// 深挖最后的谜：Wte 注册流程完整段（begin → poll → 凭据落定），这就是"扫码连接"的实现
const t = require("fs").readFileSync("tmp-zcode-asar/host-index.js", "utf8");
const i = t.indexOf('async function Wte(e="feishu")');
console.log(t.slice(i, i + 3500).replace(/\s+/g, " "));
