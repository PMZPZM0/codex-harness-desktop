/**
 * Office 文档内嵌预览（11-02）：docx / xlsx / pptx 都是 ZIP + XML，零依赖解析。
 *
 * 目标不是像素级还原（那需要重型排版引擎），而是**在右栏直接看懂内容**：
 *   · docx → 段落文本（保留空行/换行）
 *   · xlsx → 表格（第一张工作表，300 行 × 40 列上限）
 *   · pptx → 按页列出标题与正文（50 页上限）
 * ⛔ 不引第三方库：只要文本/表格，mammoth/sheetjs/pptx 渲染库都是几百 KB 的依赖面。
 * ⛔ 解析器拆成纯函数（xml 字符串 → 结构），守卫可直接跑真值表。
 */

import { parseDelimited as parseDelimitedCsv } from "./csv-preview.mjs";

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXmlText(value) {
  return String(value ?? "").replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (all, code) => {
    const key = String(code).toLowerCase();
    if (key.startsWith("#x")) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCodePoint(parseInt(key.slice(1), 10));
    return XML_ENTITIES[key] ?? all;
  });
}

const textOfTags = (xml, tag) => {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out = [];
  let match;
  while ((match = re.exec(xml))) out.push(decodeXmlText(match[1]));
  return out;
};

/** DOCX：word/document.xml → 段落数组。 */
export function parseDocxXml(xml, maxParagraphs = 600, maxChars = 60_000) {
  const paragraphs = [];
  const re = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/gi;
  let match;
  let total = 0;
  while ((match = re.exec(String(xml ?? ""))) && paragraphs.length < maxParagraphs && total < maxChars) {
    const body = match[1];
    const runs = [];
    const runRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/gi;
    let run;
    while ((run = runRe.exec(body))) {
      if (run[0].startsWith("<w:tab")) runs.push("\t");
      else if (run[0].startsWith("<w:br")) runs.push("\n");
      else runs.push(decodeXmlText(run[1]));
    }
    const text = runs.join("").trimEnd();
    total += text.length;
    if (text.trim()) paragraphs.push(text);
  }
  return { kind: "doc", paragraphs, truncated: total >= maxChars || paragraphs.length >= maxParagraphs };
}

function sharedStringsOf(xml) {
  const out = [];
  const re = /<si>([\s\S]*?)<\/si>/gi;
  let match;
  while ((match = re.exec(String(xml ?? "")))) out.push(textOfTags(match[1], "t").join(""));
  return out;
}

function columnIndex(ref) {
  const letters = /^([A-Z]+)/i.exec(String(ref ?? ""))?.[1] ?? "";
  let value = 0;
  for (const ch of letters.toUpperCase()) value = value * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, value - 1);
}

/** XLSX：工作表 XML + 共享字符串 → 表格。 */
export function parseXlsxXml(sheetXml, sharedXml, sheetName = "Sheet1", maxRows = 300, maxCols = 40) {
  const shared = sharedStringsOf(sharedXml);
  const rows = [];
  let truncated = false;
  const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(String(sheetXml ?? ""))) && rows.length < maxRows) {
    const cells = [];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
    let cell;
    while ((cell = cellRe.exec(rowMatch[1]))) {
      const attrs = cell[1] || "";
      const ref = /\br="([^"]+)"/.exec(attrs)?.[1] ?? "";
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "";
      const body = cell[2] || "";
      let value = "";
      if (type === "inlineStr") value = textOfTags(body, "t").join("");
      else {
        const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i.exec(body)?.[1] ?? "";
        value = type === "s" ? (shared[Number(raw)] ?? "") : decodeXmlText(raw);
      }
      const col = columnIndex(ref);
      if (col < maxCols) cells[col] = value;
      else truncated = true;
    }
    rows.push(Array.from({ length: Math.min(maxCols, Math.max(1, cells.length)) }, (_, i) => cells[i] ?? ""));
  }
  const cols = Math.max(0, ...rows.map((r) => r.length));
  return { kind: "sheet", sheetName, rows, cols, truncated: truncated || rows.length >= maxRows };
}

/** PPTX：按 slideN.xml 排序 → 每页标题 + 正文行。 */
export function parsePptxSlides(slides, maxSlides = 50, maxChars = 40_000) {
  const list = [...slides]
    .sort((a, b) => (Number((a.name.match(/slide(\d+)/i) ?? [])[1]) || 0) - (Number((b.name.match(/slide(\d+)/i) ?? [])[1]) || 0))
    .slice(0, maxSlides)
    .map(({ name, xml }) => {
      const lines = textOfTags(xml, "a:t").map((line) => line.trim()).filter(Boolean);
      return { name, title: lines[0] ?? "", lines: lines.slice(1) };
    });
  const total = list.reduce((sum, slide) => sum + slide.title.length + slide.lines.join("").length, 0);
  return { kind: "slides", slides: list, truncated: total >= maxChars || slides.length > maxSlides };
}

/* ── ZIP 读取（中央目录 + local header；store / deflate）────────────────── */
function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("不是有效的 Office 文件（找不到 ZIP 目录）");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    entries.push({ name, method, compressedSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return { view, entries };
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(bytes, view, entry) {
  const at = entry.localOffset;
  if (view.getUint32(at, true) !== 0x04034b50) throw new Error("ZIP 局部头损坏");
  const nameLen = view.getUint16(at + 26, true);
  const extraLen = view.getUint16(at + 28, true);
  const start = at + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error(`不支持的压缩方式 ${entry.method}`);
  return inflateRaw(raw);
}

/** 读 zip 里指定的几个文件（不存在的跳过）。 */
export async function readZipFiles(bytes, names) {
  const { view, entries } = zipEntries(bytes);
  const wanted = new Set(names);
  const out = new Map();
  for (const entry of entries) {
    if (!wanted.has(entry.name)) continue;
    out.set(entry.name, await readEntry(bytes, view, entry));
  }
  return out;
}

/** 入口：按扩展名解析 Office 字节。返回 doc/sheet/slides 结构。 */
export async function parseOfficeBytes(bytes, ext) {
  const e = String(ext ?? "").toLowerCase();
  if (e === "docx") {
    const files = await readZipFiles(bytes, ["word/document.xml"]);
    const xml = files.get("word/document.xml");
    if (!xml) throw new Error("缺少 word/document.xml");
    return parseDocxXml(new TextDecoder().decode(xml));
  }
  if (e === "xlsx" || e === "csv" || e === "tsv") {
    if (e === "csv" || e === "tsv") {
      const text = new TextDecoder().decode(bytes);
      const { rows, cols, truncated } = parseDelimitedCsv(text, e === "tsv" ? "\t" : ",");
      return { kind: "sheet", sheetName: e.toUpperCase(), rows, cols, truncated };
    }
    const files = await readZipFiles(bytes, ["xl/worksheets/sheet1.xml", "xl/sharedStrings.xml", "xl/workbook.xml"]);
    const sheet = files.get("xl/worksheets/sheet1.xml");
    if (!sheet) throw new Error("缺少 xl/worksheets/sheet1.xml");
    const nameMatch = /<sheet\b[^>]*\bname="([^"]+)"/i.exec(new TextDecoder().decode(files.get("xl/workbook.xml") ?? new Uint8Array()));
    return parseXlsxXml(new TextDecoder().decode(sheet), new TextDecoder().decode(files.get("xl/sharedStrings.xml") ?? new Uint8Array()), decodeXmlText(nameMatch?.[1] ?? "Sheet1"));
  }
  if (e === "pptx") {
    const { entries } = zipEntries(bytes);
    const names = entries.map((entry) => entry.name).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name));
    const files = await readZipFiles(bytes, names);
    return parsePptxSlides(names.map((name) => ({ name, xml: new TextDecoder().decode(files.get(name) ?? new Uint8Array()) })));
  }
  throw new Error(`不支持的 Office 格式：${e || "未知"}`);
}

/** 是否是本模块能内嵌预览的 Office 扩展名。 */
export function isOfficePreviewExt(ext) {
  return ["docx", "xlsx", "pptx"].includes(String(ext ?? "").toLowerCase());
}
