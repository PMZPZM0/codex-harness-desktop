/**
 * 登录/注册输入的净化与体检（纯函数、零依赖、可真跑）。
 *
 * 为什么要有这一层（10-09 实测得出）：
 *   用户报「登录报 invalid email or password」，但同一套 email+密码用 curl 直打
 *   `POST https://api.pptoken.cc/api/v1/auth/login` 返回 **200**（账号密码完全有效），
 *   应用里的网关地址、IPC 通道参数也都核实无误 ⇒ **差异只可能在"输入的那串字符"上**。
 *   而这类差异几乎都肉眼看不见：
 *     · **中文输入法的全角模式**：`@` 打成 `＠`、字母数字打成全角（`１２３`）——
 *       页面上长得几乎一样，站点按字节比对 ⇒ 一律 INVALID_CREDENTIALS；
 *     · **尾随空格 / 换行**（从微信、记事本、密码管理器粘贴时最常见）；
 *     · **零宽字符**（U+200B 等）随富文本一起粘进来。
 *   ⇒ 提交前统一净化，并把「改了什么」明确告诉用户（静默改会让用户以后更懵）。
 *
 * ⛔ 只做**可逆的字符归一**：不猜、不缩进、不改大小写、不动密码内部结构 ——
 *    密码中间的空格是合法字符，绝不能顺手删掉。
 */

const FULLWIDTH_OFFSET = 0xfee0;
/** 看不见但参与字节比对的字符（零宽、方向控制、BOM）。 */
const INVISIBLE_SOURCE = "[\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2060\\ufeff]";

/** 是否含全角字符（U+FF01–U+FF5E 与全角空格 U+3000）。 */
export function hasFullWidth(value) {
  return /[\uff01-\uff5e\u3000]/.test(String(value ?? ""));
}

/** 是否含零宽/方向控制等不可见字符。 */
export function hasInvisible(value) {
  return new RegExp(INVISIBLE_SOURCE).test(String(value ?? ""));
}

/** 全角 → 半角（U+3000 → 普通空格；U+FF01–U+FF5E 整体左移 0xFEE0）。 */
export function toHalfWidth(value) {
  let out = "";
  for (const ch of String(value ?? "")) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x3000) { out += " "; continue; }
    if (code >= 0xff01 && code <= 0xff5e) { out += String.fromCodePoint(code - FULLWIDTH_OFFSET); continue; }
    out += ch;
  }
  return out;
}

/** 凭据净化：全角→半角、去不可见字符、去首尾空白与换行。**不改动中间的字符**。 */
export function normalizeCredential(value) {
  return toHalfWidth(String(value ?? "")).replace(new RegExp(INVISIBLE_SOURCE, "g"), "").trim();
}

/** 给用户看的一句话（没有任何改动时返回空串，调用方据此决定要不要显示）。 */
export function describeCredentialFix(raw) {
  const source = String(raw ?? "");
  if (!source) return "";
  const notes = [];
  if (hasFullWidth(source)) notes.push("全角字符已转半角");
  if (hasInvisible(source)) notes.push("不可见字符已去除");
  if (source !== source.trim()) notes.push("首尾空白已去除");
  return notes.length ? `已自动修正输入：${notes.join("、")}` : "";
}

/** 站点说「邮箱或密码不对」时，把可操作的话拼出来（含试过的网关主机名）。 */
export function credentialRejectedHint(rawMessage, host) {
  const where = host ? `（${host}）` : "";
  return `中转站登录失败${where}：${rawMessage}。`
    + "这个回复只表示「邮箱在该站点查不到」或「密码不匹配」——"
    + "请先用浏览器在官网登录一次确认；注意中文输入法的全角字符和复制粘贴带进来的空格。";
}
