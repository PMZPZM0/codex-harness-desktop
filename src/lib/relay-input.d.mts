/** 登录/注册输入净化（`src/lib/relay-input.mjs`）的类型声明。
 *  ⛔ 与 .mjs 同目录同基名，否则 `import ... from "./relay-input.mjs"` 会退化成 any。 */

/** 是否含全角字符（U+FF01–U+FF5E / U+3000）。 */
export declare function hasFullWidth(value: unknown): boolean;

/** 是否含零宽、方向控制等不可见字符。 */
export declare function hasInvisible(value: unknown): boolean;

/** 全角 → 半角。 */
export declare function toHalfWidth(value: unknown): string;

/** 凭据净化：全角→半角、去不可见字符、去首尾空白（不动中间的字符）。 */
export declare function normalizeCredential(value: unknown): string;

/** 给用户看的一句话；没有任何改动时返回空串。 */
export declare function describeCredentialFix(raw: unknown): string;

/** 站点回复「邮箱或密码不对」时，拼出可操作的中文提示（含网关主机名）。 */
export declare function credentialRejectedHint(rawMessage: unknown, host?: string): string;
