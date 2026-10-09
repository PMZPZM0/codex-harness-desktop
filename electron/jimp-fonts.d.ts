/**
 * `jimp/fonts` 的环境声明（2026-10-09）。
 *
 * 为什么需要：本仓 electron 侧用 `moduleResolution: "Node"`（node10 口径），**不认 package.json
 * 的 exports 映射** —— jimp 的字体规格子路径 `jimp/fonts` 因此解析不到类型（TS2307），
 * 而运行时 `require("jimp/fonts")` 完全正常（commonjs 条件）—— 属于"能跑但过不了 tsc"。
 * ⛔ 不动全局 moduleResolution（会波及全仓既有代码），只给这一个子路径补类型面。
 */
declare module "jimp/fonts" {
  export const SANS_8_BLACK: string;
  export const SANS_10_BLACK: string;
  export const SANS_12_BLACK: string;
  export const SANS_14_BLACK: string;
  export const SANS_16_BLACK: string;
  export const SANS_32_BLACK: string;
  export const SANS_64_BLACK: string;
  export const SANS_128_BLACK: string;
  export const SANS_8_WHITE: string;
  export const SANS_16_WHITE: string;
  export const SANS_32_WHITE: string;
  export const SANS_64_WHITE: string;
  export const SANS_128_WHITE: string;
}
