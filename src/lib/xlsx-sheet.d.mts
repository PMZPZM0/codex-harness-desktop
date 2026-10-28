/** 表格 → .xlsx（零依赖，store ZIP）。见 xlsx-sheet.mjs 的说明。
 *  ⛔ 返回类型写成 `Uint8Array<ArrayBuffer>`：`new Blob([...])` 只接受 ArrayBuffer 支撑的视图，
 *     默认的 `Uint8Array<ArrayBufferLike>` 会在 TS 5.9 下报 TS2322。 */
export declare function tableToXlsx(rows: string[][]): Uint8Array<ArrayBuffer>;
export declare function xlsxFileName(now?: Date): string;
