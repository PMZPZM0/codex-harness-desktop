/** 「待处理 · 责任人」标记的正则（⛔ 唯一一份，别在别处再写一条）。 */
export declare const DUTY_MARK_RE: RegExp;
/** 解析标记；没有标记返回 null。 */
export declare function parseDuty(text: string): { owner: string; title: string } | null;
/** 待办去重键（责任人 + 标题前 20 字）。 */
export declare function dutyKeyOf(owner: string, title: string): string;
