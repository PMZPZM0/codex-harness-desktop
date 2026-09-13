/**
 * 把用户填的中文唤醒词，转成 KWS 关键词模型要的**拼音 token 行**（纯逻辑，可预检断言）。
 *
 * ## 为什么需要这一层
 *
 * `sherpa-onnx-kws-zipformer-wenetspeech-3.3M` 的建模单元是**拼音（声母 + 韵母）**，
 * `keywords.txt` 每行长这样（模型自带样例，`@` 后面是关键词名字）：
 *
 * ```
 * x iǎo m ǐ x iǎo m ǐ @小米小米
 * n ǐ h ǎo j ūn g ē @你好军哥
 * x iǎo ài t óng x ué @小爱同学
 * ```
 *
 * 即：**标准汉语拼音**，把开头那串辅音字母作为「声母 token」，其余作为「韵母 token」；
 * 零声母音节（爱 ài、安 ān、儿 ér）整段就是一个 token，用 y/w 拼写的（友 yǒu、文 wén）
 * 按字面拆成 `y ǒu` / `w én`。声调**必须带上**（`iǎo` 与 `iao` 是不同的 token，
 * 韵母表里有 `iǎo` 没有 `iao`）。
 *
 * 我们手上只有**注音**（音色模型的 `lexicon.txt` 里是 `柯 ㄎ ㄜ ˉ` 这种写法），
 * 所以这里做「注音 → 带声调拼音 → 拆声母/韵母 → 用模型的 token 表校验」三步。
 * 对照验证放在预检里：**本模块必须能原样复现模型自带的 8 行 `keywords.txt`**。
 */

/** 注音声母 → 拼音字母 */
const INITIALS: Record<string, string> = {
  "ㄅ": "b", "ㄆ": "p", "ㄇ": "m", "ㄈ": "f",
  "ㄉ": "d", "ㄊ": "t", "ㄋ": "n", "ㄌ": "l",
  "ㄍ": "g", "ㄎ": "k", "ㄏ": "h",
  "ㄐ": "j", "ㄑ": "q", "ㄒ": "x",
  "ㄓ": "zh", "ㄔ": "ch", "ㄕ": "sh", "ㄖ": "r",
  "ㄗ": "z", "ㄘ": "c", "ㄙ": "s",
};

/** 注音韵母（含介音）→ 拼音韵母。**有声母时**用这张表。 */
const FINALS_WITH_INITIAL: Record<string, string> = {
  "ㄚ": "a", "ㄛ": "o", "ㄜ": "e", "ㄝ": "e",
  "ㄞ": "ai", "ㄟ": "ei", "ㄠ": "ao", "ㄡ": "ou",
  "ㄢ": "an", "ㄣ": "en", "ㄤ": "ang", "ㄥ": "eng", "ㄦ": "er",
  "ㄧ": "i", "ㄧㄚ": "ia", "ㄧㄛ": "io", "ㄧㄝ": "ie", "ㄧㄞ": "iai",
  "ㄧㄠ": "iao", "ㄧㄡ": "iu", "ㄧㄢ": "ian", "ㄧㄣ": "in",
  "ㄧㄤ": "iang", "ㄧㄥ": "ing", "ㄧㄥˊ": "ing",
  "ㄨ": "u", "ㄨㄚ": "ua", "ㄨㄛ": "uo", "ㄨㄞ": "uai", "ㄨㄟ": "ui",
  "ㄨㄢ": "uan", "ㄨㄣ": "un", "ㄨㄤ": "uang", "ㄨㄥ": "ong",
  "ㄩ": "ü", "ㄩㄝ": "üe", "ㄩㄢ": "üan", "ㄩㄣ": "ün", "ㄩㄥ": "iong",
};

/** 零声母（没有声母符号）时的拼写规则：注音韵母 → 拼音（含 y/w 与 ü 的写法） */
const FINALS_ZERO_INITIAL: Record<string, string> = {
  "ㄚ": "a", "ㄛ": "o", "ㄜ": "e", "ㄝ": "ê",
  "ㄞ": "ai", "ㄟ": "ei", "ㄠ": "ao", "ㄡ": "ou",
  "ㄢ": "an", "ㄣ": "en", "ㄤ": "ang", "ㄥ": "eng", "ㄦ": "er",
  "ㄧ": "yi", "ㄧㄚ": "ya", "ㄧㄛ": "yo", "ㄧㄝ": "ye", "ㄧㄞ": "yai",
  "ㄧㄠ": "yao", "ㄧㄡ": "you", "ㄧㄢ": "yan", "ㄧㄣ": "yin",
  "ㄧㄤ": "yang", "ㄧㄥ": "ying", "ㄩㄥ": "yong",
  "ㄨ": "wu", "ㄨㄚ": "wa", "ㄨㄛ": "wo", "ㄨㄞ": "wai", "ㄨㄟ": "wei",
  "ㄨㄢ": "wan", "ㄨㄣ": "wen", "ㄨㄤ": "wang", "ㄨㄥ": "weng",
  "ㄩ": "yu", "ㄩㄝ": "yue", "ㄩㄢ": "yuan", "ㄩㄣ": "yun",
};

/** 注音声调 → 拼音声调（0 = 轻声，不标） */
const TONES: Record<string, number> = { "ˉ": 1, "ˊ": 2, "ˇ": 3, "ˋ": 4, "˙": 0, "": 1 };

/** 四个声调的组合字符（先加组合符再 NFC 归一，得到 ǎ/ā/é 这类预组合字） */
const COMBINING = ["", "\u0304", "\u0301", "\u030c", "\u0300"];

/**
 * 把声调标到正确的元音上（标准规则：有 a 标 a，其次 o/e，否则标最后一个元音）。
 * `xiao` + 3 → `xiǎo`；`mi` + 3 → `mǐ`；`jun` + 1 → `jūn`。
 */
function applyTone(pinyin: string, tone: number): string {
  if (!tone) return pinyin;
  const lower = pinyin.toLowerCase();
  let index = lower.indexOf("a");
  if (index < 0) index = lower.indexOf("o");
  if (index < 0) index = lower.indexOf("e");
  if (index < 0) {
    // 没有 a/o/e：标在最后一个元音上（iu → ù？标准是 iù，ui → uì，都符合「最后一个元音」）
    for (let i = lower.length - 1; i >= 0; i--) {
      if ("iuü".includes(lower[i])) { index = i; break; }
    }
  }
  if (index < 0) return pinyin;
  const marked = pinyin.slice(0, index) + pinyin[index] + COMBINING[tone] + pinyin.slice(index + 1);
  return marked.normalize("NFC");
}

export type ZhuyinSyllable = { initial: string; final: string; tone: number; pinyin: string };

/**
 * 注音音节（符号数组，可含声调符号）→ 带声调拼音 + 拆好的声母/韵母。
 * 认不出来（缺声调符号/未知符号）返回 null —— **宁可报错也不要生成错的关键词行**：
 * 错的关键词行不会报错，只会「永远唤不醒」，比报错难查得多。
 */
export function zhuyinToSyllable(symbols: string[]): ZhuyinSyllable | null {
  const parts = symbols.filter((s) => s && s !== " ").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  let tone: number | null = null;
  const rest: string[] = [];
  for (const part of parts) {
    if (part in TONES) {
      // 轻声符号 ˙ 在注音里写在音节**前面**，这里统一当声调处理
      tone = TONES[part];
      continue;
    }
    rest.push(part);
  }
  if (tone === null) tone = 1; // 没标声调时按一声（词表里 ā 与 a 是不同 token，缺省取一声更常见）
  if (!rest.length) return null;

  const hasInitial = rest[0] in INITIALS;
  const initialLetters = hasInitial ? INITIALS[rest[0]] : "";
  const finalSymbols = (hasInitial ? rest.slice(1) : rest).join("");
  let finalLetters: string | undefined;
  if (!finalSymbols) {
    // 只有声母符号的「舌尖元音」音节：ㄓ/ㄔ/ㄕ/ㄖ/ㄗ/ㄘ/ㄙ 在拼音里写作 zhi/chi/shi/ri/zi/ci/si
    // （世 = ㄕ ˋ → shì、之 = ㄓ ˉ → zhī；lexicon 里这类字很多，漏了会整批转换失败）
    finalLetters = hasInitial && /^(zh|ch|sh|r|z|c|s)$/.test(initialLetters) ? "i" : undefined;
  } else {
    finalLetters = hasInitial
      ? FINALS_WITH_INITIAL[finalSymbols]
      : FINALS_ZERO_INITIAL[finalSymbols];
  }
  if (!finalLetters) return null;
  // j/q/x 后面 ü 写成 u（军 jūn、学 xué、雨 yǔ）—— 拼音正字法，必须换，
  // 否则会生成 `j ǖn` 这种 token 表里根本不存在的韵母（实测就是这条把「你好军哥」写错的）
  if (/^(j|q|x)$/.test(initialLetters)) finalLetters = finalLetters.replace(/ü/g, "u");

  const pinyin = applyTone(initialLetters + finalLetters, tone);
  // 拆分：拼音开头那串辅音字母（含 y/w）= 声母 token，其余 = 韵母 token。
  // y/w 必须算声母 —— 模型自带的样例就是 `w én`（文）、`y ǒu`（友）、`y ì`（艺）。
  const match = /^([bpmfdtnlgkhjqxzcsryw]*(?:h)?)(.*)$/.exec(pinyin);
  if (!match) return null;
  const [, initial, final] = match;
  if (!final) return null;
  return { initial, final, tone, pinyin };
}

/** lexicon.txt → 字 → 读音列表（注音符号数组，按文件顺序去重，保留多音字） */
export function parseLexiconReadings(lexiconText: unknown, maxReadings = 3): Map<string, string[][]> {
  const map = new Map<string, string[][]>();
  for (const line of String(lexiconText ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const spaceAt = trimmed.search(/\s/);
    if (spaceAt <= 0) continue;
    const word = trimmed.slice(0, spaceAt);
    const chars = [...word];
    if (chars.length !== 1) continue; // 只认单字读音（多字词条目的读音是拼接的）
    const symbols = trimmed.slice(spaceAt).trim().split(/\s+/).filter(Boolean);
    if (!symbols.length) continue;
    const list = map.get(chars[0]) ?? [];
    const key = symbols.join(" ");
    if (list.some((s) => s.join(" ") === key)) continue;
    if (list.length >= maxReadings) continue;
    list.push(symbols);
    map.set(chars[0], list);
  }
  return map;
}

export type KwsKeywordLine = {
  /** 可直接写进 keywords.txt 的一行 */
  line: string;
  /** 关键词名字（模型命中时回传这个） */
  label: string;
  /** 这条用的读音（带声调拼音，便于诊断） */
  reading: string;
  /** 该读音里不在模型 token 表里的部分（空 = 可用） */
  missing: string[];
};

export type KwsKeywordBuild = {
  lines: KwsKeywordLine[];
  /** 无法转换的字（音色模型 lexicon 里没有读音） */
  unknownChars: string[];
  /** 最多生成几条（多音字会各生成一条，模型侧多关键词不会互相干扰） */
  truncated: boolean;
};

/**
 * 中文唤醒词 → KWS 关键词行。
 *
 * 多音字会**各生成一条**（例如「行长」），模型支持多关键词、互不干扰，
 * 这样比猜一个读音稳；条数上限 `maxLines`（默认 4）防止组合爆炸。
 * 传输/校验用不到的字直接跳过并在 `missing` 里报出来 —— 调用方据此提示用户换词。
 */
export function buildKeywordLines(options: {
  phrase: string;
  readings: Map<string, string[][]>;
  /** 模型 token 表（tokens.txt 第一列），用于校验；不传则不校验 */
  tokens?: Set<string>;
  maxLines?: number;
}): KwsKeywordBuild {
  const phrase = String(options.phrase ?? "").replace(/\s+/g, "").trim();
  const maxLines = options.maxLines ?? 4;
  const unknownChars: string[] = [];
  if (!phrase) return { lines: [], unknownChars, truncated: false };

  /** 每条候选：[每字的 (initial, final) 序列, 读音串] */
  let candidates: { pairs: [string, string][]; reading: string }[] = [{ pairs: [], reading: "" }];
  for (const ch of [...phrase]) {
    const list = options.readings.get(ch);
    if (!list?.length) {
      unknownChars.push(ch);
      candidates = [];
      break;
    }
    const next: typeof candidates = [];
    for (const candidate of candidates) {
      for (const symbols of list) {
        const syllable = zhuyinToSyllable(symbols);
        if (!syllable) continue;
        next.push({
          pairs: [...candidate.pairs, [syllable.initial, syllable.final]],
          reading: candidate.reading + syllable.pinyin,
        });
      }
    }
    // 去重（同一读音可能在 lexicon 里出现多次）+ 截断
    const seen = new Set<string>();
    candidates = next.filter((c) => (seen.has(c.reading) ? false : (seen.add(c.reading), true))).slice(0, maxLines);
    if (!candidates.length) break;
  }

  const lines: KwsKeywordLine[] = [];
  for (const candidate of candidates) {
    const flat: string[] = [];
    const missing: string[] = [];
    for (const [initial, final] of candidate.pairs) {
      if (initial) {
        flat.push(initial);
        if (options.tokens && !options.tokens.has(initial)) missing.push(initial);
      }
      flat.push(final);
      if (options.tokens && !options.tokens.has(final)) missing.push(final);
    }
    lines.push({ line: `${flat.join(" ")} @${phrase}`, label: phrase, reading: candidate.reading, missing });
  }
  return { lines, unknownChars, truncated: candidates.length >= maxLines };
}
