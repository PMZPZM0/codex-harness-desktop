// 机器人列表接真实连接状态（CRLF 安全）
const fs = require("fs");
let s = fs.readFileSync("src/App.tsx", "utf8");
const EOL = s.includes("\r\n") ? "\r\n" : "\n";

// 1) state
const stAnchor = "  const [ponytailOn, setPonytailOn] = useState(false);";
if (!s.includes(stAnchor)) { console.log("ST ANCHOR MISSING"); process.exit(1); }
if (!s.includes("channelOnline")) {
  s = s.replace(stAnchor, stAnchor + EOL
    + "  // 各渠道真实连接状态（微信/Telegram 网关是否在线）" + EOL
    + "  const [channelOnline, setChannelOnline] = useState<{ weixin: boolean; telegram: boolean }>({ weixin: false, telegram: false });" + EOL
    + "  useEffect(() => { void window.codex.channelsStatus?.().then(setChannelOnline).catch(() => undefined); }, []);");
}

// 2) 圆点
const dotOld = '<span className={"bot-dot " + (bot.enabled ? "on" : "")} />';
if (!s.includes(dotOld)) { console.log("DOT NOT FOUND"); process.exit(1); }
const dotNew = '<span className={"bot-dot " + ((bot.channel === "wechat" && channelOnline.weixin) || (bot.channel === "telegram" && channelOnline.telegram) || (bot.channel !== "wechat" && bot.channel !== "telegram" && bot.enabled) ? "on" : "")} title={(bot.channel === "wechat" ? channelOnline.weixin : bot.channel === "telegram" ? channelOnline.telegram : bot.enabled) ? "已连接" : "未连接"} />';
s = s.replace(dotOld, dotNew);

fs.writeFileSync("src/App.tsx", s);
const check = fs.readFileSync("src/App.tsx", "utf8");
console.log("state:", check.includes("channelOnline"), "| dot:", check.includes("channelOnline.weixin) || (bot.channel"));
