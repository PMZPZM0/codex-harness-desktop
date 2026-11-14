/**
 * 配对应答签名（11-14 安全加固）
 *
 * 为什么需要：中转网关的「根地址配对」会逐台在线设备问 6 位码。11-14 实测有两个
 * 测试假隧道挂在公网中转上，不校验码就直接回 ok:true ⇒ 手机被它们秒批、真正的
 * 电脑端应用收不到配对请求、永远不弹「允许」框。
 *
 * 做法：电脑端用**隧道令牌派生**的 HMAC 键给 `/api/pair`、`/api/pair-status` 的应答正文签名，
 * 网关用 hello 帧里拿到的同一个令牌派生同样的键去验；签名不对的应答一律丢弃。
 * 假隧道即使能连上（现在还会被设备 ID 格式挡住），也伪造不出有效签名。
 *
 * ⛔ 令牌本身不出本模块：只暴露派生键与签名结果，不打日志、不写盘。
 * ⛔ 键的派生盐必须与 `scripts/relay-gateway.mjs` 的 PAIR_SIGN_SALT 逐字一致（守卫钉住）。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PAIR_SIGN_SALT = ":pair-response:v1";
const cache = new Map<string, string>();

/** 从 `<userData>/relay-device.json` 的隧道令牌派生签名键（hex）；文件缺失/损坏返回空串（LAN 模式不签名）。
 *  ⛔ 只有**非空**结果才进缓存：首次调用若发生在隧道写盘之前，缓存空串会让本进程永久不签名
 *    （配对应答全被网关当假隧道丢弃，且只能重启恢复）。 */
export function pairSignKey(userData: string): string {
  if (!userData) return "";
  const file = path.join(userData, "relay-device.json");
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  let key = "";
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const token = String(raw?.token ?? "");
    if (token.length >= 32) key = crypto.createHash("sha256").update(token + PAIR_SIGN_SALT).digest("hex");
  } catch { /* 没有隧道身份：不签名 */ }
  if (key) cache.set(file, key);
  return key;
}

/** 给配对应答正文算 HMAC-SHA256（hex）；没有键时返回空串，调用方据此不加签名头。 */
export function signPairBody(userData: string, body: string): string {
  const key = pairSignKey(userData);
  return key ? crypto.createHmac("sha256", key).update(body).digest("hex") : "";
}
