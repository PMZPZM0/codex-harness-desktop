/** cloud-links.mjs 的类型面（实现是未检查的 .mjs，见 src/lib/*.mjs 范式）。 */

/** 账号服务基址 → 云端用户中心 URL；基址为空时返回空串（调用方据此不渲染入口）。 */
export declare function cloudUserCenterUrl(accountsBase?: unknown): string;
