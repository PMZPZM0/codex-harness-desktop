/**
 * 「朗读视图」文本层（审计 ②）：把 **给人看** 的 markdown 正文，转成 **给耳朵听** 的口语文本。
 *
 * 为什么需要它：通话轮只吃 `item/agentMessage/delta` 的增量（AGENTS.md 明令不复用
 * `BotStreamSession`），正文里的 markdown 记号、代码块、URL、路径、emoji 会被 TTS
 * **原样念出来** —— 代码块逐行念、`**粗体**` 念出星号、链接念出一长串 URL，
 * 一条带代码的回复能多念几十秒。字幕（屏幕上的「回复」区）仍然显示**原文**，
 * 只有送进 TTS 的那一份经过这里。
 *
 * 分层（顺序不能变）：
 *   ① 块级状态机 `createSpeakFilter()`：代码围栏 / 表格整段丢弃，只留一句占位提示
 *      —— 必须跨句保持状态，因为围栏与句子的边界并不重合（断句器在 `\n` 处切开，
 *      ```` ```ts ```` 那一行会单独成句）；
 *   ② 行内清洗 `toSpeakableText()`：markdown 记号 / 链接 / URL / 路径 / emoji；
 *   ③ 数字日期中文化：`2026-09-13` → `二零二六年九月十三日`、
 *      `12:30` → `十二点三十分`、`3.5` → `三点五`（紧贴 ASCII 字母数字的
 *      `GPT-4`/`utf8`/`v2` 一律不动，避免把标识符念成中文数字）。
 *
 * 纯函数 + 纯状态机，零依赖：`scripts/check-preflight.mjs` 直接 import 跑断言。
 */

/** 代码围栏：``` 或 ~~~，允许带语言标注与缩进 */
const FENCE_RE = /^\s*(`{3,}|~{3,})/;
/** 表格行：GFM 用 | 分隔，表头下一行是 |---| 分隔行 */
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

/** CJK 标点结尾（判断拼接时要补什么停顿） */
const END_PUNCT_RE = /[。！？!?；;，,、：:…]$/;

/**
 * 单个字符是否属于「念出来只会是噪音」的符号：
 * emoji（含 ZWJ 组合、变体选择符、肤色修饰、旗帜、keycap）与零宽控制符。
 * 用码点区间判断，避免写一个巨大的正则字面量。
 */
function isNoiseSymbol(cp) {
  if (cp === 0x200d || cp === 0xfe0f || cp === 0xfe0e) return true; // ZWJ / 变体选择符
  if (cp >= 0x2190 && cp <= 0x21ff) return true; // 箭头
  if (cp >= 0x2300 && cp <= 0x23ff) return true; // 技术符号（⌘ ⏳ …）
  if (cp >= 0x2460 && cp <= 0x24ff) return true; // 带圈数字
  if (cp >= 0x25a0 && cp <= 0x27bf) return true; // 几何图形 / 勾叉 / 星星
  if (cp >= 0x2b00 && cp <= 0x2bff) return true;
  if (cp >= 0x1f000 && cp <= 0x1faff) return true; // emoji 主体
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return true; // 区域指示符（国旗）
  if (cp >= 0xe0000 && cp <= 0xe007f) return true; // 标签（keycap）
  return false;
}

/** 去掉 emoji 与零宽符号（保留普通标点与中英文） */
export function stripNoiseSymbols(text) {
  let out = "";
  for (const ch of String(text ?? "")) {
    if (!isNoiseSymbol(ch.codePointAt(0))) out += ch;
  }
  return out;
}

const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const CN_UNITS = ["", "十", "百", "千"];
const CN_SECTIONS = ["", "万", "亿"];

/**
 * 整数 → 中文读数（0..999999999999）。
 * 规则按口语习惯：`10` → 十（不是一十）、`105` → 一百零五、`1024` → 一千零二十四、
 * `20005` → 二万零五。给 TTS 用，不需要考虑「两」这类量词变体。
 */
export function numberToChinese(value) {
  let n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "零";
  const negative = n < 0;
  n = Math.abs(n);
  if (n > 999999999999) return String(value);

  const sections = [];
  let rest = n;
  while (rest > 0) {
    sections.push(rest % 10000);
    rest = Math.floor(rest / 10000);
  }

  let out = "";
  for (let s = sections.length - 1; s >= 0; s--) {
    const part = sections[s];
    // 整段为零：直接跳过（零由下一段的「段内不足千」规则补，不能在这里无脑补）
    if (part === 0) continue;
    let chunk = "";
    let zeroPending = false;
    for (let unit = 3; unit >= 0; unit--) {
      const digit = Math.floor(part / Math.pow(10, unit)) % 10;
      if (digit === 0) {
        if (chunk) zeroPending = true;
        continue;
      }
      if (zeroPending) {
        chunk += "零";
        zeroPending = false;
      }
      // 十位的一不念：一十五 → 十五
      chunk += digit === 1 && unit === 1 && !chunk ? "十" : CN_DIGITS[digit] + CN_UNITS[unit];
    }
    // 非最高段且不足千位 → 中间要补零：20005 → 二万零五（不能念成「二万五」）
    if (out && part < 1000 && !out.endsWith("零")) out += "零";
    out += chunk + CN_SECTIONS[s];
  }
  return (negative ? "负" : "") + out;
}

/** 逐位念（年份、编号用）：2026 → 二零二六；仅用于明确的年份语境 */
function yearToChinese(year) {
  return String(year)
    .split("")
    .map((d) => CN_DIGITS[Number(d)] ?? d)
    .join("");
}

/** 小数：3.5 → 三点五（小数部分逐位念） */
function decimalToChinese(intPart, fracPart) {
  const frac = fracPart
    .split("")
    .map((d) => CN_DIGITS[Number(d)] ?? d)
    .join("");
  return `${numberToChinese(intPart)}点${frac}`;
}

/**
 * 数字是否紧贴「标识符」：
 * 前面是字母数字或 `- _ . + # /`（GPT-4 / v2 / H264 / 1.2.3 / 端口/路径片段），
 * 后面是字母数字或 `.`（版本号 `1.2.3`）—— 命中就**不转换**，念原样也比念错强。
 */
function boundByWord(text, start, end) {
  const before = start > 0 ? text[start - 1] : "";
  const after = end < text.length ? text[end] : "";
  return /[A-Za-z0-9_.\-+#/]/.test(before) || /[A-Za-z0-9_.]/.test(after);
}

/**
 * 数字日期中文化（③）。**只处理中文语境里的裸数字**：
 * 日期 → 年月日；时间 → 点分；小数 → 点；整数 → 中文读数；百分比 → 百分之。
 * 紧贴 ASCII 字母数字的一律跳过（标识符/型号/版本号）。
 */
export function normalizeNumbers(text) {
  let out = String(text ?? "");

  // 日期：2026-09-13 / 2026/9/3 → 二零二六年九月十三日（年份逐位念）
  // ⚠️ 顺序不能挪到「区间」之后：`2026-09-13` 会被区间规则吃成「2026到09到13」。
  out = out.replace(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?![\d-])/g, (m, y, mo, d) => {
    const month = Number(mo);
    const day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return m;
    return `${yearToChinese(y)}年${numberToChinese(month)}月${numberToChinese(day)}日`;
  });

  // 时间：12:30 / 9:05（避免误伤 1:2 这类比例：要求两位分钟）
  out = out.replace(/(\d{1,2}):(\d{2})(?![\d:])/g, (m, h, mi) => {
    const hour = Number(h);
    if (hour > 23) return m;
    return `${numberToChinese(hour)}点${mi === "00" ? "整" : `${numberToChinese(Number(mi))}分`}`;
  });

  // 数值区间：3-5 / 3~5 → 3到5（两侧都必须是数字，
  // 所以 GPT-4、H264 这类「字母-数字」不会被卷进来）
  out = out.replace(/(\d)\s*[-~～]\s*(\d)/g, "$1到$2");

  // 小数：3.5 → 三点五（保留一位以上小数位；3.5.1 版本号不动：后面还有点就跳过）
  out = out.replace(/(\d+)\.(\d+)(?![\d.])/g, (m, int, frac, offset, whole) => {
    if (boundByWord(whole, offset, offset + m.length)) return m;
    return decimalToChinese(int, frac);
  });

  // 百分比：50% → 百分之五十（先于整数处理）
  out = out.replace(/(\d+)%/g, (m, num, offset, whole) => {
    if (boundByWord(whole, offset, offset + m.length)) return m;
    return `百分之${numberToChinese(num)}`;
  });

  // 整数（可带千分位逗号）：1,234 → 一千二百三十四
  out = out.replace(/\d{1,3}(?:,\d{3})+|\d+/g, (m, offset, whole) => {
    const plain = m.replace(/,/g, "");
    if (boundByWord(whole, offset, offset + m.length)) return m;
    // 超过 12 位（时间戳/UUID 片段）逐位念反而是灾难，保持原样
    if (plain.length > 12) return m;
    return numberToChinese(plain);
  });

  return out;
}

/** URL / 路径 / 邮箱 → 短口播词（念 URL 一个字符一个字符地念，纯噪音） */
function replaceLocators(text) {
  let out = text;
  // 图片与链接：[文字](地址) → 文字；裸图片 → 空
  out = out.replace(/!\[([^\]]*)\]\([^)\s]*\)/g, (_m, alt) => (alt ? `${alt}` : ""));
  out = out.replace(/\[([^\]]+)\]\([^)\s]*\)/g, "$1");
  // 裸 URL / 邮箱
  out = out.replace(/\bhttps?:\/\/\S+/gi, "链接");
  out = out.replace(/\bwww\.[^\s，。；、）)]+/gi, "链接");
  out = out.replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "邮箱");
  // Windows 路径 / UNC：C:\Users\me\a.ts → 路径
  out = out.replace(/\b[A-Za-z]:\\[^\s，。；、）)]*/g, "路径");
  out = out.replace(/\\\\[^\s，。；、）)]+/g, "路径");
  // 类 Unix 路径：至少两级斜杠才认（避免误伤 and/or 这类写法）
  out = out.replace(/(?:^|(?<=[\s（(：:，,、]))(?:\.{0,2}\/)?[\w.@-]+(?:\/[\w.@-]+){2,}\/?/g, "路径");
  return out;
}

/** 行内 markdown 记号清洗（`m` 标志：多行文本每行都要洗） */
function stripInlineMarkdown(line) {
  let out = line;
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, ""); // 标题
  out = out.replace(/^\s{0,3}>\s?/gm, ""); // 引用
  out = out.replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, ""); // 列表记号
  out = out.replace(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, ""); // 分隔线
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  out = out.replace(/__([^_]+)__/g, "$1");
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, "$1$2");
  out = out.replace(/(^|[^_\w])_([^_\n]+)_(?=[^_\w]|$)/g, "$1$2");
  out = out.replace(/~~([^~]+)~~/g, "$1");
  out = out.replace(/`([^`]+)`/g, "$1");
  out = out.replace(/[`*_~]/g, ""); // 落单的记号
  return out;
}

/**
 * 单段文本 → 口播文本（无跨句状态，块级交给 `createSpeakFilter`）。
 * 返回空串 = 这段没什么可念的（调用方应跳过，不要合成空音频）。
 */
export function toSpeakableText(raw) {
  let out = stripInlineMarkdown(String(raw ?? ""));
  out = replaceLocators(out);
  out = stripNoiseSymbols(out);
  out = normalizeNumbers(out);
  // 折叠空白：换行/制表 → 空格，连续空白 → 单空格
  out = out.replace(/[\t\r\n]+/g, " ").replace(/ {2,}/g, " ");
  // 中文之间不留空格（数字中文化之后会留下「第 一千二百三十四 行」这种缝）
  out = out.replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "");
  out = out.replace(/\s+([，。！？；：、）】》])/g, "$1");
  out = out.replace(/([（【《])\s+/g, "$1");
  return out.trim();
}

/**
 * 跨句过滤器：断句器按 `\n` 切句，而代码围栏 / 表格要整段丢，
 * 所以状态必须活在「句与句之间」。
 *
 * 用法：每个回合建一个（打断/换轮时重建），每句 `push(sentence)`，
 * 返回空串就跳过这一句（不调用 TTS）。
 */
export function createSpeakFilter(options = {}) {
  /** 代码块占位提示（可关：options.codeNotice = "" 就彻底静默） */
  const codeNotice = options.codeNotice ?? "（代码块已跳过，请看屏幕）";
  const tableNotice = options.tableNotice ?? "（表格已跳过，请看屏幕）";
  let inFence = false;
  let fenceLines = 0;
  let fenceNoted = false;
  let inTable = false;
  let tableNoted = false;

  const reset = () => {
    inFence = false;
    fenceLines = 0;
    fenceNoted = false;
    inTable = false;
    tableNoted = false;
  };

  return {
    reset,
    get inCodeBlock() {
      return inFence;
    },
    /** @param {string} chunk 断句器吐出来的一句（可能含多行） */
    push(chunk) {
      const text = String(chunk ?? "");
      if (!text) return "";
      const kept = [];
      for (const line of text.split("\n")) {
        if (FENCE_RE.test(line)) {
          if (inFence) {
            // 围栏结束：整块只留一句占位，行数就不念了（数字念出来是噪音）
            inFence = false;
            fenceLines = 0;
            if (!fenceNoted && codeNotice) {
              kept.push(codeNotice);
              fenceNoted = true;
            }
          } else {
            inFence = true;
            fenceLines = 0;
            fenceNoted = false;
          }
          continue;
        }
        if (inFence) {
          fenceLines += 1;
          continue;
        }
        if (TABLE_ROW_RE.test(line)) {
          inTable = true;
          if (!tableNoted && tableNotice) {
            kept.push(tableNotice);
            tableNoted = true;
          }
          continue;
        }
        if (inTable) {
          // 表格结束（遇到非表格行）：这一行按普通文本继续处理
          inTable = false;
          tableNoted = false;
        }
        const clean = toSpeakableText(line);
        if (clean) kept.push(clean);
      }
      if (!kept.length) return "";
      // 多行合并成一句：上一段没有句末标点就补一个逗号，避免连读成一坨
      let out = kept[0];
      for (let i = 1; i < kept.length; i++) {
        if (!END_PUNCT_RE.test(out)) out += "，";
        out += kept[i];
      }
      return out.trim();
    },
  };
}
