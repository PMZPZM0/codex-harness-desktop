/**
 * Markdown 表格 → 真正的 .xlsx（零依赖）。
 *
 * ⛔ 为什么手写而不装库：只需要「一张表」，引入 exceljs/xlsx 是几百 KB 的依赖面
 *   （还会带进 eval/警告）。XLSX 的最小合法包 = 6 个 XML + 一个 ZIP；
 *   用 **store（不压缩，method 0）** 写出来，Excel / WPS / Numbers / LibreOffice 都能直接打开，
 *   连 pako 都不需要（CRC32 自己算）。
 *
 * ⛔ 只支持单表 + 内联字符串（inlineStr）：表格导出就这个形态，
 *    不做 sharedStrings / 多 sheet / 公式（真需要时再扩，别提前抽象）。
 */

const encoder = new TextEncoder();

/** CRC32（ZIP 必需；查表法，一次构建）。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 列号 → A / B … AA（1 基）。 */
function columnName(index) {
  let name = "";
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // ⛔ 控制字符会让 Excel 直接判定文件损坏（0x00–0x08/0x0b/0x0c/0x0e–0x1f）
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

/** 字符串化一个单元格：保留换行（Excel 用内联字符串 + 自动换行即可）。 */
function cellValue(raw) {
  return String(raw ?? "").replace(/\r\n?/g, "\n").trim();
}

function sheetXml(rows) {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0) || 1;
  const cols = [];
  for (let c = 0; c < width; c++) {
    const longest = rows.reduce((max, row) => Math.max(max, [...cellValue(row[c])].length), 0);
    cols.push(`<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, Math.max(9, longest + 2))}" customWidth="1"/>`);
  }
  const body = rows.map((row, r) => {
    const cells = row.map((raw, c) => {
      const text = cellValue(raw);
      if (!text) return "";
      const style = r === 0 ? ' s="1"' : "";
      return `<c r="${columnName(c + 1)}${r + 1}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols>${cols.join("")}</cols><sheetData>${body}</sheetData></worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="表格" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;

/** 写一个 stored（method 0）ZIP。 */
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);   // UTF-8 文件名
    view.setUint16(8, 0, true);        // stored
    view.setUint16(10, 0, true);       // time
    view.setUint16(12, 0x21, true);    // date（1980-01-01）
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);

    const entry = new Uint8Array(46 + nameBytes.length);
    const ev = new DataView(entry.buffer);
    ev.setUint32(0, 0x02014b50, true);
    ev.setUint16(4, 20, true);
    ev.setUint16(6, 20, true);
    ev.setUint16(8, 0x0800, true);
    ev.setUint16(10, 0, true);
    ev.setUint16(12, 0, true);
    ev.setUint16(14, 0x21, true);
    ev.setUint32(16, crc, true);
    ev.setUint32(20, data.length, true);
    ev.setUint32(24, data.length, true);
    ev.setUint16(28, nameBytes.length, true);
    ev.setUint16(30, 0, true);
    ev.setUint16(32, 0, true);
    ev.setUint16(34, 0, true);
    ev.setUint16(36, 0, true);
    ev.setUint32(38, 0, true);
    ev.setUint32(42, offset, true);
    entry.set(nameBytes, 46);
    central.push(entry);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const chunk of [...chunks, ...central, end]) { total.set(chunk, at); at += chunk.length; }
  return total;
}

/**
 * @param {string[][]} rows 第一行当表头（加粗）；空行会被跳过
 * @returns {Uint8Array} .xlsx 字节
 */
export function tableToXlsx(rows) {
  const clean = (Array.isArray(rows) ? rows : [])
    .map((row) => (Array.isArray(row) ? row : []).map(cellValue))
    .filter((row) => row.some((cell) => cell.length > 0));
  const safe = clean.length ? clean : [["（空表格）"]];
  return zip([
    ["[Content_Types].xml", CONTENT_TYPES],
    ["_rels/.rels", ROOT_RELS],
    ["xl/workbook.xml", WORKBOOK],
    ["xl/_rels/workbook.xml.rels", WORKBOOK_RELS],
    ["xl/styles.xml", STYLES],
    ["xl/worksheets/sheet1.xml", sheetXml(safe)],
  ]);
}

/** 导出文件名：`表格-20261028-2016.xlsx`（时间只到分钟，重复导出靠系统自动改名）。 */
export function xlsxFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `表格-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.xlsx`;
}
