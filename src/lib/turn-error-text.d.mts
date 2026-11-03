/** turn-error-text.mjs 的类型面（实现是未检查的 .mjs，见 src/lib/*.mjs 范式）。 */

export interface TurnErrorText {
  /** 一行的标题，直接当 toast / 消息首行用。 */
  title: string;
  /** 可执行的说明，已截到 300 字内。 */
  detail: string;
}

export declare function describeTurnError(raw: unknown): TurnErrorText;
