/**
 * QQ 机器人网关守卫（11-03 用户：「QQ 机器人连接不上」）。
 *
 * 根因：token 接口写在了 api.sgroup.qq.com（404「不支持的调用」）——官方 2026 文档的
 * 统一地址是 https://api.bot.qq.com。连同四个连带缺陷一起钉住：
 *   ① token/gateway/消息统一走 api.bot.qq.com；
 *   ② 账号落盘跟随 userData（自定义配置目录用户重启才恢复得了）；
 *   ③ 重复 connect 先摘旧 socket（否则双 WS、消息双份）；
 *   ④ op9 鉴权拒绝要报错并重连（否则「看着连着、实际收不到」）；
 *   ⑤ hasSession 以 socket 真实 open 为准，不是「对象存在」。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = readFileSync(join(ROOT, "electron", "qq-gateway.ts"), "utf8");
let checks = 0;
let fails = 0;
const ok = (cond, msg) => { checks += 1; console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails += 1; };

ok(/const API = "https:\/\/api\.bot\.qq\.com"/.test(src) && !/"https:\/\/api\.sgroup\.qq\.com"/.test(src),
  "token/gateway/消息统一走 api.bot.qq.com（sgroup 的 token 接口是 404）");
ok(/app\.getPath\("userData"\), "qq-account\.json"/.test(src) && !/const STATE_FILE/.test(src),
  "账号落盘跟随 userData（自定义配置目录也能恢复）");
ok(/this\.detachSocket\(\);\s*\/\/ ⛔ 重复连接/.test(src) && /private detachSocket\(\)/.test(src)
  && /removeAllListeners\(\); this\.ws\.close\(\)/.test(src),
  "connect/logout 先摘旧 socket（摘监听再关，防止 close 触发重连把旧连接拉回来）");
ok(/case 9: \/\/ Invalid Session/.test(src) && /QQ 会话鉴权被拒（op9）/.test(src),
  "op9 鉴权拒绝要报错并重连（不能「看着连着、实际收不到」）");
ok(/private socketReady = false/.test(src) && /hasSession\(\) \{ return this\.socketReady; \}/.test(src)
  && /on\("open", \(\) => \{ this\.socketReady = true; \}\)/.test(src),
  "hasSession 以 socket 真实 open 为准");
ok(/if \(error\?\.code === "ENOENT"\) return false;/.test(src),
  "没绑过 QQ 的自动恢复静默返回（不刷 channel-log 错误）");
ok(/if \(!response\.ok \|\| !res\.access_token\)/.test(src),
  "token 请求检查 HTTP 状态（404/5xx 不再被吞成「没有 access_token」）");

console.log(fails ? `\n【qq-gateway】失败 ${fails} 项` : `\n【qq-gateway】通过 ${checks} 项`);
process.exit(fails ? 1 : 0);
